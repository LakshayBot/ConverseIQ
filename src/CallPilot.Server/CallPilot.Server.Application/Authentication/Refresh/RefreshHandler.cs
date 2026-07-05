using CallPilot.Server.Domain.Users;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Shared.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Authentication.Refresh;

public class RefreshHandler
{
    private readonly CallPilotDbContext _dbContext;
    private readonly IJwtTokenGenerator _jwtTokenGenerator;

    public RefreshHandler(CallPilotDbContext dbContext, IJwtTokenGenerator jwtTokenGenerator)
    {
        _dbContext = dbContext;
        _jwtTokenGenerator = jwtTokenGenerator;
    }

    public async Task<RefreshResponse> HandleAsync(RefreshCommand command)
    {
        var existingToken = await _dbContext.RefreshTokens
            .Include(rt => rt.User)
            .FirstOrDefaultAsync(rt => rt.Token == command.RefreshToken);

        if (existingToken is null || !existingToken.IsActive)
        {
            throw new UnauthorizedAccessException("Invalid or expired refresh token.");
        }

        existingToken.Revoke();

        var user = existingToken.User;
        var accessToken = _jwtTokenGenerator.GenerateAccessToken(user.Id, user.Email);
        var (newRefreshToken, newRefreshTokenExpiresAt) = _jwtTokenGenerator.GenerateRefreshTokenWithExpiry();

        var newRefreshTokenEntity = new RefreshToken(user.Id, newRefreshToken, newRefreshTokenExpiresAt);
        _dbContext.RefreshTokens.Add(newRefreshTokenEntity);

        await _dbContext.SaveChangesAsync();

        return new RefreshResponse(accessToken, newRefreshToken, DateTime.UtcNow.AddHours(1), newRefreshTokenExpiresAt);
    }
}
