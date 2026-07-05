using CallPilot.Server.Application;
using CallPilot.Server.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Infrastructure.Data;

public class CallPilotDbContext : DbContext, IApplicationDbContext
{
    public CallPilotDbContext(DbContextOptions<CallPilotDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<ProviderConfiguration> ProviderConfigurations => Set<ProviderConfiguration>();
    public DbSet<Meeting> Meetings => Set<Meeting>();
    public DbSet<TranscriptSegment> TranscriptSegments => Set<TranscriptSegment>();
    public DbSet<KnowledgeDocument> KnowledgeDocuments => Set<KnowledgeDocument>();
    public DbSet<KnowledgeChunk> KnowledgeChunks => Set<KnowledgeChunk>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasPostgresExtension("vector");

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

        modelBuilder.Entity<Meeting>(e =>
        {
            e.HasKey(m => m.Id);
            e.Property(m => m.State).HasMaxLength(64).IsRequired();
            e.HasOne(m => m.User)
                .WithMany()
                .HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasQueryFilter(m => m.DeletedAt == null);
        });

        modelBuilder.Entity<TranscriptSegment>(e =>
        {
            e.HasKey(t => t.Id);
            e.HasIndex(t => new { t.MeetingId, t.Sequence });
            e.HasOne(t => t.Meeting)
                .WithMany(m => m.TranscriptSegments)
                .HasForeignKey(t => t.MeetingId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<KnowledgeDocument>(e =>
        {
            e.HasKey(d => d.Id);
            e.Property(d => d.FileName).HasMaxLength(512).IsRequired();
            e.Property(d => d.ContentType).HasMaxLength(128).IsRequired();
            e.Property(d => d.ProcessingStatus).HasMaxLength(32).IsRequired();
            e.HasOne(d => d.User)
                .WithMany()
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasQueryFilter(d => d.DeletedAt == null);
        });

        modelBuilder.Entity<KnowledgeChunk>(e =>
        {
            e.HasKey(c => c.Id);
            e.HasOne(c => c.Document)
                .WithMany(d => d.Chunks)
                .HasForeignKey(c => c.DocumentId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
