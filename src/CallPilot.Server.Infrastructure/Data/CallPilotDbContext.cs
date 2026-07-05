using CallPilot.Server.Application;
using CallPilot.Server.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Infrastructure.Data;

public class CallPilotDbContext : DbContext, IApplicationDbContext
{
    public CallPilotDbContext(DbContextOptions<CallPilotDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<ProviderConfiguration> ProviderConfigurations => Set<ProviderConfiguration>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).HasMaxLength(256).IsRequired();
            e.Property(u => u.PasswordHash).IsRequired();
            e.Property(u => u.DisplayName).HasMaxLength(128).IsRequired();
            e.HasQueryFilter(u => u.DeletedAt == null);
        });

        modelBuilder.Entity<ProviderConfiguration>(e =>
        {
            e.HasKey(p => p.Id);
            e.Property(p => p.Provider).HasMaxLength(64).IsRequired();
            e.Property(p => p.Model).HasMaxLength(128).IsRequired();
            e.Property(p => p.EncryptedApiKey).IsRequired();
            e.HasOne(p => p.User)
                .WithMany(u => u.ProviderConfigurations)
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasQueryFilter(p => p.DeletedAt == null);
        });
    }
}
