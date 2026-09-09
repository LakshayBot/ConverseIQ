using System.Threading.Channels;

namespace CallPilot.Server.Infrastructure.Integrations;

/// <summary>Structured action item as stored in the summary blob (matches
/// the LocalSummary schema from the desktop summarizer).</summary>
public sealed record ActionItemDto(
    string Title,
    string Assignee,
    string Priority,
    string Source);

/// <summary>
/// Fire-and-forget Slack notifications. Enqueued from the DesktopAgentHub,
/// the /process endpoint and the summary PUT handler — Enqueue never blocks
/// and never throws into the audio pipeline (same contract as
/// ProductIntelQueue). Consumed by SlackWorker.
/// </summary>
public interface ISlackQueue
{
    void Enqueue(SlackNotification notification);
    ValueTask<SlackNotification?> DequeueAsync(CancellationToken cancellationToken);
}

public abstract record SlackNotification
{
    public Guid UserId { get; init; }
    public Guid MeetingId { get; init; }
    /// <summary>Retry bookkeeping: 429 responses re-enqueue once.</summary>
    public bool IsRetry { get; init; }
}

public sealed record BattleCardNotification : SlackNotification
{
    public Guid RecommendationId { get; init; }
    public string Product { get; init; } = string.Empty;
    public string? BuyerCompany { get; init; }
    public string? TalkingPoint { get; init; }
    public string TriggerType { get; init; } = "keyword";
    public string? TriggerSpan { get; init; }
    public string? Priority { get; init; }
    public double Confidence { get; init; }
    public List<string>? References { get; init; }
}

public sealed record LiveSignalNotification : SlackNotification
{
    public string EventType { get; init; } = string.Empty;
    public string? EntityName { get; init; }
    public string? SupportingTranscript { get; init; }
    public double Confidence { get; init; }
}

public sealed record SummaryNotification : SlackNotification
{
    /// <summary>Raw SummaryJson blob — the worker parses `data`.</summary>
    public string SummaryJson { get; init; } = string.Empty;
    public string? BuyerCompany { get; init; }
}

public sealed record ActionItemsNotification : SlackNotification
{
    public string? BuyerCompany { get; init; }
    public List<ActionItemDto> ActionItems { get; init; } = [];
}

/// <summary>Unbounded channel queue — mirrors ProductIntelQueue exactly.</summary>
public class SlackQueue : ISlackQueue
{
    private readonly Channel<SlackNotification> _channel =
        Channel.CreateUnbounded<SlackNotification>(new UnboundedChannelOptions
        {
            SingleReader = true, // SlackWorker is the single consumer
        });

    public void Enqueue(SlackNotification notification)
    {
        if (notification is null) return;
        // Never throw into the calling pipeline — a full/closed channel just
        // drops the notification (storms are preferable to blocking audio).
        if (_channel.Writer.TryWrite(notification))
        {
            Interlocked.Increment(ref _approxPending);
        }
    }

    private int _approxPending;

    /// <summary>Test/diagnostics hook: approximate queued item count
    /// (UnboundedChannelReader does not support Count).</summary>
    public int PendingCount => _approxPending;

    public async ValueTask<SlackNotification?> DequeueAsync(CancellationToken cancellationToken)
    {
        try
        {
            var notification = await _channel.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);
            Interlocked.Decrement(ref _approxPending);
            return notification;
        }
        catch (ChannelClosedException)
        {
            return null;
        }
        catch (OperationCanceledException)
        {
            return null;
        }
    }
}
