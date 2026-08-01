using System.Net.Http.Json;
using CallPilot.Desktop.Audio;
using CallPilot.Desktop.Models;
using CallPilot.Desktop.Services.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;

namespace CallPilot.Desktop.Services;

public class SignalRConnectionService : IAsyncDisposable
{
    private readonly AgentConfiguration _config;
    private readonly ILogger<SignalRConnectionService> _logger;
    private HubConnection? _connection;
    private Timer? _heartbeatTimer;
    private DateTime _lastTranscriptTime;
    private int _transcriptCount;

    private string _lastDisplayLine = "";
    private string _conversation = "";
    private string _currentPartial = "";
    private static readonly object _consoleLock = new();
    private static bool _cursorHidden;

    private void WriteLiveCaption(string rawLine)
    {
        lock (_consoleLock)
        {
            if (!_cursorHidden)
            {
                Console.CursorVisible = false;
                _cursorHidden = true;
            }

            var maxLen = Math.Max(60, Console.WindowWidth - 1);
            if (rawLine.Length > maxLen)
                rawLine = rawLine[^maxLen..];    // keep rightmost (newest) text
            rawLine = rawLine.PadRight(maxLen);

            Console.Write($"\r{rawLine}");
        }
    }

    private void UpdateDisplay(string speaker, string text, bool isFinal)
    {
        var compact = speaker switch { "Salesperson" => "You", "Customer-1" => "Customer", _ => speaker };

        if (isFinal)
        {
            // Append to rolling conversation buffer
            if (_conversation.Length > 0)
                _conversation += "  ";
            _conversation += $"{compact}: {text}";

            _currentPartial = "";

            // Buffer rolling history (keep much more than visible for disconnect summary)
            var bufferCap = Math.Max(500, Console.WindowWidth * 5);
            if (_conversation.Length > bufferCap)
                _conversation = "…" + _conversation[^bufferCap..];
        }
        else
        {
            _currentPartial = $"{compact}: {text}";
        }

        // Show: rolling conversation history (trimmed) + current partial
        var display = _conversation;
        if (!string.IsNullOrEmpty(_currentPartial))
        {
            if (display.Length > 0) display += " · ";
            display += _currentPartial;
        }

        if (display == _lastDisplayLine) return;
        _lastDisplayLine = display;

        WriteLiveCaption(display);
    }

    public event EventHandler<string>? ConnectionStateChanged;
    public bool IsConnected => _connection?.State == HubConnectionState.Connected;

