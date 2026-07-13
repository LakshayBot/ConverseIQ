namespace CallPilot.Server.Domain.Meetings;

public class DocumentEntity
{
    public Guid Id { get; private set; }
    public Guid DocumentId { get; private set; }
    public Guid? ChunkId { get; private set; }
    public string EntityText { get; private set; }
    public string EntityType { get; private set; }
    public double Confidence { get; private set; }
    public DateTime CreatedAt { get; private set; }

    public Knowledge.KnowledgeDocument? Document { get; private set; }
    public Knowledge.KnowledgeChunk? Chunk { get; private set; }

    private DocumentEntity() { }

    public DocumentEntity(
        Guid documentId,
        Guid? chunkId,
        string entityText,
        string entityType,
        double confidence)
    {
        Id = Guid.NewGuid();
        DocumentId = documentId;
        ChunkId = chunkId;
        EntityText = entityText.ToLowerInvariant().Trim();
        EntityType = entityType;
        Confidence = confidence;
        CreatedAt = DateTime.UtcNow;
    }
}
