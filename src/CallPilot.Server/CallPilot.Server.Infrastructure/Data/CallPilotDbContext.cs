using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Domain.Providers;
using CallPilot.Server.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Infrastructure.Data;

public class CallPilotDbContext : DbContext
{
    public CallPilotDbContext(DbContextOptions<CallPilotDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<ProviderConfiguration> ProviderConfigurations => Set<ProviderConfiguration>();
    public DbSet<Meeting> Meetings => Set<Meeting>();
    public DbSet<TranscriptSegment> TranscriptSegments => Set<TranscriptSegment>();
    public DbSet<KnowledgeDocument> KnowledgeDocuments => Set<KnowledgeDocument>();
    public DbSet<CallPilot.Server.Domain.Knowledge.KnowledgeBase> KnowledgeBases => Set<CallPilot.Server.Domain.Knowledge.KnowledgeBase>();
    public DbSet<KnowledgeChunk> KnowledgeChunks => Set<KnowledgeChunk>();
    public DbSet<CallPilot.Server.Domain.Knowledge.Embedding> Embeddings => Set<CallPilot.Server.Domain.Knowledge.Embedding>();
    public DbSet<ConversationEvent> ConversationEvents => Set<ConversationEvent>();
    public DbSet<Recommendation> Recommendations => Set<Recommendation>();
    public DbSet<DocumentEntity> DocumentEntities => Set<DocumentEntity>();
    public DbSet<CallPilot.Server.Domain.Products.ProductIntelligence> ProductIntelligences => Set<CallPilot.Server.Domain.Products.ProductIntelligence>();
    public DbSet<CallPilot.Server.Domain.Products.ProductSource> ProductSources => Set<CallPilot.Server.Domain.Products.ProductSource>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(u => u.Id);
            entity.HasIndex(u => u.Email).IsUnique();
            entity.Property(u => u.Email).HasMaxLength(256).IsRequired();
            entity.Property(u => u.PasswordHash).IsRequired();
            entity.HasQueryFilter(u => u.DeletedAt == null);
        });

        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(rt => rt.Id);
            entity.HasIndex(rt => rt.Token).IsUnique();
            entity.Property(rt => rt.Token).HasMaxLength(256).IsRequired();
            entity.HasOne(rt => rt.User)
                  .WithMany(u => u.RefreshTokens)
                  .HasForeignKey(rt => rt.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ProviderConfiguration>(entity =>
        {
            entity.HasKey(pc => pc.Id);
            entity.HasIndex(pc => new { pc.UserId, pc.ProviderType }).IsUnique();
            entity.Property(pc => pc.ProviderType).HasMaxLength(100).IsRequired();
            entity.Property(pc => pc.Model).HasMaxLength(200).IsRequired();
            entity.Property(pc => pc.Endpoint).HasMaxLength(500);
            entity.Property(pc => pc.EncryptedApiKey).HasMaxLength(1000).IsRequired();
            entity.HasOne(pc => pc.User)
                  .WithMany(u => u.ProviderConfigurations)
                  .HasForeignKey(pc => pc.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(pc => pc.DeletedAt == null);
        });

        modelBuilder.Entity<Meeting>(entity =>
        {
            entity.HasKey(m => m.Id);
            entity.HasIndex(m => m.UserId);
            entity.HasIndex(m => m.Status);
            entity.Property(m => m.Status).HasMaxLength(50).IsRequired();
            entity.Property(m => m.Title).HasMaxLength(500);
            entity.Property(m => m.FolderPath).HasMaxLength(1000);
            entity.Property(m => m.SummaryJson).HasColumnType("text");
        });

        modelBuilder.Entity<TranscriptSegment>(entity =>
        {
            entity.HasKey(ts => ts.Id);
            entity.HasIndex(ts => ts.MeetingId);
            entity.HasIndex(ts => new { ts.MeetingId, ts.Sequence });
            entity.Property(ts => ts.Speaker).HasMaxLength(100).IsRequired();
            entity.Property(ts => ts.Text).HasMaxLength(2000).IsRequired();
            entity.HasOne<Meeting>()
                  .WithMany(m => m.TranscriptSegments)
                  .HasForeignKey(ts => ts.MeetingId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CallPilot.Server.Domain.Knowledge.KnowledgeBase>(entity =>
        {
            entity.HasKey(k => k.Id);
            entity.HasIndex(k => k.UserId);
            entity.HasIndex(k => k.CompanyName);
            entity.Property(k => k.Name).HasMaxLength(300).IsRequired();
            entity.Property(k => k.CompanyName).HasMaxLength(300).IsRequired();
            entity.Property(k => k.Website).HasMaxLength(500);
            entity.Property(k => k.Description).HasColumnType("text");
        });

        modelBuilder.Entity<KnowledgeDocument>(entity =>
        {
            entity.HasKey(d => d.Id);
            entity.HasIndex(d => d.UserId);
            entity.HasIndex(d => d.ProcessingStatus);
            entity.HasIndex(d => d.EnrichmentStatus);
            entity.Property(d => d.FileName).HasMaxLength(500).IsRequired();
            entity.Property(d => d.ContentType).HasMaxLength(200).IsRequired();
            entity.Property(d => d.ProcessingStatus).HasMaxLength(200).IsRequired();
            entity.Property(d => d.EnrichmentStatus).HasMaxLength(50);
            entity.Property(d => d.StoragePath).HasMaxLength(1000);
            // Per-stage ingest log (jsonb) - see KnowledgeDocument.RecordStage* methods.
            entity.Property(d => d.StagesJson).HasColumnType("jsonb");
            // Most recent failure across all stages (jsonb).  Cheap read for
            // the dashboard "Errors" tab so it doesn't have to traverse
            // StagesJson for every poll.
            entity.Property(d => d.LastErrorJson).HasColumnType("jsonb");
            // Last response from the AI engine (jsonb) - Docling metadata +
            // LLM enrichment response.  Powers the dashboard "View raw" tab.
            entity.Property(d => d.RawOutputJson).HasColumnType("jsonb");
            // Live enrichment progress (jsonb) - updated by the background
            // enrichment task after each page completes.  Powers the
            // "X/Y pages, Z failed" count on the stepper and the
            // per-page breakdown on the Enrichment pages tab.
            entity.Property(d => d.EnrichmentProgressJson).HasColumnType("jsonb");
            entity.HasOne(d => d.KnowledgeBase)
                  .WithMany(k => k.Documents)
                  .HasForeignKey(d => d.KnowledgeBaseId)
                  .OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(d => d.DeletedAt == null);
        });

        modelBuilder.Entity<KnowledgeChunk>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => c.DocumentId);
            // Non-unique (DocumentId, ChunkIndex) so the enrichment
            // pass can use a generous baseIndex offset to avoid racing
            // with still-pending deletes on the same row.  The unique
            // constraint here was originally added for fast-mode
            // (Docnet) chunks which always arrive in order; structured
            // mode now does a 2-phase replace (delete Docling chunks,
            // insert product cards) and PostgreSQL's per-row unique
            // check can collide with still-queued deletes.
            entity.HasIndex(c => new { c.DocumentId, c.ChunkIndex });
            entity.Property(c => c.Text).HasColumnType("text").IsRequired();
            entity.Property(c => c.SectionHeading).HasMaxLength(500);
            entity.Property(c => c.ChunkType).HasMaxLength(50).IsRequired().HasDefaultValue("paragraph");
            entity.Property(c => c.MetadataJson).HasColumnType("jsonb");
            // Where the chunk came from: "fast" | "structured" | "enriched".
            // Used by the dashboard Chunks tab to split the list.
            entity.Property(c => c.Source).HasMaxLength(16).IsRequired().HasDefaultValue("fast");
            // GIN index on the JSONB metadata so structured filters (e.g.
            // metadata->>'section_heading') stay fast as the table grows.
            entity.HasIndex(c => c.MetadataJson).HasMethod("gin");
            entity.HasOne(c => c.Document)
                  .WithMany(d => d.Chunks)
                  .HasForeignKey(c => c.DocumentId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DocumentEntity>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.DocumentId);
            entity.HasIndex(e => new { e.EntityText, e.EntityType });
            entity.HasIndex(e => e.ProductIntelligenceId);
            entity.Property(e => e.EntityText).HasMaxLength(300).IsRequired();
            entity.Property(e => e.EntityType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.EntityCategory).HasMaxLength(40);
            entity.Property(e => e.EnrichmentStatus).HasMaxLength(30);
            entity.HasOne(e => e.Document)
                  .WithMany(d => d.DocumentEntities)
                  .HasForeignKey(e => e.DocumentId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Chunk)
                  .WithMany()
                  .HasForeignKey(e => e.ChunkId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.ProductIntelligence)
                  .WithMany()
                  .HasForeignKey(e => e.ProductIntelligenceId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<CallPilot.Server.Domain.Knowledge.Embedding>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.ChunkId).IsUnique();
            entity.Property(e => e.Model).HasMaxLength(100).IsRequired();
            entity.Property(e => e.VectorData).HasColumnType("text").IsRequired();
            entity.HasOne(e => e.Chunk)
                  .WithOne(c => c.Embedding)
                  .HasForeignKey<CallPilot.Server.Domain.Knowledge.Embedding>(e => e.ChunkId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ConversationEvent>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.MeetingId);
            entity.HasIndex(e => new { e.MeetingId, e.EventType });
            entity.Property(e => e.EventType).HasMaxLength(100).IsRequired();
            entity.Property(e => e.EntityName).HasMaxLength(200);
            entity.Property(e => e.SupportingTranscript).HasMaxLength(1000).IsRequired();
        });

        modelBuilder.Entity<Recommendation>(entity =>
        {
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => r.MeetingId);
            entity.Property(r => r.Type).HasMaxLength(100).IsRequired();
            entity.Property(r => r.Title).HasMaxLength(200).IsRequired();
            entity.Property(r => r.Summary).HasColumnType("text").IsRequired();
            entity.Property(r => r.TalkingPoint).HasColumnType("text");
            entity.Property(r => r.KeyFacts).HasColumnType("jsonb");
            entity.Property(r => r.Priority).HasMaxLength(10);
            entity.Property(r => r.References).HasColumnType("jsonb");
            entity.Property(r => r.TriggerEvent).HasMaxLength(100);
            entity.Property(r => r.Provider).HasMaxLength(50);
            entity.Property(r => r.Model).HasMaxLength(100);
        });

        modelBuilder.Entity<CallPilot.Server.Domain.Products.ProductIntelligence>(entity =>
        {
            entity.HasKey(p => p.Id);
            // Canonical identity scoped by company - the dedup/cache key.
            // Two companies' "Sprint 210" are distinct rows. (PostgreSQL's
            // unique index treats NULL CompanyName as distinct, so legacy
            // global rows coexist with company-scoped ones.)
            entity.HasIndex(p => new { p.CompanyName, p.CanonicalName }).IsUnique();
            entity.HasIndex(p => p.KnowledgeBaseId);
            entity.HasIndex(p => p.Manufacturer);
            entity.HasIndex(p => p.Category);
            entity.HasIndex(p => p.EnrichmentStatus);
            entity.Property(p => p.CanonicalName).HasMaxLength(300).IsRequired();
            entity.Property(p => p.DisplayName).HasMaxLength(300).IsRequired();
            entity.Property(p => p.CompanyName).HasMaxLength(300);
            entity.Property(p => p.Manufacturer).HasMaxLength(300);
            entity.Property(p => p.Category).HasMaxLength(200);
            entity.Property(p => p.Description).HasColumnType("text");
            entity.Property(p => p.WhatItDoes).HasColumnType("text");
            entity.Property(p => p.SearchQuery).HasMaxLength(500);
            entity.Property(p => p.LastError).HasColumnType("text");
            // Structured attributes as jsonb lists, matching the project's
            // jsonb conventions (Recommendation.KeyFacts, Chunk.MetadataJson).
            entity.Property(p => p.UseCases).HasColumnType("jsonb");
            entity.Property(p => p.TargetIndustries).HasColumnType("jsonb");
            entity.Property(p => p.KeyFeatures).HasColumnType("jsonb");
            entity.Property(p => p.KeySpecifications).HasColumnType("jsonb");
            entity.Property(p => p.StandoutPoints).HasColumnType("jsonb");
            entity.Property(p => p.Variants).HasColumnType("jsonb");
            entity.Property(p => p.Limitations).HasColumnType("jsonb");
            entity.HasOne<CallPilot.Server.Domain.Knowledge.KnowledgeBase>()
                  .WithMany()
                  .HasForeignKey(p => p.KnowledgeBaseId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<CallPilot.Server.Domain.Products.ProductSource>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => s.ProductIntelligenceId);
            entity.Property(s => s.Title).HasMaxLength(500).IsRequired();
            entity.Property(s => s.Url).HasMaxLength(1000).IsRequired();
            entity.Property(s => s.Domain).HasMaxLength(300);
            entity.Property(s => s.SourceType).HasMaxLength(50).IsRequired();
            entity.Property(s => s.Snippet).HasColumnType("text");
            entity.HasOne(s => s.ProductIntelligence)
                  .WithMany(p => p.Sources)
                  .HasForeignKey(s => s.ProductIntelligenceId)
                  .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