    public SignalRConnectionService(AgentConfiguration config, ILogger<SignalRConnectionService> logger)
    {
        _config = config;
        _logger = logger;
    }

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_config.AccessToken))
            throw new InvalidOperationException("Not authenticated. Call LoginAsync first.");

        _connection = new HubConnectionBuilder()
            .WithUrl($"{_config.ServerUrl}/hubs/desktop-agent", options =>
            {
                options.AccessTokenProvider = () => Task.FromResult(_config.AccessToken)!;
            })
            .WithAutomaticReconnect(new RetryPolicy(_config, _logger))
            .Build();

        _connection.Reconnecting += OnReconnecting;
        _connection.Reconnected += OnReconnected;
        _connection.Closed += OnClosed;

        _connection.On<TranscriptEvent>("TranscriptReceived", (transcript) =>
        {
            _lastTranscriptTime = DateTime.UtcNow;
            Interlocked.Increment(ref _transcriptCount);

            _logger.LogDebug("[{Status}] [{LatencyMs}ms] {Speaker}: {Text}",
                transcript.IsFinal ? "FINAL" : "PARTIAL",
                transcript.LatencyMs,
                transcript.Speaker,
                transcript.Text);

            UpdateDisplay(transcript.Speaker, transcript.Text, transcript.IsFinal);
        });

        _connection.On<SilenceEvent>("SilenceDetected", (silence) =>
        {
            _logger.LogWarning(
                "⚠️  SILENCE DETECTED - {Message}\n" +
                "    Quick fix: The audio device may have changed since last run.\n" +
                "    Run 'dotnet run -- --list-devices' to see current devices and try --mic-device :0, :1, or :2.\n" +
                "    Also check System Settings > Privacy & Security > Microphone.",
                silence.Message);
        });

        await _connection.StartAsync(cancellationToken);
        ConnectionStateChanged?.Invoke(this, "Connected");

        await RegisterAgentAsync();

        _heartbeatTimer = new Timer(async _ => await SendHeartbeatAsync(), null,
            TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds),
            TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds));

        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(15));
            if (_connection?.State == HubConnectionState.Connected
                && _lastTranscriptTime == default)
            {
                _logger.LogWarning(
                    "No transcripts received after 15s. Possible causes:\n" +
                    "  (1) Microphone permissions not granted to Terminal (System Settings > Privacy > Microphone)\n" +
                    "  (2) Wrong audio device selected - run with --list-devices to see available devices\n" +
                    "  (3) AI Engine is not running - check 'docker ps' for ai-engine container\n" +
                    "  (4) Microphone is muted or input volume is zero");
            }
        });

        _logger.LogInformation("SignalR connected and agent registered");
    }

    public async Task SendAudioFrameAsync(AudioFrame frame)
    {
        if (_connection?.State != HubConnectionState.Connected)
        {
            _logger.LogWarning("Audio frame {Sequence} dropped: SignalR connection is {State}",
                frame.Sequence, _connection?.State);
            return;
        }

        try
        {
            await _connection.InvokeAsync("SendAudioFrame", new
            {
                meetingId = _config.MeetingId ?? Guid.NewGuid().ToString(),
                sequence = frame.Sequence,
                timestamp = frame.Timestamp,
                sampleRate = frame.SampleRate,
                channels = frame.Channels,
                source = frame.Source,
                audio = frame.Data
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send audio frame {Sequence}", frame.Sequence);
        }
    }

    public async Task DisconnectAsync()
    {
        _heartbeatTimer?.Dispose();
        _heartbeatTimer = null;

        lock (_consoleLock)
        {
            Console.WriteLine();
            if (_conversation.Length > 0)
            {
                var preview = _conversation.Length > 120 ? _conversation[^120..] : _conversation;
                Console.WriteLine($"  Last: ...{preview}");
            }
            Console.WriteLine($"  - {_transcriptCount} transcript updates -");
            if (_cursorHidden)
            {
                Console.CursorVisible = true;
                _cursorHidden = false;
            }
        }

        if (_connection is not null)
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try
            {
                await _connection.StopAsync(cts.Token);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "SignalR stop error (ignored)");
            }

            try
            {
                await _connection.DisposeAsync();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "SignalR dispose error (ignored)");
            }

            _connection = null;
        }

        ConnectionStateChanged?.Invoke(this, "Disconnected");
    }

    private async Task RegisterAgentAsync()
    {
        await _connection!.InvokeAsync("RegisterAgent", new
        {
            agentVersion = "0.1.0",
            platform = GetPlatform(),
            capabilities = new List<string> { "MicrophoneAudio", "DesktopAudio" }
        });

        _logger.LogInformation("Agent registered with server");
    }

    private async Task SendHeartbeatAsync()
    {
        if (_connection?.State == HubConnectionState.Connected)
        {
            await _connection.InvokeAsync("SendHeartbeat", new
            {
                meetingId = _config.MeetingId ?? Guid.NewGuid().ToString(),
                timestamp = DateTime.UtcNow
            });
        }
    }

    private Task OnReconnecting(Exception? exception)
    {
        _logger.LogWarning(exception, "SignalR reconnecting...");
        ConnectionStateChanged?.Invoke(this, "Reconnecting");
        return Task.CompletedTask;
    }

    private Task OnReconnected(string? connectionId)
    {
        _logger.LogInformation("SignalR reconnected: {ConnectionId}", connectionId);
        ConnectionStateChanged?.Invoke(this, "Connected");
        return RegisterAgentAsync();
    }

    private Task OnClosed(Exception? exception)
    {
        if (exception is not null)
        {
            _logger.LogError(exception, "SignalR connection closed with error");
        }
        else
        {
            _logger.LogInformation("SignalR connection closed");
        }
        ConnectionStateChanged?.Invoke(this, "Disconnected");
        return Task.CompletedTask;
    }

    private static string GetPlatform()
    {
        if (OperatingSystem.IsWindows()) return "Windows";
        if (OperatingSystem.IsMacOS()) return "macOS";
        if (OperatingSystem.IsLinux()) return "Linux";
        return "Unknown";
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
    }
}
