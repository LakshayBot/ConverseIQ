using System.Net;
using System.Net.Http.Json;
using CallPilot.Desktop.Models;
using CallPilot.Desktop.Services;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace CallPilot.Server.Tests.Desktop;

public class AuthenticationServiceTests
{
    [Fact]
    public async Task Login_Successful_StoresTokens()
    {
        var handler = new MockHttpMessageHandler();
        handler.Setup(HttpMethod.Post, "/api/v1/auth/login", HttpStatusCode.OK, JsonContent.Create(new
            {
                accessToken = "test-access-token",
                refreshToken = "test-refresh-token",
                accessTokenExpiresAt = DateTime.UtcNow.AddHours(1),
                refreshTokenExpiresAt = DateTime.UtcNow.AddDays(7)
            }));

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://localhost:5001") };
        var config = new AgentConfiguration { ServerUrl = "http://localhost:5001" };
        var logger = Mock.Of<ILogger<AuthenticationService>>();
        var service = new AuthenticationService(httpClient, config, logger);

        var result = await service.LoginAsync("test@example.com", "Password123!");

        Assert.True(result);
        Assert.Equal("test-access-token", config.AccessToken);
        Assert.Equal("test-refresh-token", config.RefreshToken);
    }

    [Fact]
    public async Task Login_Failed_ReturnsFalse()
    {
        var handler = new MockHttpMessageHandler();
        handler.Setup(HttpMethod.Post, "/api/v1/auth/login", HttpStatusCode.Unauthorized);

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://localhost:5001") };
        var config = new AgentConfiguration();
        var logger = Mock.Of<ILogger<AuthenticationService>>();
        var service = new AuthenticationService(httpClient, config, logger);

        var result = await service.LoginAsync("test@example.com", "WrongPassword!");

        Assert.False(result);
        Assert.Null(config.AccessToken);
    }

    [Fact]
    public async Task RefreshToken_Successful_UpdatesTokens()
    {
        var handler = new MockHttpMessageHandler();
        handler.Setup(HttpMethod.Post, "/api/v1/auth/refresh", HttpStatusCode.OK, JsonContent.Create(new
            {
                accessToken = "new-access-token",
                refreshToken = "new-refresh-token",
                accessTokenExpiresAt = DateTime.UtcNow.AddHours(1),
                refreshTokenExpiresAt = DateTime.UtcNow.AddDays(7)
            }));

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://localhost:5001") };
        var config = new AgentConfiguration
        {
            AccessToken = "old-access-token",
            RefreshToken = "old-refresh-token"
        };
        var logger = Mock.Of<ILogger<AuthenticationService>>();
        var service = new AuthenticationService(httpClient, config, logger);

        var result = await service.RefreshTokenAsync();

        Assert.True(result);
        Assert.Equal("new-access-token", config.AccessToken);
        Assert.Equal("new-refresh-token", config.RefreshToken);
    }

    [Fact]
    public async Task RefreshToken_NoToken_ReturnsFalse()
    {
        var httpClient = new HttpClient { BaseAddress = new Uri("http://localhost:5001") };
        var config = new AgentConfiguration();
        var logger = Mock.Of<ILogger<AuthenticationService>>();
        var service = new AuthenticationService(httpClient, config, logger);

        var result = await service.RefreshTokenAsync();

        Assert.False(result);
    }
}

public class MockHttpMessageHandler : HttpMessageHandler
{
    private readonly Dictionary<string, Func<HttpRequestMessage, HttpResponseMessage>> _handlers = new();

    public void Setup(HttpMethod method, string url, HttpStatusCode statusCode, HttpContent? content = null)
    {
        _handlers[$"{method}:{url}"] = _ => new HttpResponseMessage(statusCode) { Content = content };
    }

    public void Setup(HttpMethod method, string url, HttpResponseMessage response)
    {
        _handlers[$"{method}:{url}"] = _ => response;
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var key = $"{request.Method}:{request.RequestUri!.AbsolutePath}";
        if (_handlers.TryGetValue(key, out var handler))
        {
            return Task.FromResult(handler(request));
        }
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}
