using CallPilot.Server.Domain.Providers;
using CallPilot.Server.Domain.Users;

namespace CallPilot.Server.Domain.AI;

/// <summary>
/// Locally-tracked usage of a user-provided provider key by CallPilot.
///
/// This is distinct from the provider account itself: it records only
/// requests CallPilot made through that key.  Fields are best-effort -
/// providers that do not report token usage leave the token columns null.
/// EstimatedCostUsd is optional and clearly labelled as an estimate.
/// </summary>
public class AiUsageLog
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid? ProviderConfigurationId { get; private set; }
    public string ProviderType { get; private set; } = "unknown";
    public string? Model { get; private set; }
    /// <summary>Which feature used this call, e.g. "knowledge_processing".</summary>
    public string? Feature { get; private set; }
    public DateTime RequestedAt { get; private set; }
    public int? InputTokens { get; private set; }
    public int? OutputTokens { get; private set; }
    public int? TotalTokens { get; private set; }
    public bool Success { get; private set; }
    public int DurationMs { get; private set; }
    /// <summary>Optional estimated USD cost; null when not computed.</summary>
    public decimal? EstimatedCostUsd { get; private set; }
    /// <summary>Optional (mapped, not raw) error code, e.g. "rate_limit_reached".</summary>
    public string? ErrorCode { get; private set; }
    /// <summary>Optional document the call belonged to (usage provenance).</summary>
    public Guid? DocumentId { get; private set; }
    public int? PageNumber { get; private set; }

    public User User { get; private set; } = null!;
    public ProviderConfiguration? ProviderConfiguration { get; private set; }

    private AiUsageLog() { }

    public AiUsageLog(
        Guid userId,
        Guid? providerConfigurationId,
        string providerType,
        string? model,
        string? feature)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        ProviderConfigurationId = providerConfigurationId;
        ProviderType = providerType;
        Model = model;
        Feature = feature;
        RequestedAt = DateTime.UtcNow;
    }

    public void Record(
        int? inputTokens,
        int? outputTokens,
        int? totalTokens,
        bool success,
        int durationMs,
        decimal? estimatedCostUsd = null,
        string? errorCode = null,
        Guid? documentId = null,
        int? pageNumber = null)
    {
        InputTokens = inputTokens;
        OutputTokens = outputTokens;
        TotalTokens = totalTokens;
        Success = success;
        DurationMs = durationMs;
        EstimatedCostUsd = estimatedCostUsd;
        ErrorCode = errorCode;
        DocumentId = documentId;
        PageNumber = pageNumber;
    }
}
