using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Providers.List;

public record ListProvidersResponse(
    Guid Id,
    string ProviderType,
    string Model,
    string? Endpoint,
    double Temperature,
    int MaxTokens,
    int TimeoutSeconds,
    bool IsEnabled,
    DateTime CreatedAt);

public class ListProvidersHandler
{
    private readonly CallPilotDbContext _dbContext;

    public ListProvidersHandler(CallPilotDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<IReadOnlyList<ListProvidersResponse>> HandleAsync(Guid userId)
    {
        return await _dbContext.ProviderConfigurations
            .Where(p => p.UserId == userId)
            .Select(p => new ListProvidersResponse(
                p.Id, p.ProviderType, p.Model, p.Endpoint,
                p.Temperature, p.MaxTokens, p.TimeoutSeconds,
                p.IsEnabled, p.CreatedAt))
            .ToListAsync();
    }
}
