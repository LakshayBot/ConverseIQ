using CallPilot.Server.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Features.Providers.Queries;

public sealed class GetProvidersHandler
{
    private readonly IApplicationDbContext _db;

    public GetProvidersHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<List<ProviderDto>> Handle(GetProvidersQuery query, CancellationToken ct)
    {
        return await _db.ProviderConfigurations
            .Where(p => p.UserId == query.UserId)
            .Select(p => new ProviderDto(
                p.Id,
                p.Provider,
                p.Model,
                p.Endpoint,
                p.Temperature,
                p.MaxTokens,
                p.Timeout,
                p.Capabilities,
                p.CreatedAt))
            .ToListAsync(ct);
    }

    public sealed record ProviderDto(
        Guid Id,
        string Provider,
        string Model,
        string? Endpoint,
        double Temperature,
        int MaxTokens,
        int Timeout,
        string Capabilities,
        DateTime CreatedAt);
}
