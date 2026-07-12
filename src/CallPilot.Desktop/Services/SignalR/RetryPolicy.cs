using CallPilot.Desktop.Models;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;

namespace CallPilot.Desktop.Services.SignalR;

/// <summary>
/// Exponential-backoff reconnect policy for the desktop agent's SignalR
/// connection.  Caps at <see cref="AgentConfiguration.MaxReconnectAttempts"/>.
/// </summary>
internal class RetryPolicy : IRetryPolicy
{
    private readonly AgentConfiguration _config;
    private readonly ILogger _logger;

    public RetryPolicy(AgentConfiguration config, ILogger logger)
    {
        _config = config;
        _logger = logger;
    }

    public TimeSpan? NextRetryDelay(RetryContext retryContext)
    {
        if (retryContext.PreviousRetryCount >= _config.MaxReconnectAttempts)
        {
            _logger.LogError("Max reconnect attempts reached");
            return null;
        }

        var delay = TimeSpan.FromSeconds(_config.ReconnectDelaySeconds * Math.Pow(2, retryContext.PreviousRetryCount));
        _logger.LogInformation("Retry {Count} in {Delay}ms", retryContext.PreviousRetryCount + 1, delay.TotalMilliseconds);
        return delay;
    }
}
