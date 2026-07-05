using CallPilot.Desktop.Audio;
using CallPilot.Desktop.Models;
using Microsoft.Extensions.Logging;

namespace CallPilot.Desktop.Services;

public class SessionManager : IAsyncDisposable
{
    private readonly AgentConfiguration _config;
    private readonly AuthenticationService _authService;
    private readonly SignalRConnectionService _signalRService;
    private readonly IAudioCaptureService _audioCaptureService;
    private readonly ILogger<SessionManager> _logger;
    private CancellationTokenSource? _cts;

    public SessionManager(
        AgentConfiguration config,
        AuthenticationService authService,
        SignalRConnectionService signalRService,
        IAudioCaptureService audioCaptureService,
        ILogger<SessionManager> logger)
    {
        _config = config;
        _authService = authService;
        _signalRService = signalRService;
        _audioCaptureService = audioCaptureService;
        _logger = logger;
    }

    public async Task StartAsync(string email, string password, CancellationToken cancellationToken = default)
    {
        var loggedIn = await _authService.LoginAsync(email, password);
        if (!loggedIn)
            throw new InvalidOperationException("Authentication failed. Check credentials and server availability.");

        _config.MeetingId = Guid.NewGuid().ToString();
        _logger.LogInformation("Meeting created: {MeetingId}", _config.MeetingId);

        await _signalRService.ConnectAsync(cancellationToken);

        _audioCaptureService.AudioFrameCaptured += OnAudioFrameCaptured;

        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        await _audioCaptureService.StartCaptureAsync(_config.SampleRate, _config.Channels, _cts.Token);

        _logger.LogInformation("Session started - streaming audio to server");
    }

    public async Task StopAsync()
    {
        _logger.LogInformation("Stopping session...");

        _cts?.Cancel();

        _audioCaptureService.AudioFrameCaptured -= OnAudioFrameCaptured;
        await _audioCaptureService.StopCaptureAsync();

        await _signalRService.DisconnectAsync();

        _logger.LogInformation("Session stopped");
    }

    private async void OnAudioFrameCaptured(object? sender, AudioFrame frame)
    {
        await _signalRService.SendAudioFrameAsync(frame);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _cts?.Dispose();
    }
}
