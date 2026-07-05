using System.Diagnostics;
using System.Runtime.InteropServices;
using CallPilot.Desktop.Audio;
using Microsoft.Extensions.Logging;

namespace CallPilot.Desktop.Services;

public class FfmpegAudioCaptureService : IAudioCaptureService, IDisposable
{
    private readonly ILogger<FfmpegAudioCaptureService> _logger;
    private Process? _ffmpegProcess;
    private long _sequence;

    public event EventHandler<AudioFrame>? AudioFrameCaptured;

    public FfmpegAudioCaptureService(ILogger<FfmpegAudioCaptureService> logger)
    {
        _logger = logger;
    }

    public Task StartCaptureAsync(int sampleRate, int channels, CancellationToken cancellationToken)
    {
        var device = GetAudioInputDevice();

        var args = $"-f {device} -i default -f s16le -acodec pcm_s16le -ar {sampleRate} -ac {channels} -";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            args = $"-f avfoundation -i :0 -f s16le -acodec pcm_s16le -ar {sampleRate} -ac {channels} -";
        }

        _logger.LogInformation("Starting audio capture: args={Args}", args);

        _ffmpegProcess = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "ffmpeg",
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = false,
                UseShellExecute = false,
                CreateNoWindow = true
            },
            EnableRaisingEvents = true
        };

        _ffmpegProcess.Start();

        _ = Task.Run(async () =>
        {
            var buffer = new byte[sampleRate * channels * 2 * 40 / 1000]; // 40ms chunk
            var stream = _ffmpegProcess.StandardOutput.BaseStream;

            try
            {
                while (!cancellationToken.IsCancellationRequested && !_ffmpegProcess.HasExited)
                {
                    var bytesRead = await stream.ReadAsync(buffer, cancellationToken);
                    if (bytesRead == 0) break;

                    var frameData = new byte[bytesRead];
                    Array.Copy(buffer, frameData, bytesRead);

                    AudioFrameCaptured?.Invoke(this, new AudioFrame(
                        Interlocked.Increment(ref _sequence),
                        DateTime.UtcNow,
                        frameData,
                        sampleRate,
                        channels));
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
