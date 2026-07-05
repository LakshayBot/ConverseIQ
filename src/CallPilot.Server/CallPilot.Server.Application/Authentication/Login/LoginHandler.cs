using CallPilot.Server.Domain.Users;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Shared.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Authentication.Login;

public class LoginHandler
{
    private readonly CallPilotDbContext _dbContext;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwtTokenGenerator;

    public LoginHandler(
        CallPilotDbContext dbContext,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwtTokenGenerator)
    {
        _dbContext = dbContext;
        _passwordHasher = passwordHasher;
        _jwtTokenGenerator = jwtTokenGenerator;
    }

    public async Task<LoginResponse> HandleAsync(LoginCommand command)
    {
        var user = await _dbContext.Users
            .FirstOrDefaultAsync(u => u.Email == command.Email.ToLowerInvariant().Trim());

        if (user is null || !_passwordHasher.Verify(command.Password, user.PasswordHash))
        {
            throw new UnauthorizedAccessException("Invalid email or password.");
        }

        var accessToken = _jwtTokenGenerator.GenerateAccessToken(user.Id, user.Email);
        var (refreshToken, refreshTokenExpiresAt) = _jwtTokenGenerator.GenerateRefreshTokenWithExpiry();

        var refreshTokenEntity = new RefreshToken(user.Id, refreshToken, refreshTokenExpiresAt);
        _dbContext.RefreshTokens.Add(refreshTokenEntity);
        await _dbContext.SaveChangesAsync();

        return new LoginResponse(accessToken, refreshToken, DateTime.UtcNow.AddHours(1), refreshTokenExpiresAt);
    }
}
