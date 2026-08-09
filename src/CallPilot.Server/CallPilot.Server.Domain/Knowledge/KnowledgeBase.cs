namespace CallPilot.Server.Domain.Knowledge;

/// <summary>
/// A company-scoped knowledge base. Groups the user's documents AND their
/// product intelligence under one company identity, so two companies that
/// happen to share a product name ("Sprint 210") never get their product
/// intelligence mixed together.
///
/// The company context collected here (CompanyName, Website, Description)
/// is used to scope and disambiguate the Tavily research performed for the
/// products discovered in the uploaded documentation.
/// </summary>
public class KnowledgeBase
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }

    /// <summary>User-facing name of this knowledge base (e.g. "Secure Meters Products").</summary>
    public string Name { get; private set; }

    /// <summary>The owning company (e.g. "Secure Meters"). Product research is scoped by this.</summary>
    public string CompanyName { get; private set; }

    public string? Website { get; private set; }
    public string? Description { get; private set; }

    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }

    public ICollection<KnowledgeDocument> Documents { get; private set; } = new List<KnowledgeDocument>();

    private KnowledgeBase()
    {
        Name = string.Empty;
        CompanyName = string.Empty;
    }

    public KnowledgeBase(Guid userId, string name, string companyName, string? website, string? description)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        Name = name;
        CompanyName = companyName;
        Website = website;
        Description = description;
        CreatedAt = DateTime.UtcNow;
    }

    public void Update(string name, string companyName, string? website, string? description)
    {
        Name = name;
        CompanyName = companyName;
        Website = website;
        Description = description;
        UpdatedAt = DateTime.UtcNow;
    }
}
