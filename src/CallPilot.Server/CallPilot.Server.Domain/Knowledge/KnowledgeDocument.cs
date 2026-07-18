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

    /// <summary>
    /// Async LLM enrichment state, independent of <see cref="ProcessingStatus"/>.
    /// The main pipeline (extract → chunk → embed) tracks its own phase via
    /// <see cref="ProcessingStatus"/>; enrichment is a separate, post-Indexed
    /// background pass that produces richer product cards.
    /// Allowed values: null (not started / fast mode), "indexed" (queued),
    /// "enriching" (LLM pass in flight), "enriched" (done), "enrichment_failed".
    /// </summary>
    public string? EnrichmentStatus { get; private set; }

    /// <summary>
    /// Ingest path used to process this document.  "fast" = in-process
    /// Docnet/paragraph chunker; "structured" = Python AI Engine (Docling
    /// + LLM enrichment).  Default null for legacy rows.  The frontend
    /// uses this to decide whether the LLM enrichment column is "Skipped".
    /// </summary>
    public string? Mode { get; private set; }

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

    public void SetEnrichmentStatus(string? status)
    {
        EnrichmentStatus = status;
        UpdatedAt = DateTime.UtcNow;
    }

    public void SetMode(string mode)
    {
        Mode = mode;
    }
}
