using CallPilot.Server.Domain.Integrations;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Shared.Abstractions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Integrations;

/// <summary>Shape of Slack's oauth.v2.access response (subset we persist).</summary>
public class SlackOAuthResponse
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? AccessToken { get; set; }
    public SlackOAuthTeam? Team { get; set; }
    public SlackOAuthBot? Bot { get; set; }
}

public class SlackOAuthTeam
{
    public string? Id { get; set; }
    public string? Name { get; set; }
}

public class SlackOAuthBot
{
    public string? UserId { get; set; }
}

/// <summary>
/// Owns the SlackIntegration row: saves (encrypted), reads (decrypted, for
/// outbound Slack calls only), and reports connection state. Mirrors the
/// BYOK provider pattern — the plaintext token exists in memory only for the
/// duration of an outbound call and is never returned to any client.
/// </summary>
public class SlackTokenService
{
    private readonly CallPilotDbContext _dbContext;
    private readonly IApiKeyEncryptionService _encryption;
    private readonly ILogger<SlackTokenService> _logger;

    public SlackTokenService(
        CallPilotDbContext dbContext,
        IApiKeyEncryptionService encryption,
        ILogger<SlackTokenService> logger)
    {
        _dbContext = dbContext;
        _encryption = encryption;
        _logger = logger;
    }

    /// <summary>Encrypts and upserts the integration row after a successful
    /// OAuth install (a re-install replaces credentials in place).</summary>
    public async Task<SlackIntegration> SaveTokenAsync(Guid userId, SlackOAuthResponse oauth)
    {
        var encrypted = _encryption.Encrypt(oauth.AccessToken
            ?? throw new InvalidOperationException("OAuth response has no access token"));

        var integration = await _dbContext.SlackIntegrations
            .FirstOrDefaultAsync(s => s.UserId == userId);

        if (integration is null)
        {
            integration = new SlackIntegration(
                userId, encrypted,
                oauth.Team?.Id ?? string.Empty,
                oauth.Team?.Name ?? "Slack workspace",
                oauth.Bot?.UserId ?? string.Empty,
                defaultChannelId: null);
            _dbContext.SlackIntegrations.Add(integration);
        }
        else
        {
            integration.UpdateCredentials(encrypted,
                oauth.Team?.Id ?? integration.TeamId,
                oauth.Team?.Name ?? integration.TeamName,
                oauth.Bot?.UserId ?? integration.BotUserId);
        }

        await _dbContext.SaveChangesAsync();
        _logger.LogInformation("Slack integration saved for user {UserId} (team {TeamId})",
            userId, integration.TeamId);
        return integration;
    }

    /// <summary>Decrypts the stored bot token for an outbound Slack call.
    /// Returns null when the user has no active integration.</summary>
    public async Task<string?> GetDecryptedTokenAsync(Guid userId)
    {
        var integration = await _dbContext.SlackIntegrations
            .FirstOrDefaultAsync(s => s.UserId == userId && s.IsActive);
        if (integration is null) return null;

        try
        {
            return _encryption.Decrypt(integration.EncryptedBotToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to decrypt Slack token for user {UserId}", userId);
            return null;
        }
    }

    public Task<bool> IsConnectedAsync(Guid userId) =>
        _dbContext.SlackIntegrations.AnyAsync(s => s.UserId == userId && s.IsActive);

    public async Task<SlackIntegration?> GetAsync(Guid userId) =>
        await _dbContext.SlackIntegrations.FirstOrDefaultAsync(s => s.UserId == userId);
}
