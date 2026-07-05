using CallPilot.Server.Application.Authentication.Login;
using CallPilot.Server.Application.Authentication.Register;
using CallPilot.Server.Infrastructure.Auth;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace CallPilot.Server.Tests.Authentication;

public class AuthenticationTests : IAsyncLifetime
{
    private readonly CallPilotDbContext _dbContext;
    private readonly PasswordHasher _passwordHasher;
    private readonly JwtTokenGenerator _jwtTokenGenerator;

    public AuthenticationTests()
    {
        var options = new DbContextOptionsBuilder<CallPilotDbContext>()
            .UseInMemoryDatabase($"CallPilot_Test_{Guid.NewGuid()}")
            .Options;

        _dbContext = new CallPilotDbContext(options);
        _passwordHasher = new PasswordHasher();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "Jwt:Secret", "Test-Secret-Key-That-Is-At-Least-32-Characters-Long!" },
                { "Jwt:Issuer", "TestIssuer" },
                { "Jwt:Audience", "TestAudience" },
                { "Jwt:AccessTokenExpiryMinutes", "60" },
                { "Jwt:RefreshTokenExpiryDays", "7" }
            })
            .Build();

        _jwtTokenGenerator = new JwtTokenGenerator(configuration);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task Register_NewUser_CreatesUserSuccessfully()
    {
        var handler = new RegisterHandler(_dbContext, _passwordHasher);
        var command = new RegisterCommand("test@example.com", "Password123!", "Password123!");

        var result = await handler.HandleAsync(command);

        Assert.NotNull(result);
        Assert.Equal("test@example.com", result.Email);
        Assert.NotEqual(Guid.Empty, result.Id);

        var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.Email == "test@example.com");
        Assert.NotNull(user);
    }

    [Fact]
    public async Task Register_DuplicateEmail_ThrowsException()
    {
        var handler = new RegisterHandler(_dbContext, _passwordHasher);
        var command = new RegisterCommand("duplicate@example.com", "Password123!", "Password123!");

        await handler.HandleAsync(command);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => handler.HandleAsync(command));
    }

    [Fact]
    public async Task Login_ValidCredentials_ReturnsTokens()
    {
        var registerHandler = new RegisterHandler(_dbContext, _passwordHasher);
        await registerHandler.HandleAsync(
            new RegisterCommand("user@example.com", "Password123!", "Password123!"));

        var loginHandler = new LoginHandler(_dbContext, _passwordHasher, _jwtTokenGenerator);
        var command = new LoginCommand("user@example.com", "Password123!");

        var result = await loginHandler.HandleAsync(command);

        Assert.NotNull(result.AccessToken);
        Assert.NotNull(result.RefreshToken);
        Assert.NotEmpty(result.AccessToken);
        Assert.NotEmpty(result.RefreshToken);
    }

    [Fact]
    public async Task Login_InvalidPassword_ThrowsUnauthorized()
    {
        var registerHandler = new RegisterHandler(_dbContext, _passwordHasher);
        await registerHandler.HandleAsync(
            new RegisterCommand("user@example.com", "Password123!", "Password123!"));

        var loginHandler = new LoginHandler(_dbContext, _passwordHasher, _jwtTokenGenerator);
        var command = new LoginCommand("user@example.com", "WrongPassword!");

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => loginHandler.HandleAsync(command));
    }

    [Fact]
    public async Task Login_NonexistentUser_ThrowsUnauthorized()
    {
        var loginHandler = new LoginHandler(_dbContext, _passwordHasher, _jwtTokenGenerator);
        var command = new LoginCommand("nouser@example.com", "Password123!");

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => loginHandler.HandleAsync(command));
    }

    [Fact]
    public async Task Refresh_ValidToken_ReturnsNewTokens()
    {
        var registerHandler = new RegisterHandler(_dbContext, _passwordHasher);
        await registerHandler.HandleAsync(
            new RegisterCommand("user@example.com", "Password123!", "Password123!"));

        var loginHandler = new LoginHandler(_dbContext, _passwordHasher, _jwtTokenGenerator);
        var loginResult = await loginHandler.HandleAsync(
            new LoginCommand("user@example.com", "Password123!"));

        var refreshHandler = new CallPilot.Server.Application.Authentication.Refresh.RefreshHandler(
            _dbContext, _jwtTokenGenerator);
        var refreshCommand = new CallPilot.Server.Application.Authentication.Refresh.RefreshCommand(
            loginResult.RefreshToken);

        var result = await refreshHandler.HandleAsync(refreshCommand);

        Assert.NotNull(result.AccessToken);
        Assert.NotNull(result.RefreshToken);
        Assert.NotEqual(loginResult.RefreshToken, result.RefreshToken);
    }

    [Fact]
    public async Task Refresh_InvalidToken_ThrowsUnauthorized()
    {
        var refreshHandler = new CallPilot.Server.Application.Authentication.Refresh.RefreshHandler(
            _dbContext, _jwtTokenGenerator);
        var command = new CallPilot.Server.Application.Authentication.Refresh.RefreshCommand(
            "invalid-refresh-token");

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => refreshHandler.HandleAsync(command));
    }

    [Fact]
    public async Task Refresh_RevokedToken_ThrowsUnauthorized()
    {
        var registerHandler = new RegisterHandler(_dbContext, _passwordHasher);
        await registerHandler.HandleAsync(
            new RegisterCommand("user@example.com", "Password123!", "Password123!"));

        var loginHandler = new LoginHandler(_dbContext, _passwordHasher, _jwtTokenGenerator);
        var loginResult = await loginHandler.HandleAsync(
            new LoginCommand("user@example.com", "Password123!"));

        var refreshHandler = new CallPilot.Server.Application.Authentication.Refresh.RefreshHandler(
            _dbContext, _jwtTokenGenerator);
        var command = new CallPilot.Server.Application.Authentication.Refresh.RefreshCommand(
            loginResult.RefreshToken);

        await refreshHandler.HandleAsync(command); // First refresh revokes the token

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => refreshHandler.HandleAsync(command)); // Second attempt should fail
    }

    [Fact]
    public async Task Logout_RevokesRefreshToken()
    {
        var registerHandler = new RegisterHandler(_dbContext, _passwordHasher);
        await registerHandler.HandleAsync(
            new RegisterCommand("user@example.com", "Password123!", "Password123!"));

        var loginHandler = new LoginHandler(_dbContext, _passwordHasher, _jwtTokenGenerator);
        var loginResult = await loginHandler.HandleAsync(
            new LoginCommand("user@example.com", "Password123!"));

        var logoutHandler = new CallPilot.Server.Application.Authentication.Logout.LogoutHandler(_dbContext);
        await logoutHandler.HandleAsync(
            new CallPilot.Server.Application.Authentication.Logout.LogoutCommand(loginResult.RefreshToken));

        var token = await _dbContext.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.Token == loginResult.RefreshToken);
        Assert.NotNull(token);
        Assert.True(token.IsRevoked);
    }
}
