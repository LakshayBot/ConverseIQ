using System.Collections.Concurrent;
using CallPilot.Server.Domain.Integrations;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Infrastructure.Integrations;

/// <summary>
/// Background consumer for the Slack notification queue — mirrors
/// ProductIntelWorker (fresh scope per request, single serialized consumer,
/// errors never crash the worker). Enforces a ≥400ms spacing between posts
/// per workspace so a live-call signal storm can never trip Slack's
/// per-method rate limit (~1 req/s sustained for chat.postMessage).
/// </summary>
public class SlackWorker : BackgroundService
{
    private static readonly TimeSpan MinPostInterval = TimeSpan.FromMilliseconds(400);

    private readonly ISlackQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SlackWorker> _logger;
    private readonly ConcurrentDictionary<string, DateTime> _lastPostAt = new();
    private readonly ConcurrentDictionary<string, byte> _rateLimitedOnce = new();

    public SlackWorker(
        ISlackQueue queue,
        IServiceScopeFactory scopeFactory,
        ILogger<SlackWorker> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Slack notification worker started");
        while (!stoppingToken.IsCancellationRequested)
        {
            var notification = await _queue.DequeueAsync(stoppingToken);
            if (notification is null) break;

            try
            {
                await ProcessAsync(notification);
            }
            catch (Exception ex)
            {
                // A bad Slack message must never affect the audio pipeline or
                // crash the worker — log and continue with the next item.
                _logger.LogWarning(ex, "Slack notification processing failed ({Type})",
                    notification.GetType().Name);
            }
        }
        _logger.LogInformation("Slack notification worker stopped");
    }

    /// <summary>Public + virtual so tests can drive one notification directly.</summary>
    public virtual async Task ProcessAsync(SlackNotification notification)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();
        var client = scope.ServiceProvider.GetRequiredService<SlackApiClient>();
        var builder = scope.ServiceProvider.GetRequiredService<ISlackMessageBuilderService>();

        var integration = await dbContext.SlackIntegrations
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == notification.UserId);
        if (integration is null || !integration.IsActive)
        {
            _logger.LogDebug("Slack notification skipped: user {UserId} has no active integration",
                notification.UserId);
            return;
        }

        // Per-type toggle gate — skip silently when the type is off.
        if (!IsEnabled(integration, notification))
        {
            _logger.LogDebug("Slack notification skipped: {Type} notifications disabled for user {UserId}",
                notification.GetType().Name, notification.UserId);
            return;
        }

        var (blocks, text, product) = builder.Build(notification, integration.DefaultChannelId);

        // BuyerCompany: enqueue sites don't load the meeting (hot path) — the
        // worker resolves it here and fills it in when unset.
        var buyerCompany = notification switch
        {
            BattleCardNotification bc => bc.BuyerCompany,
            SummaryNotification s => s.BuyerCompany,
            ActionItemsNotification ai => ai.BuyerCompany,
            _ => null,
        };
        if (string.IsNullOrWhiteSpace(buyerCompany))
        {
            var meeting = await dbContext.Meetings
                .AsNoTracking()
                .Where(m => m.Id == notification.MeetingId)
                .Select(m => new { m.BuyerCompany })
                .FirstOrDefaultAsync();
            buyerCompany = meeting?.BuyerCompany;
        }

        // Resolve the channel: deal channel when a product is present,
        // otherwise the integration's default channel (or nothing to post to).
        string? channelId;
        if (product is not null)
        {
            var channelName = SlackChannelName.From(product, buyerCompany);
            channelId = await client.FindOrCreateChannelAsync(notification.UserId, channelName);
        }
        else if (!string.IsNullOrWhiteSpace(integration.DefaultChannelId))
        {
            channelId = integration.DefaultChannelId;
        }
        else
        {
            _logger.LogDebug("Slack notification skipped: no deal channel resolvable (no product, no default) for user {UserId}",
                notification.UserId);
            return;
        }

        // ── Per-workspace pacing (≥ MinPostInterval between posts) ─────────
        var teamKey = integration.TeamId;
        if (_lastPostAt.TryGetValue(teamKey, out var last))
        {
            var since = DateTime.UtcNow - last;
            if (since < MinPostInterval)
            {
                await Task.Delay(MinPostInterval - since);
            }
        }
        _lastPostAt[teamKey] = DateTime.UtcNow;

        try
        {
            await client.PostMessageAsync(notification.UserId, channelId, blocks, text);
            _rateLimitedOnce.TryRemove(teamKey, out _);
        }
        catch (SlackApiException ex) when (ex.IsRateLimited && !notification.IsRetry)
        {
            // Basic 429 backoff: re-enqueue ONCE (no unbounded retry loops).
            _logger.LogWarning("Slack rate limited for team {TeamId} — re-enqueueing once", teamKey);
            _rateLimitedOnce.TryAdd(teamKey, 0);
            await Task.Delay(2000); // simple backoff; Slack's Retry-After ≈ 1s+
            _queue.Enqueue(notification with { IsRetry = true });
        }
    }

    private static bool IsEnabled(SlackIntegration integration, SlackNotification notification)
        => notification switch
        {
            BattleCardNotification => integration.NotifyBattleCards,
            LiveSignalNotification => integration.NotifyLiveSignals,
            SummaryNotification => integration.NotifySummary,
            ActionItemsNotification => integration.NotifyActionItems,
            _ => true,
        };
}

/// <summary>
/// Builds (blocks, fallback text, product) per notification type. Registered
/// scoped so test doubles can replace it; wraps the static
/// SlackMessageBuilder in the shape the worker needs.
/// </summary>
public interface ISlackMessageBuilderService
{
    (object[] Blocks, string? Text, string? Product) Build(
        SlackNotification notification, string? defaultChannelId);
}

public class SlackMessageBuilderService : ISlackMessageBuilderService
{
    public (object[] Blocks, string? Text, string? Product) Build(
        SlackNotification notification, string? defaultChannelId)
    {
        switch (notification)
        {
            case BattleCardNotification b:
                var battle = SlackMessageBuilder.BuildBattleCardMessage(b);
                return (battle, $"Battle card · {b.Product}", b.Product);

            case LiveSignalNotification s:
                var signal = SlackMessageBuilder.BuildLiveSignalMessage(s);
                var product = s.EventType == "ProductMentioned" ? s.EntityName : null;
                return (signal, $"{s.EventType} detected", product);

            case SummaryNotification sum:
                var summaryBlocks = SlackMessageBuilder.BuildSummaryMessage(sum);
                return (summaryBlocks, "Call summary", null);

            case ActionItemsNotification ai:
                var actionBlocks = SlackMessageBuilder.BuildActionItemsMessage(ai);
                return (actionBlocks, "Action items", null);

            default:
                return (Array.Empty<object>(), null, null);
        }
    }
}
