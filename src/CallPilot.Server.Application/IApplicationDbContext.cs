using CallPilot.Server.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application;

public interface IApplicationDbContext
{
    DbSet<User> Users { get; }
    DbSet<ProviderConfiguration> ProviderConfigurations { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
