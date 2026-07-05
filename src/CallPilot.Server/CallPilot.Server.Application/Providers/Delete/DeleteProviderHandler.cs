using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Providers.Delete;

public class DeleteProviderHandler
{
    private readonly CallPilotDbContext _dbContext;

    public DeleteProviderHandler(CallPilotDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task HandleAsync(Guid userId, Guid providerId)
    {
        var provider = await _dbContext.ProviderConfigurations
            .FirstOrDefaultAsync(p => p.Id == providerId && p.UserId == userId);

        if (provider is null)
        {
            throw new KeyNotFoundException("Provider configuration not found.");
        }

        _dbContext.ProviderConfigurations.Remove(provider);
        await _dbContext.SaveChangesAsync();
    }
}
