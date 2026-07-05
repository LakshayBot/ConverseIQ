using System.Net.Http.Json;
using System.Text.Json.Serialization;
using CallPilot.Desktop.Models;
using Microsoft.Extensions.Logging;

namespace CallPilot.Desktop.Services;

public class AuthenticationService
{
    private readonly HttpClient _httpClient;
    private readonly AgentConfiguration _config;
    private readonly ILogger<AuthenticationService> _logger;

    public AuthenticationService(HttpClient httpClient, AgentConfiguration config, ILogger<AuthenticationService> logger)
    {
        _httpClient = httpClient;
        _config = config;
        _logger = logger;
    }

    public async Task<bool> LoginAsync(string email, string password)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync($"{_config.ServerUrl}/api/v1/auth/login", new
            {
                email,
                password
            });

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Login failed: {StatusCode}", response.StatusCode);
                return false;
            }

            var result = await response.Content.ReadFromJsonAsync<LoginApiResponse>();
            if (result is null) return false;

            _config.AccessToken = result.AccessToken;
            _config.RefreshToken = result.RefreshToken;
            _logger.LogInformation("Login successful");
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Login error");
            return false;
        }
    }

    public async Task<bool> RefreshTokenAsync()
    {
        if (string.IsNullOrEmpty(_config.RefreshToken)) return false;

        try
        {
            var response = await _httpClient.PostAsJsonAsync($"{_config.ServerUrl}/api/v1/auth/refresh", new
            {
                refreshToken = _config.RefreshToken
            });

            if (!response.IsSuccessStatusCode) return false;

            var result = await response.Content.ReadFromJsonAsync<LoginApiResponse>();
            if (result is null) return false;

            _config.AccessToken = result.AccessToken;
            _config.RefreshToken = result.RefreshToken;
            _logger.LogInformation("Token refreshed");
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Token refresh error");
            return false;
        }
    }

    private class LoginApiResponse
    {
        [JsonPropertyName("accessToken")]
        public string AccessToken { get; set; } = string.Empty;

        [JsonPropertyName("refreshToken")]
        public string RefreshToken { get; set; } = string.Empty;

        [JsonPropertyName("accessTokenExpiresAt")]
        public DateTime AccessTokenExpiresAt { get; set; }

        [JsonPropertyName("refreshTokenExpiresAt")]
        public DateTime RefreshTokenExpiresAt { get; set; }
    }
}
