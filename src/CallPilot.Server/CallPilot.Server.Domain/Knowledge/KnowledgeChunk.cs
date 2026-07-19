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

    // ── Structure-aware metadata (Phase 1+) ──
    /// <summary>Section heading the chunk belongs to, e.g. "i-Credit 350". Null if none detected.</summary>
    public string? SectionHeading { get; private set; }
    /// <summary>"paragraph" | "bullet_group" | "oversized_paragraph" | "table_row" | "heading" | "list_item" | "product_card".</summary>
    public string ChunkType { get; private set; } = "paragraph";
    /// <summary>1-based page number from the source document. 0 if unknown.</summary>
    public int PageHint { get; private set; }
    /// <summary>JSONB blob with arbitrary metadata (source_mode, pages, bbox, etc.).</summary>
    public string? MetadataJson { get; private set; }

    /// <summary>
    /// Where this chunk came from.  <c>"fast"</c> = in-process Docnet/paragraph
    /// chunker; <c>"structured"</c> = Docling via the AI engine;
    /// <c>"enriched"</c> = LLM-generated product card that replaced a
    /// Docling chunk during the enrichment pass.  Used by the
    /// dashboard to split the Chunks tab by source.
    /// </summary>
    public string Source { get; private set; } = "fast";

    public KnowledgeDocument Document { get; private set; } = null!;
    public Embedding? Embedding { get; private set; }

    private KnowledgeChunk() { }

    public KnowledgeChunk(
        Guid documentId,
        int chunkIndex,
        string text,
        int tokenCount,
        int charOffset,
        int charLength,
        string? sectionHeading = null,
        string chunkType = "paragraph",
        int pageHint = 0,
        string? metadataJson = null,
        string source = "fast")
    {
        Id = Guid.NewGuid();
        DocumentId = documentId;
        ChunkIndex = chunkIndex;
        Text = text;
        TokenCount = tokenCount;
        CharOffset = charOffset;
        CharLength = charLength;
        SectionHeading = sectionHeading;
        ChunkType = chunkType;
        PageHint = pageHint;
        MetadataJson = metadataJson;
        Source = source;
        CreatedAt = DateTime.UtcNow;
    }
}
