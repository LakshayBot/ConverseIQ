using System.Collections.Concurrent;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.AI;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Reliability;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace CallPilot.Server.Api.Hubs;

[Authorize]
public class DesktopAgentHub : Hub
{
    // Per-meeting rolling debounce: (eventType, entity) → last fire time.
    // Backstop for the engine-side window — duplicates are suppressed here
    // even if the AI engine's debounce is bypassed or an older engine version
    // is in play.
    private static readonly ConcurrentDictionary<Guid, ConcurrentDictionary<(string, string?), DateTime>>
        _recentEvents = new();
    private static readonly TimeSpan EventDebounceWindow = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan DebouncePruneAge = TimeSpan.FromMinutes(2);

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

    private readonly ILogger<DesktopAgentHub> _logger;
    private readonly AiCoordinatorService _aiCoordinator;
    private readonly EventDetectionService _eventDetector;
    private readonly RecommendationEngine _recommendationEngine;
    private readonly MeetingDiagnosticsService _diagnostics;
    private readonly IServiceProvider _serviceProvider;

    public DesktopAgentHub(
        ILogger<DesktopAgentHub> logger,
        AiCoordinatorService aiCoordinator,
        EventDetectionService eventDetector,
        RecommendationEngine recommendationEngine,
        MeetingDiagnosticsService diagnostics,
        IServiceProvider serviceProvider)
    {
        _logger = logger;
        _aiCoordinator = aiCoordinator;
        _eventDetector = eventDetector;
        _recommendationEngine = recommendationEngine;
        _diagnostics = diagnostics;
        _serviceProvider = serviceProvider;
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
                    recommendation.GeneratedAt
                };

                await Clients.Caller.SendAsync("RecommendationGenerated", recPayload);
                await Clients.Group($"meeting_{frame.MeetingId}").SendAsync("RecommendationGenerated", recPayload);
            }
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
