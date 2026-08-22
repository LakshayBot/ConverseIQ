using CallPilot.Server.Domain.Providers;
using CallPilot.Server.Domain.Users;

namespace CallPilot.Server.Domain.AI;

/// <summary>
/// Per-user selection of which provider + model serves a given AI feature.
///
/// The first feature is <c>knowledge_processing</c> (product extraction,
/// vision captioning, product-research extraction).  The table is one row
/// per (UserId, Feature) so the same machinery can later express
/// <c>meeting_intelligence</c>, <c>summary</c>, etc. without a schema change.
/// </summary>
public class UserFeaturePreference
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    /// <summary>Machine name of the feature, e.g. "knowledge_processing".</summary>
    public string Feature { get; private set; }

    /// <summary>Which connected provider uses the key (nullable = no preference yet).</summary>
    public Guid? ProviderConfigurationId { get; private set; }
    /// <summary>Selected model for this feature (nullable = provider default).</summary>
    public string? Model { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    public User User { get; private set; } = null!;
    public ProviderConfiguration? ProviderConfiguration { get; private set; }

    private UserFeaturePreference() { }

    public UserFeaturePreference(Guid userId, string feature)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        Feature = feature;
        UpdatedAt = DateTime.UtcNow;
    }

    public void Select(Guid? providerConfigurationId, string? model)
    {
        ProviderConfigurationId = providerConfigurationId;
        Model = model;
        UpdatedAt = DateTime.UtcNow;
    }
}
