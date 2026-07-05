using CallPilot.Server.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application;

public interface IApplicationDbContext
{
    DbSet<User> Users { get; }
    DbSet<ProviderConfiguration> ProviderConfigurations { get; }
    DbSet<Meeting> Meetings { get; }
    DbSet<TranscriptSegment> TranscriptSegments { get; }
    DbSet<KnowledgeDocument> KnowledgeDocuments { get; }
    DbSet<KnowledgeChunk> KnowledgeChunks { get; }
    DbSet<ConversationEvent> ConversationEvents { get; }
    DbSet<Recommendation> Recommendations { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
