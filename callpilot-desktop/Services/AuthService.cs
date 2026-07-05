using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace CallPilot.Desktop.Services;

public sealed class AuthService
{
    private readonly HttpClient _httpClient;

    public AuthService(string baseUrl)
    {
        _httpClient = new HttpClient { BaseAddress = new Uri(baseUrl) };
    }

    public async Task<string?> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        var response = await _httpClient.PostAsJsonAsync("/api/v1/auth/login", new { email, password }, ct);

        if (!response.IsSuccessStatusCode)
            return null;

        var result = await response.Content.ReadFromJsonAsync<LoginResponse>(cancellationToken: ct);
        return result?.AccessToken;
    }

    private sealed record LoginResponse(
        [property: JsonPropertyName("accessToken")] string AccessToken,
        [property: JsonPropertyName("refreshToken")] string RefreshToken);
}
