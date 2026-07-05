using CallPilot.Desktop.Models;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;

namespace CallPilot.Desktop.Services;

public sealed class SignalRClient : IAsyncDisposable
{
    private HubConnection? _connection;
    private readonly string _hubUrl;
    private readonly string _accessToken;
    private readonly ILogger<SignalRClient> _logger;
    private Timer? _heartbeatTimer;
    private int _sequence;
    private string? _meetingId;

    public bool IsConnected => _connection?.State == HubConnectionState.Connected;

    public event EventHandler<string>? Disconnected;
    public event EventHandler<string>? Reconnecting;
    public event EventHandler<string>? Reconnected;

    public SignalRClient(string hubUrl, string accessToken, ILogger<SignalRClient> logger)
    {
        _hubUrl = hubUrl;
        _accessToken = accessToken;
        _logger = logger;
    }

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        _connection = new HubConnectionBuilder()
            .WithUrl(_hubUrl, options =>
            {
                options.AccessTokenProvider = () => Task.FromResult(_accessToken)!;
            })
            .WithAutomaticReconnect(new RetryPolicy())
            .Build();

        _connection.Closed += async (error) =>
        {
            _logger.LogWarning("Connection closed: {Error}", error?.Message);
            Disconnected?.Invoke(this, error?.Message ?? "Unknown");
            await Task.CompletedTask;
        };

        _connection.Reconnecting += (error) =>
        {
            _logger.LogWarning("Reconnecting: {Error}", error?.Message);
            Reconnecting?.Invoke(this, error?.Message ?? "Unknown");
            return Task.CompletedTask;
        };

        _connection.Reconnected += (connectionId) =>
        {
            _logger.LogInformation("Reconnected with ID: {Id}", connectionId);
            Reconnected?.Invoke(this, connectionId ?? "Unknown");
            return Task.CompletedTask;
        };

        await _connection.StartAsync(ct);
        _logger.LogInformation("Connected to server");
    }

    public async Task RegisterAgent(AgentInfo info, CancellationToken ct = default)
    {
        if (_connection is null) return;
        _meetingId = await _connection.InvokeAsync<string>("RegisterAgent", info, ct);
        _logger.LogInformation("Registered agent, meeting ID: {Id}", _meetingId);

        StartHeartbeat();
    }

    public async Task SendAudioFrame(AudioFrame frame, CancellationToken ct = default)
    {
        if (_connection is null) return;

        frame = frame with
        {
            MeetingId = _meetingId ?? string.Empty,
            Sequence = Interlocked.Increment(ref _sequence),
            Timestamp = DateTime.UtcNow.ToString("O")
        };

        await _connection.SendAsync("SendAudioFrame", frame, ct);
    }

    private void StartHeartbeat()
    {
        _heartbeatTimer = new Timer(async _ =>
        {
            if (_connection?.State == HubConnectionState.Connected && _meetingId is not null)
            {
                try
                {
                    await _connection.SendAsync("Heartbeat", _meetingId);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("Heartbeat failed: {Error}", ex.Message);
                }
            }
        }, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
    }

    public async Task StopAsync()
    {
        _heartbeatTimer?.Dispose();
        if (_connection is not null)
        {
            await _connection.StopAsync();
            await _connection.DisposeAsync();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        GC.SuppressFinalize(this);
    }

    private sealed class RetryPolicy : IRetryPolicy
    {
        public TimeSpan? NextRetryDelay(RetryContext retryContext)
        {
            if (retryContext.PreviousRetryCount >= 5)
                return null;

            return TimeSpan.FromSeconds(Math.Pow(2, retryContext.PreviousRetryCount));
        }
    }
}
