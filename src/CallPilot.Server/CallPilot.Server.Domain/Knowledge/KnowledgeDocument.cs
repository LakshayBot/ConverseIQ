using CallPilot.Server.Domain.Meetings;

namespace CallPilot.Server.Domain.Knowledge;

public class KnowledgeDocument
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string FileName { get; private set; }
    public string ContentType { get; private set; }
    public long FileSizeBytes { get; private set; }
    public string ProcessingStatus { get; private set; }
    public string? StoragePath { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    public ICollection<KnowledgeChunk> Chunks { get; private set; } = new List<KnowledgeChunk>();
    public ICollection<DocumentEntity> DocumentEntities { get; private set; } = new List<DocumentEntity>();

    private KnowledgeDocument() { }

    public KnowledgeDocument(Guid userId, string fileName, string contentType, long fileSizeBytes)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        FileName = fileName;
        ContentType = contentType;
        FileSizeBytes = fileSizeBytes;
        ProcessingStatus = "Uploaded";
        CreatedAt = DateTime.UtcNow;
    }

    public void SetStoragePath(string path)
    {
        StoragePath = path;
    }

    public void SetProcessingStatus(string status)
    {
        ProcessingStatus = status;
        UpdatedAt = DateTime.UtcNow;
    }
}
