using System.Diagnostics;
using System.Runtime.InteropServices;
using CallPilot.Desktop.Audio;
using CallPilot.Desktop.Models;
using Microsoft.Extensions.Logging;

namespace CallPilot.Desktop.Services;

public class FfmpegAudioCaptureService : IAudioCaptureService, IDisposable
{
    private readonly ILogger<FfmpegAudioCaptureService> _logger;
    private readonly string? _micDevice;
    private readonly string _source;
    private Process? _ffmpegProcess;
    private long _sequence;

    public event EventHandler<AudioFrame>? AudioFrameCaptured;

    public FfmpegAudioCaptureService(ILogger<FfmpegAudioCaptureService> logger, AgentConfiguration config)
    {
        _logger = logger;
        _micDevice = config.MicrophoneDevice;
        _source = config.AudioSource;
    }

    public static void ListDevices()
    {
        Console.WriteLine("Available audio capture devices:");
        try
        {
            var proc = Process.Start(new ProcessStartInfo
            {
                FileName = "ffmpeg",
                Arguments = RuntimeInformation.IsOSPlatform(OSPlatform.OSX)
                    ? "-f avfoundation -list_devices true -i ''"
                    : "-f dshow -list_devices true -i dummy",
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            })!;
            var output = proc.StandardError.ReadToEnd();
            proc.WaitForExit();

            var lines = output.Split('\n');
            bool inAudio = false;
            foreach (var line in lines)
            {
                if (line.Contains("AVFoundation audio devices:"))
                {
                    inAudio = true;
                    continue;
                }
                if (line.Contains("AVFoundation video devices:")) inAudio = false;
                if (inAudio && line.Contains("] ["))
                {
                    var match = System.Text.RegularExpressions.Regex.Match(line, @"\[(\d+)\]\s+(.+)");
                    if (match.Success)
                        Console.WriteLine($"  :{match.Groups[1].Value} = {match.Groups[2].Value.Trim()}");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Failed to list devices: {ex.Message}");
        }
    }

    public Task StartCaptureAsync(int sampleRate, int channels, CancellationToken cancellationToken)
    {
        var device = GetAudioInputDevice();

        var args = $"-f {device} -i default -f s16le -acodec pcm_s16le -ar {sampleRate} -ac {channels} -";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            var input = string.IsNullOrEmpty(_micDevice) ? ":0" : _micDevice;
            args = $"-f avfoundation -i {input} -f s16le -acodec pcm_s16le -ar {sampleRate} -ac {channels} -";
        }

        _logger.LogInformation("Starting audio capture: args={Args}", args);

        _ffmpegProcess = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "ffmpeg",
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            },
            EnableRaisingEvents = true
        };

        _ffmpegProcess.Start();

        // Read FFmpeg stderr asynchronously so device/permission errors are visible
        _ = Task.Run(async () =>
        {
            try
            {
                var stderr = await _ffmpegProcess.StandardError.ReadToEndAsync(cancellationToken);
                if (!string.IsNullOrWhiteSpace(stderr))
                {
                    _logger.LogWarning("FFmpeg stderr output:\n{Stderr}", stderr);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading FFmpeg stderr");
            }
        }, cancellationToken);

        _ = Task.Run(async () =>
        {
            var buffer = new byte[sampleRate * channels * 2 * 40 / 1000]; // 40ms chunk
            var stream = _ffmpegProcess.StandardOutput.BaseStream;

            // Pre-flight: collect first ~1 second of audio to check for silence
            var preflightBuffer = new byte[sampleRate * channels * 2]; // 1 second
            var preflightOffset = 0;
            var preflightComplete = false;

            try
            {
                while (!cancellationToken.IsCancellationRequested && !_ffmpegProcess.HasExited)
                {
                    var bytesRead = await stream.ReadAsync(buffer, cancellationToken);
                    if (bytesRead == 0) break;

                    // Pre-flight silence check: accumulate first 1s of audio
                    if (!preflightComplete)
                    {
                        var remaining = preflightBuffer.Length - preflightOffset;
                        var toCopy = Math.Min(bytesRead, remaining);
                        Array.Copy(buffer, 0, preflightBuffer, preflightOffset, toCopy);
                        preflightOffset += toCopy;

                        if (preflightOffset >= preflightBuffer.Length)
                        {
                            preflightComplete = true;
                            var allZero = true;
                            for (var i = 0; i < preflightBuffer.Length; i++)
                            {
                                if (preflightBuffer[i] != 0)
                                {
                                    allZero = false;
                                    break;
                                }
                            }
                            if (allZero)
                            {
                                _logger.LogWarning(
                                    "⚠️  Pre-flight check FAILED: First 1 second of audio is all zeros!\n" +
                                    "    The selected microphone device is producing silent audio.\n" +
                                    "    Possible causes:\n" +
                                    "      (1) Microphone permissions not granted to Terminal (System Settings > Privacy > Microphone)\n" +
                                    "      (2) Wrong device index — run 'dotnet run -- --list-devices' to see current devices\n" +
                                    "      (3) Device indices may have changed if peripherals were plugged/unplugged\n" +
                                    "      (4) Microphone is muted or input volume is zero\n" +
                                    "    Try different --mic-device values: :0, :1, or :2");
                            }
                        }
                    }

                    var frameData = new byte[bytesRead];
                    Array.Copy(buffer, frameData, bytesRead);

                    AudioFrameCaptured?.Invoke(this, new AudioFrame(
                        Interlocked.Increment(ref _sequence),
                        DateTime.UtcNow,
                        frameData,
                        sampleRate,
                        channels,
                        _source));
                }

                if (!cancellationToken.IsCancellationRequested && _ffmpegProcess.HasExited)
                {
                    var exitCode = _ffmpegProcess.ExitCode;
                    if (exitCode != 0)
                    {
                        _logger.LogError("FFmpeg exited with code {ExitCode} — device may be invalid or permissions denied", exitCode);
                    }
                    else
                    {
                        _logger.LogWarning("FFmpeg process exited unexpectedly (exit code 0)");
                    }
                }
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Audio capture cancelled");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Audio capture error");
            }
        }, cancellationToken);

        return Task.CompletedTask;
    }

    public Task StopCaptureAsync()
    {
        if (_ffmpegProcess is { HasExited: false })
        {
            _ffmpegProcess.Kill();
            _ffmpegProcess.Dispose();
            _ffmpegProcess = null;
        }
        _logger.LogInformation("Audio capture stopped");
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        _ffmpegProcess?.Kill();
        _ffmpegProcess?.Dispose();
    }

    private static string GetAudioInputDevice()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return "dshow";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            return "alsa";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            return "avfoundation";
        return "dshow";
    }
}
