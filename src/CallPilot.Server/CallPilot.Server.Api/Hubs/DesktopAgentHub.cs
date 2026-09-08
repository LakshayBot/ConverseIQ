using System.Collections.Concurrent;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.AI;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Reliability;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Api.Hubs;

[Authorize]
public class DesktopAgentHub : Hub
{
    // Per-meeting rolling debounce: (eventType, entity) → last fire time.
    // Backstop for the engine-side window — duplicates are suppressed here
    // even if the AI engine's debounce is bypassed or an older engine version
    // is in play.
    //
    // The window is configurable via DUPLICATE_EVENT_WINDOW_SECONDS (env /
    // appsettings key DuplicateEventWindowSeconds, default 60) so the e2e
    // feature suite can shrink it to ~2s. Production defaults are unchanged.
    private static readonly ConcurrentDictionary<Guid, ConcurrentDictionary<(string, string?), DateTime>>
        _recentEvents = new();
    private static TimeSpan _eventDebounceWindow = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan DebouncePruneAge = TimeSpan.FromMinutes(2);

    /// <summary>Exposes the window for tests/verification; set once from
    /// configuration on hub construction (first hub instance wins).</summary>
    public static TimeSpan EventDebounceWindow => _eventDebounceWindow;

    private static bool IsDuplicateEvent(Guid meetingId, string eventType, string? entityName)
    {
        var now = DateTime.UtcNow;
        var bucket = _recentEvents.GetOrAdd(meetingId, _ => new ConcurrentDictionary<(string, string?), DateTime>());
        var key = (eventType, entityName);
        if (bucket.TryGetValue(key, out var last) && now - last < EventDebounceWindow)
        {
            return true;
        }
        bucket[key] = now;
        // Bounded memory: purge stale entries once the bucket grows.
        if (bucket.Count > 64)
        {
            foreach (var stale in bucket
                         .Where(kv => now - kv.Value > DebouncePruneAge)
                         .Select(kv => kv.Key)
                         .ToList())
            {
                bucket.TryRemove(stale, out _);
            }
        }
        return false;
    }

    // Per-meeting contextual-match debounce: (userId, chunkId) → last fire
    // time. Same 60s window as keyword events — the same matched chunk must
    // not fire a second contextual card within the window, even if the
    // buyer keeps circling the same topic.
    private static readonly ConcurrentDictionary<(Guid MeetingId, Guid UserId, Guid ChunkId), DateTime>
        _recentContextualMatches = new();

    private static bool IsDuplicateContextualMatch(Guid meetingId, Guid userId, Guid chunkId)
    {
        var now = DateTime.UtcNow;
        var key = (meetingId, userId, chunkId);
        if (_recentContextualMatches.TryGetValue(key, out var last) && now - last < EventDebounceWindow)
        {
            return true;
        }
        _recentContextualMatches[key] = now;
        if (_recentContextualMatches.Count > 256)
        {
            foreach (var stale in _recentContextualMatches
                         .Where(kv => now - kv.Value > DebouncePruneAge)
                         .Select(kv => kv.Key)
                         .ToList())
            {
                _recentContextualMatches.TryRemove(stale, out _);
            }
        }
        return false;
    }

    /// <summary>PROSPECT gate: only system/desktop audio (the buyer) drives
    /// contextual matching. The rep's own mic never triggers cards on their
    /// own words. Desktop sends "microphone" or "desktop"; empty defaults
    /// to microphone. Accepts "system_audio" as a synonym for "desktop".</summary>
    private static bool IsProspectSource(string? source)
    {
        var s = string.IsNullOrEmpty(source) ? "microphone" : source.ToLowerInvariant();
        return s is "desktop" or "system_audio";
    }

    private readonly ILogger<DesktopAgentHub> _logger;
    private readonly AiCoordinatorService _aiCoordinator;
    private readonly EventDetectionService _eventDetector;
    private readonly RecommendationEngine _recommendationEngine;
    private readonly ContextualMatchService _contextualMatchService;
    private readonly MeetingDiagnosticsService _diagnostics;
    private readonly CallPilot.Server.Infrastructure.Products.ProductIntelQueue _productIntelQueue;
    private readonly IServiceProvider _serviceProvider;

