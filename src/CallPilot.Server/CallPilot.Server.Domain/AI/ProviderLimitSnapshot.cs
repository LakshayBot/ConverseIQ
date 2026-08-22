using CallPilot.Server.Domain.Providers;
using CallPilot.Server.Domain.Users;

namespace CallPilot.Server.Domain.AI;

/// <summary>
/// Last-known rate-limit / quota headers captured from a provider response.
///
/// Providers advertise limits via response headers (e.g. Groq
/// x-ratelimit-*).  Treat these as a snapshot, never as guaranteed
/// permanent account limits.  Each row is one provider config + one
/// captured point in time.
/// </summary>
public class ProviderLimitSnapshot
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid ProviderConfigurationId { get; private set; }
    /// <summary>Raw snapshot dict (jsonb), e.g. {"limit_tokens":8000,...}.</summary>
    public string SnapshotJson { get; private set; }
    public DateTime CapturedAt { get; private set; }

    public User User { get; private set; } = null!;
    public ProviderConfiguration ProviderConfiguration { get; private set; } = null!;

    private ProviderLimitSnapshot() { }

    public ProviderLimitSnapshot(Guid userId, Guid providerConfigurationId, string snapshotJson)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        ProviderConfigurationId = providerConfigurationId;
        SnapshotJson = snapshotJson;
        CapturedAt = DateTime.UtcNow;
    }
}
