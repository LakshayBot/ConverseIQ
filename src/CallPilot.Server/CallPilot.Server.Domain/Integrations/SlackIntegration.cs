namespace CallPilot.Server.Domain.Integrations;

/// <summary>
/// A user's Slack workspace connection. Per-user for now (no workspace/tenant
/// entity exists) — the Slack OAuth install is performed by one user and the
/// bot token is scoped to their workspace. Credential storage mirrors
/// ProviderConfiguration: the bot token is AES-256 encrypted via
/// IApiKeyEncryptionService and NEVER returned to any client in plaintext.
/// </summary>
public class SlackIntegration
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }

    /// <summary>xoxb-… bot token, AES-256 encrypted (IV-prefixed base64).</summary>
    public string EncryptedBotToken { get; private set; } = string.Empty;

    /// <summary>Slack workspace team id (from oauth.v2.access).</summary>
    public string TeamId { get; private set; } = string.Empty;

    /// <summary>Workspace display name (from oauth.v2.access team.name).</summary>
    public string TeamName { get; private set; } = string.Empty;

    /// <summary>The app's bot user id (from oauth.v2.access bot_user_id).</summary>
    public string BotUserId { get; private set; } = string.Empty;

    /// <summary>Optional pre-existing channel to post into when no deal channel resolves.</summary>
    public string? DefaultChannelId { get; private set; }

    public bool IsActive { get; private set; }
    public DateTime InstalledAt { get; private set; }

    // ── Per-notification-type toggles (all default true) ────────────────────
    public bool NotifyBattleCards { get; private set; } = true;
    public bool NotifyLiveSignals { get; private set; } = true;
    public bool NotifySummary { get; private set; } = true;
    public bool NotifyActionItems { get; private set; } = true;

    private SlackIntegration() { }

    public SlackIntegration(
        Guid userId,
        string encryptedBotToken,
        string teamId,
        string teamName,
        string botUserId,
        string? defaultChannelId)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        EncryptedBotToken = encryptedBotToken;
        TeamId = teamId;
        TeamName = teamName;
        BotUserId = botUserId;
        DefaultChannelId = defaultChannelId;
        IsActive = true;
        InstalledAt = DateTime.UtcNow;
    }

    /// <summary>Upsert semantics: a re-install replaces credentials in place.</summary>
    public void UpdateCredentials(
        string encryptedBotToken,
        string teamId,
        string teamName,
        string botUserId)
    {
        EncryptedBotToken = encryptedBotToken;
        TeamId = teamId;
        TeamName = teamName;
        BotUserId = botUserId;
        IsActive = true;
        InstalledAt = DateTime.UtcNow;
    }

    public void SetDefaultChannel(string? channelId) => DefaultChannelId = channelId;

    public void Revoke() => IsActive = false;

    public void SetToggles(bool battleCards, bool liveSignals, bool summary, bool actionItems)
    {
        NotifyBattleCards = battleCards;
        NotifyLiveSignals = liveSignals;
        NotifySummary = summary;
        NotifyActionItems = actionItems;
    }
}
