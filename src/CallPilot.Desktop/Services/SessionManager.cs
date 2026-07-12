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

        var meetingId = await _authService.CreateMeetingAsync();
        if (meetingId is null)
            throw new InvalidOperationException("Failed to create meeting.");

        _config.MeetingId = meetingId;
        var dashUrl = BuildDashboardUrl(_config.ServerUrl) + "/meeting/" + meetingId;
        _logger.LogInformation("========================================");
        _logger.LogInformation(" Meeting ID: {MeetingId}", meetingId);
        _logger.LogInformation(" Dashboard:  {Url}", dashUrl);
        _logger.LogInformation("========================================");

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

        try { await _audioCaptureService.StopCaptureAsync(); } catch { }

        using var disconnectCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            await _signalRService.DisconnectAsync();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Disconnect error (ignored)");
        }

        _logger.LogInformation("Session stopped");
    }

    private async void OnAudioFrameCaptured(object? sender, AudioFrame frame)
    {
        try
        {
            await _signalRService.SendAudioFrameAsync(frame);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled error sending audio frame {Sequence}", frame.Sequence);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _cts?.Dispose();
    }

    /// <summary>
    /// Map a server URL (port 5001 by default) to the dashboard URL
    /// (port 3000 by default).  Leaves the URL alone if the server port
    /// isn't the well-known API port — covers proxied deployments.
    /// </summary>
    internal static string BuildDashboardUrl(string serverUrl)
    {
        if (string.IsNullOrEmpty(serverUrl)) return serverUrl;
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri)) return serverUrl;
        if (uri.Port != 5001) return serverUrl;

        var dashboard = new UriBuilder(uri)
        {
            Port = 3000,
        };
        return dashboard.Uri.ToString().TrimEnd('/');
    }
}
