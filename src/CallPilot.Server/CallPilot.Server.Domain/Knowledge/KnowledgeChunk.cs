namespace CallPilot.Server.Domain.Knowledge;

public class KnowledgeChunk
{
    public Guid Id { get; private set; }
    public Guid DocumentId { get; private set; }
    public int ChunkIndex { get; private set; }
    public string Text { get; private set; }
    public int TokenCount { get; private set; }
    public int CharOffset { get; private set; }
    public int CharLength { get; private set; }
    public DateTime CreatedAt { get; private set; }

    public KnowledgeDocument Document { get; private set; } = null!;
    public Embedding? Embedding { get; private set; }

    private KnowledgeChunk() { }

    public KnowledgeChunk(Guid documentId, int chunkIndex, string text, int tokenCount, int charOffset, int charLength)
    {
        Id = Guid.NewGuid();
        DocumentId = documentId;
        ChunkIndex = chunkIndex;
        Text = text;
        TokenCount = tokenCount;
        CharOffset = charOffset;
        CharLength = charLength;
        CreatedAt = DateTime.UtcNow;
    }
}