    public DesktopAgentHub(
        ILogger<DesktopAgentHub> logger,
        AiCoordinatorService aiCoordinator,
        EventDetectionService eventDetector,
        RecommendationEngine recommendationEngine,
        ContextualMatchService contextualMatchService,
        MeetingDiagnosticsService diagnostics,
        CallPilot.Server.Infrastructure.Products.ProductIntelQueue productIntelQueue,
        IServiceProvider serviceProvider,
        IConfiguration configuration)
    {
        _logger = logger;
        _aiCoordinator = aiCoordinator;
        _eventDetector = eventDetector;
        _recommendationEngine = recommendationEngine;
        _contextualMatchService = contextualMatchService;
        _diagnostics = diagnostics;
        _productIntelQueue = productIntelQueue;
        _serviceProvider = serviceProvider;

        // First hub instance applies the configured debounce window (static
        // field, so all instances share it). Values <= 0 keep the default.
        var configuredWindow = configuration.GetValue<double?>("DuplicateEventWindowSeconds");
        if (configuredWindow is > 0)
        {
            _eventDebounceWindow = TimeSpan.FromSeconds(configuredWindow.Value);
        }
    }

    public override async Task OnConnectedAsync()
    {
        _logger.LogInformation(
            "Desktop Agent connected: {ConnectionId}, User: {UserId}",
            Context.ConnectionId, GetUserId());
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("Desktop Agent disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task RegisterAgent(AgentRegistration registration)
    {
        _logger.LogInformation(
            "Agent registered: User={UserId}, Version={Version}, Platform={Platform}, Capabilities=[{Capabilities}]",
            GetUserId(), registration.AgentVersion, registration.Platform,
            string.Join(", ", registration.Capabilities));

        await Clients.Caller.SendAsync("AgentRegistered", new { Status = "Registered", Timestamp = DateTime.UtcNow });
    }

    public async Task SendAudioFrame(AudioFrameMessage frame)
    {
        _logger.LogDebug(
            "Audio frame: MeetingId={MeetingId}, Seq={Sequence}, SR={SampleRate}, Ch={Channels}, Size={Size}",
            frame.MeetingId, frame.Sequence, frame.SampleRate, frame.Channels, frame.Audio.Length);

        _diagnostics.TrackAudioFrame(frame.MeetingId, frame.Audio.Length);

        if (!Guid.TryParse(frame.MeetingId, out var meetingId))
        {
            _logger.LogWarning("Invalid MeetingId '{MeetingId}' - audio frame {Sequence} dropped", frame.MeetingId, frame.Sequence);
            return;
        }

        using var scope = _serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();

        var transcriptionStart = DateTime.UtcNow;

        var source = string.IsNullOrEmpty(frame.Source) ? "microphone" : frame.Source;
        var (segment, silenceDetected) = await _aiCoordinator.ProcessAudioAsync(
            meetingId,
            frame.Audio,
            frame.Sequence,
            frame.SampleRate,
            frame.Channels,
            source,
            dbContext);

        if (silenceDetected)
        {
            await Clients.Caller.SendAsync("SilenceDetected", new
            {
                MeetingId = frame.MeetingId,
                Message = "The selected microphone is producing silent audio. Check: (1) microphone permissions in System Settings > Privacy > Microphone, (2) correct device with --list-devices, (3) microphone is not muted.",
                Timestamp = DateTime.UtcNow
            });
        }

        if (segment is not null)
        {
            var latencyMs = (long)(DateTime.UtcNow - transcriptionStart).TotalMilliseconds;
            _diagnostics.TrackTranscript(frame.MeetingId, latencyMs);
            await ProcessTranscriptAsync(segment, frame, dbContext, latencyMs, meetingId);
        }

        await Clients.Caller.SendAsync("AudioFrameAcknowledged", new
        {
            frame.Sequence,
            Timestamp = DateTime.UtcNow
        });
    }

    /// <summary>
    /// Broadcast the transcript to the caller + meeting group, then - for
    /// final segments - detect events, persist them, and generate any
    /// recommendation triggered by those events.
    /// </summary>
    private async Task ProcessTranscriptAsync(
        TranscriptSegment segment,
        AudioFrameMessage frame,
        CallPilotDbContext dbContext,
        long latencyMs,
        Guid meetingId)
    {
        var transcriptEvent = new
        {
            segment.Speaker,
            segment.Text,
            segment.Confidence,
            segment.IsFinal,
            segment.Sequence,
            LatencyMs = latencyMs
        };

        await Clients.Caller.SendAsync("TranscriptReceived", transcriptEvent);
        await Clients.Group($"meeting_{frame.MeetingId}").SendAsync("TranscriptReceived", transcriptEvent);

        if (!segment.IsFinal) return;

        var userId = GetUserId();
        if (userId is null || !Guid.TryParse(userId, out var userGuid)) return;

        // ── Contextual match layer (PROSPECT turns only) ───────────────────
        // Parallel to keyword detection: never awaited inline, so a slow
        // engine call can't stall the audio pipeline. Any fault is logged
        // via the ContinueWith backstop below.
        if (IsProspectSource(frame.Source))
        {
            _ = RunContextualMatchAsync(meetingId, userGuid, segment)
                .ContinueWith(
                    t => _logger.LogError(t.Exception, "Contextual match pipeline faulted for meeting {MeetingId}", meetingId),
                    TaskContinuationOptions.OnlyOnFaulted);
        }

        var events = await _eventDetector.DetectEventsForMeetingAsync(segment.Text, meetingId.ToString());
        foreach (var evt in events)
        {
            if (IsDuplicateEvent(meetingId, evt.EventType, evt.EntityName))
            {
                _logger.LogDebug(
                    "Suppressed duplicate event {Type}/{Entity} for meeting {MeetingId}",
                    evt.EventType, evt.EntityName, meetingId);
                continue;
            }
            _diagnostics.TrackEvent(frame.MeetingId, evt.EventType);
            var conversationEvent = new Domain.Meetings.ConversationEvent(
                meetingId,
                evt.EventType,
                evt.EntityName,
                evt.Confidence,
                segment.Text.Length > 1000 ? segment.Text[..1000] : segment.Text);

            dbContext.ConversationEvents.Add(conversationEvent);
            await dbContext.SaveChangesAsync();

            // Kick off product intelligence research for detected products.
            // The background worker dedupes (canonical name + in-flight guard)
            // and skips already-Completed profiles, so this is cheap and
            // never blocks the transcript pipeline.
            if (evt.EventType == "ProductMentioned" && !string.IsNullOrWhiteSpace(evt.EntityName))
            {
                _productIntelQueue.Enqueue(
                    CallPilot.Server.Infrastructure.Products.ProductIntelService.NormalizeName(evt.EntityName),
                    conversationEvent.SupportingTranscript);
            }

            var eventPayload = new
            {
                conversationEvent.Id,
                conversationEvent.EventType,
                conversationEvent.EntityName,
                conversationEvent.Confidence,
                conversationEvent.DetectedAt,
                category = evt.Category,
                supportingTranscript = conversationEvent.SupportingTranscript
            };

            await Clients.Caller.SendAsync("EventDetected", eventPayload);
            await Clients.Group($"meeting_{frame.MeetingId}").SendAsync("EventDetected", eventPayload);

            var recommendationStart = DateTime.UtcNow;
            var recommendation = await _recommendationEngine.GenerateRecommendationAsync(
                meetingId, userGuid, conversationEvent);

            if (recommendation is not null)
            {
                var recLatencyMs = (long)(DateTime.UtcNow - recommendationStart).TotalMilliseconds;
                _diagnostics.TrackRecommendation(frame.MeetingId, recLatencyMs, "llm");

                dbContext.Recommendations.Add(recommendation);
                await dbContext.SaveChangesAsync();

                var recPayload = new
                {
                    recommendation.Id,
                    recommendation.Type,
                    recommendation.Title,
                    recommendation.Summary,
                    recommendation.TalkingPoint,
                    recommendation.KeyFacts,
                    recommendation.Priority,
                    triggerEventId = conversationEvent.Id,
                    recommendation.Confidence,
                    recommendation.References,
                    recommendation.GeneratedAt,
                    // Keyword-triggered cards carry no trigger sentence;
                    // triggerType is "keyword" for all event-detector cards.
                    triggerSpan = recommendation.TriggerSpan,
                    triggerType = recommendation.TriggerType
                };

                await Clients.Caller.SendAsync("RecommendationGenerated", recPayload);
                await Clients.Group($"meeting_{frame.MeetingId}").SendAsync("RecommendationGenerated", recPayload);
            }
        }
    }

    /// <summary>
    /// Background contextual-match pipeline for a finalised PROSPECT turn.
    /// Runs entirely off the audio hot path: engine call → chunk fetch →
    /// LLM card → persist → SignalR broadcast, each on a fresh DI scope
    /// (the hub's request scope is gone by the time this task runs).
    /// Exceptions are caught inside AND by the caller's ContinueWith backstop,
    /// so no unobserved task exceptions can escape.
    /// </summary>
    private async Task RunContextualMatchAsync(Guid meetingId, Guid userId, TranscriptSegment segment)
    {
        try
        {
            var match = await _contextualMatchService.MatchAsync(segment.Text, meetingId, userId);
            if (match is null) return;

            if (IsDuplicateContextualMatch(meetingId, userId, match.ChunkId))
            {
                _logger.LogDebug(
                    "Suppressed duplicate contextual match chunk {ChunkId} for meeting {MeetingId}",
                    match.ChunkId, meetingId);
                return;
            }

            _diagnostics.TrackEvent(meetingId.ToString(), "ContextualMatch");

            using var scope = _serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();
            var engine = scope.ServiceProvider.GetRequiredService<RecommendationEngine>();

            // The engine already did the cosine work - fetch the chunk by ID.
            var chunk = await dbContext.KnowledgeChunks
                .Include(c => c.Document)
                .FirstOrDefaultAsync(c => c.Id == match.ChunkId);
            if (chunk is null)
            {
                _logger.LogWarning(
                    "Contextual match referenced missing chunk {ChunkId} for meeting {MeetingId}",
                    match.ChunkId, meetingId);
                return;
            }

            var recommendation = await engine.GenerateFromContextualMatchAsync(meetingId, userId, match, chunk);
            if (recommendation is null) return;

            dbContext.Recommendations.Add(recommendation);
            await dbContext.SaveChangesAsync();

            var hubContext = scope.ServiceProvider.GetRequiredService<IHubContext<DesktopAgentHub>>();
            var groupName = $"meeting_{meetingId}";

            // Tell the dashboard WHY the card is about to appear.
            await hubContext.Clients.Group(groupName).SendAsync("ContextualMatchDetected", new
            {
                chunkId = match.ChunkId,
                similarity = match.Similarity,
                triggerSpan = match.TriggerSpan,
                knowledgeSource = match.KnowledgeSource,
                meetingId
            });

            // Same RecommendationGenerated shape as the keyword path, with
            // triggerSpan/triggerType/supportingTranscript appended (nothing
            // removed) so existing consumers keep working.
            var recPayload = new
            {
                recommendation.Id,
                recommendation.Type,
                recommendation.Title,
                recommendation.Summary,
                recommendation.TalkingPoint,
                recommendation.KeyFacts,
                recommendation.Priority,
                triggerEventId = (Guid?)null,
                recommendation.Confidence,
                recommendation.References,
                recommendation.GeneratedAt,
                recommendation.TriggerSpan,
                recommendation.TriggerType,
                // The full buyer turn for the "Why this card appeared" highlight.
                supportingTranscript = segment.Text.Length > 1000 ? segment.Text[..1000] : segment.Text
            };

            await hubContext.Clients.Group(groupName).SendAsync("RecommendationGenerated", recPayload);

            _logger.LogInformation(
                "Contextual card generated for meeting {MeetingId}: chunk {ChunkId} sim={Similarity:F3} span=\"{TriggerSpan}\"",
                meetingId, match.ChunkId, match.Similarity, match.TriggerSpan);
        }
        catch (Exception ex)
        {
            // Fail silently for the pipeline; log for diagnostics.
            _logger.LogError(ex, "Contextual match pipeline failed for meeting {MeetingId}", meetingId);
        }
    }

    public async Task SendHeartbeat(HeartbeatMessage heartbeat)
    {
        _logger.LogDebug("Heartbeat received: MeetingId={MeetingId}", heartbeat.MeetingId);
    }

    public async Task JoinMeeting(string meetingId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"meeting_{meetingId}");
        _logger.LogInformation("Client {ConnectionId} joined meeting {MeetingId}", Context.ConnectionId, meetingId);
    }

    public async Task LeaveMeeting(string meetingId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"meeting_{meetingId}");
    }

    private string? GetUserId() => Context.User?.FindFirst("userId")?.Value;
}

public record AgentRegistration(
    string AgentVersion,
    string Platform,
    List<string> Capabilities);

public record AudioFrameMessage(
    string MeetingId,
    long Sequence,
    DateTime Timestamp,
    int SampleRate,
    int Channels,
    string Source,
    byte[] Audio);

public record HeartbeatMessage(
    string MeetingId,
    DateTime Timestamp);
