using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace CallPilot.Server.Api.Endpoints;

public class UrlHealthCheck : IHealthCheck
{
    private readonly HttpClient _httpClient;
    private readonly string _url;

    public UrlHealthCheck(string url)
    {
        _url = url;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await _httpClient.GetAsync(_url, cancellationToken);
            if (response.IsSuccessStatusCode)
                return HealthCheckResult.Healthy($"Endpoint {_url} is healthy");

            return HealthCheckResult.Degraded($"Endpoint {_url} returned {response.StatusCode}");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy($"Endpoint {_url} is unavailable: {ex.Message}");
        }
    }
}
