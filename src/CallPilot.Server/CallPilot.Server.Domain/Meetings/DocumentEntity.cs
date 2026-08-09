namespace CallPilot.Server.Domain.Meetings;

/// <summary>
/// An entity extracted from a document. For EntityType == "product" rows this
/// is ALSO the per-document "extracted product" record: it carries its own
/// enrichment lifecycle (EnrichmentStatus / LastEnrichedAt) so two documents
/// that mention the same product never share processing state, plus a link to
/// the shared, company-scoped <c>ProductIntelligence</c> profile.
/// </summary>
public class DocumentEntity
{
    /// <summary>Classification of non-product entities (identification pass).</summary>
    public static class Category
    {
        public const string Product = "PRODUCT";
        public const string ProductCategory = "PRODUCT_CATEGORY";
        public const string Feature = "FEATURE";
        public const string Component = "COMPONENT";
        public const string Accessory = "ACCESSORY";
        public const string Application = "APPLICATION";
        public const string Specification = "TECHNICAL_SPECIFICATION";
        public const string Other = "OTHER";
    }

    public Guid Id { get; private set; }
    public Guid DocumentId { get; private set; }
    public Guid? ChunkId { get; private set; }
    public string EntityText { get; private set; }
    public string EntityType { get; private set; }
    public double Confidence { get; private set; }
    public DateTime CreatedAt { get; private set; }

    /// <summary>
    /// The LLM classification (see <see cref="Category"/>). Only
    /// <c>PRODUCT</c> entities appear in a document's Product Intelligence
    /// list; the other categories are stored for future intelligence but
    /// never enriched as products. Null for legacy/GLiNER rows.
    /// </summary>
    public string? EntityCategory { get; private set; }

    /// <summary>
    /// Per-document product enrichment status: Pending / Enriching /
    /// Completed / Failed / NeedsReview. Only meaningful for product rows;
    /// keeps each document's processing state independent even when the
    /// same product is shared at the knowledge-base level.
    /// </summary>
    public string? EnrichmentStatus { get; private set; }

    public DateTime? LastEnrichedAt { get; private set; }

    /// <summary>The shared company-scoped intelligence profile for this product.</summary>
    public Guid? ProductIntelligenceId { get; private set; }

    public Knowledge.KnowledgeDocument? Document { get; private set; }
    public Knowledge.KnowledgeChunk? Chunk { get; private set; }
    public Products.ProductIntelligence? ProductIntelligence { get; private set; }

    private DocumentEntity() { }

    public DocumentEntity(
        Guid documentId,
        Guid? chunkId,
        string entityText,
        string entityType,
        double confidence,
        string? entityCategory = null)
    {
        Id = Guid.NewGuid();
        DocumentId = documentId;
        ChunkId = chunkId;
        EntityText = entityText.ToLowerInvariant().Trim();
        EntityType = entityType;
        Confidence = confidence;
        EntityCategory = entityCategory;
        CreatedAt = DateTime.UtcNow;
    }

    public void SetEnrichmentStatus(string? status, DateTime? lastEnrichedAt = null, Guid? productIntelligenceId = null)
    {
        EnrichmentStatus = status;
        if (lastEnrichedAt is not null) LastEnrichedAt = lastEnrichedAt;
        if (productIntelligenceId is not null) ProductIntelligenceId = productIntelligenceId;
    }

    public void SetEntityCategory(string category)
    {
        EntityCategory = category;
    }

    public void SetEntityType(string entityType)
    {
        EntityType = entityType;
    }
}
