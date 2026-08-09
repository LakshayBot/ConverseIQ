namespace CallPilot.Server.Domain.Products;

/// <summary>A traceable source behind a <see cref="ProductIntelligence"/> profile.</summary>
public class ProductSource
{
    public Guid Id { get; private set; }
    public Guid ProductIntelligenceId { get; private set; }

    public string Title { get; private set; }
    public string Url { get; private set; }
    public string? Domain { get; private set; }
    public string SourceType { get; private set; }
    public string? Snippet { get; private set; }
    public double RelevanceScore { get; private set; }
    public DateTime RetrievedAt { get; private set; }

    public ProductIntelligence? ProductIntelligence { get; private set; }

    private ProductSource()
    {
        Title = string.Empty;
        Url = string.Empty;
        SourceType = "search";
    }

    public ProductSource(
        Guid productIntelligenceId,
        string title,
        string url,
        string? domain,
        string sourceType,
        string? snippet,
        double relevanceScore)
    {
        Id = Guid.NewGuid();
        ProductIntelligenceId = productIntelligenceId;
        Title = title;
        Url = url;
        Domain = domain;
        SourceType = sourceType;
        Snippet = snippet;
        RelevanceScore = relevanceScore;
        RetrievedAt = DateTime.UtcNow;
    }
}
