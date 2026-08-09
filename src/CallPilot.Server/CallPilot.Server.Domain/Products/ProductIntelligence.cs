namespace CallPilot.Server.Domain.Products;

/// <summary>
/// Global, canonical product intelligence - enriched once from web research
/// (Tavily discovery + LLM structured extraction) and reused across every
/// meeting that mentions the product. The single source of truth for "what
/// is this product" - meeting-specific context lives on the meeting's
/// <c>ConversationEvent</c> mention rows (which reference this entity via
/// <c>ProductIntelligenceId</c>).
///
/// Not user-scoped on purpose: the data is public product information, and
/// the deduplication/caching rule ("enrich once, reuse everywhere") requires
/// a single canonical row per product.
/// </summary>
public class ProductIntelligence
{
    public enum EnrichmentState
    {
        Pending,
        Enriching,
        Completed,
        Failed,
        NeedsReview,
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// The company-scoped knowledge base that owns this product profile
    /// (null for legacy/global rows). Two different companies' products
    /// never share a row - see the unique (CompanyName, CanonicalName) index.
    /// </summary>
    public Guid? KnowledgeBaseId { get; private set; }

    /// <summary>Denormalized owning company for fast scoped lookups and the
    /// (CompanyName, CanonicalName) uniqueness guarantee.</summary>
    public string? CompanyName { get; private set; }

    /// <summary>Normalized identity - lowercase, trimmed, whitespace-collapsed.
    /// Unique together with <see cref="CompanyName"/>.</summary>
    public string CanonicalName { get; private set; }

    /// <summary>Original casing for display (e.g. "Prodigy", "Apex 100").</summary>
    public string DisplayName { get; private set; }

    public string? Manufacturer { get; private set; }
    public string? Category { get; private set; }
    public string? Description { get; private set; }
    public string? WhatItDoes { get; private set; }

    public List<string> UseCases { get; private set; } = [];
    public List<string> TargetIndustries { get; private set; } = [];
    public List<string> KeyFeatures { get; private set; } = [];
    public List<string> KeySpecifications { get; private set; } = [];
    public List<string> StandoutPoints { get; private set; } = [];
    public List<string> Variants { get; private set; } = [];
    public List<string> Limitations { get; private set; } = [];

    /// <summary>The Tavily query that produced the sources (for auditing).</summary>
    public string? SearchQuery { get; private set; }

    public EnrichmentState SearchStatus { get; private set; } = EnrichmentState.Pending;
    public EnrichmentState EnrichmentStatus { get; private set; } = EnrichmentState.Pending;

    public double ConfidenceScore { get; private set; }

    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }
    public DateTime? LastEnrichedAt { get; private set; }
    public string? LastError { get; private set; }

    public ICollection<ProductSource> Sources { get; private set; } = [];

    private ProductIntelligence()
    {
        CanonicalName = string.Empty;
        DisplayName = string.Empty;
    }

    public ProductIntelligence(string canonicalName, string displayName)
        : this(canonicalName, displayName, knowledgeBaseId: null, companyName: null)
    {
    }

    public ProductIntelligence(string canonicalName, string displayName, Guid? knowledgeBaseId, string? companyName)
    {
        Id = Guid.NewGuid();
        CanonicalName = canonicalName;
        DisplayName = displayName;
        KnowledgeBaseId = knowledgeBaseId;
        CompanyName = companyName;
        CreatedAt = DateTime.UtcNow;
    }

    public void MarkEnriching(string? searchQuery)
    {
        SearchQuery = searchQuery;
        SearchStatus = EnrichmentState.Enriching;
        EnrichmentStatus = EnrichmentState.Enriching;
        UpdatedAt = DateTime.UtcNow;
    }

    public void MarkCompleted(ProductEnrichmentResult result)
    {
        DisplayName = string.IsNullOrWhiteSpace(result.DisplayName) ? DisplayName : result.DisplayName;
        Manufacturer = NullIfEmpty(result.Manufacturer);
        Category = NullIfEmpty(result.Category);
        Description = NullIfEmpty(result.Description);
        WhatItDoes = NullIfEmpty(result.WhatItDoes);
        UseCases = result.UseCases;
        TargetIndustries = result.TargetIndustries;
        KeyFeatures = result.KeyFeatures;
        KeySpecifications = result.KeySpecifications;
        StandoutPoints = result.StandoutPoints;
        Variants = result.Variants;
        Limitations = result.Limitations;
        ConfidenceScore = result.ConfidenceScore;
        SearchQuery = result.SearchQuery ?? SearchQuery;
        SearchStatus = result.Sources.Count > 0 ? EnrichmentState.Completed : EnrichmentState.Failed;
        EnrichmentStatus = result.NeedsReview ? EnrichmentState.NeedsReview : EnrichmentState.Completed;
        LastError = null;
        UpdatedAt = DateTime.UtcNow;
        LastEnrichedAt = DateTime.UtcNow;
    }

    public void MarkFailed(string error)
    {
        SearchStatus = EnrichmentState.Failed;
        EnrichmentStatus = EnrichmentState.Failed;
        LastError = error;
        UpdatedAt = DateTime.UtcNow;
        LastEnrichedAt = DateTime.UtcNow;
    }

    private static string? NullIfEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
