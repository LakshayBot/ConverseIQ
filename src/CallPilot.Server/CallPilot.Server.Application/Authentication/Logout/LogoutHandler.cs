using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Authentication.Logout;

public class LogoutHandler
{
    private readonly CallPilotDbContext _dbContext;

    public LogoutHandler(CallPilotDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task HandleAsync(LogoutCommand command)
    {
        var token = await _dbContext.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.Token == command.RefreshToken);

        if (token is not null)
        {
            token.Revoke();
            await _dbContext.SaveChangesAsync();
        }
    }
}
