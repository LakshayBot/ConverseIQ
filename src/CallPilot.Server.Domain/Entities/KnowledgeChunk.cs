namespace CallPilot.Server.Domain.Entities;

public class KnowledgeChunk
{
    public Guid Id { get; set; }
    public Guid DocumentId { get; set; }
    public int ChunkIndex { get; set; }
    public string Text { get; set; } = string.Empty;
    public int TokenCount { get; set; }
    public int CharStart { get; set; }
    public int CharEnd { get; set; }
    public DateTime CreatedAt { get; set; }

    public KnowledgeDocument Document { get; set; } = null!;
}
