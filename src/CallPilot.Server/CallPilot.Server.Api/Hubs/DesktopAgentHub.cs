using CallPilot.Server.Infrastructure.AI;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Reliability;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace CallPilot.Server.Api.Hubs;

[Authorize]
public class DesktopAgentHub : Hub
{
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
        var userId = Context.User?.FindFirst("userId")?.Value ?? "unknown";
        _logger.LogInformation("Desktop Agent connected: {ConnectionId}, User: {UserId}", Context.ConnectionId, userId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("Desktop Agent disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task RegisterAgent(AgentRegistration registration)
    {
        var userId = Context.User?.FindFirst("userId")?.Value ?? "unknown";
        _logger.LogInformation(
            "Agent registered: User={UserId}, Version={Version}, Platform={Platform}, Capabilities=[{Capabilities}]",
            userId, registration.AgentVersion, registration.Platform,
            string.Join(", ", registration.Capabilities));

        await Clients.Caller.SendAsync("AgentRegistered", new { Status = "Registered", Timestamp = DateTime.UtcNow });
    }

    public async Task SendAudioFrame(AudioFrameMessage frame)
    {
        _logger.LogDebug(
            "Audio frame: MeetingId={MeetingId}, Seq={Sequence}, SR={SampleRate}, Ch={Channels}, Size={Size}",
            frame.MeetingId, frame.Sequence, frame.SampleRate, frame.Channels, frame.Audio.Length);

        _diagnostics.TrackAudioFrame(frame.MeetingId, frame.Audio.Length);

        if (Guid.TryParse(frame.MeetingId, out var meetingId))
        {
            using var scope = _serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();

            var segment = await _aiCoordinator.ProcessAudioAsync(
                meetingId,
                frame.Audio,
                frame.Sequence,
                frame.SampleRate,
                frame.Channels,
                "microphone",
                dbContext);

            if (segment is not null)
            {
                _diagnostics.TrackTranscript(frame.MeetingId, 0);
                var transcriptEvent = new
                {
                    segment.Speaker,
                    segment.Text,
                    segment.Confidence,
                    segment.IsFinal,
                    segment.Sequence
                };

                await Clients.Caller.SendAsync("TranscriptReceived", transcriptEvent);
                await Clients.Group($"meeting_{frame.MeetingId}").SendAsync("TranscriptReceived", transcriptEvent);

                if (segment.IsFinal)
                {
                    var events = await _eventDetector.DetectEventsAsync(segment.Text);
                    foreach (var evt in events)
                    {
                        _diagnostics.TrackEvent(frame.MeetingId, evt.EventType);
                        var conversationEvent = new Domain.Meetings.ConversationEvent(
                            meetingId,
                            evt.EventType,
                            evt.EntityName,
                            evt.Confidence,
                            segment.Text);

                        dbContext.ConversationEvents.Add(conversationEvent);
                        await dbContext.SaveChangesAsync();

                        var eventPayload = new
                        {
                            conversationEvent.Id,
                            conversationEvent.EventType,
                            conversationEvent.EntityName,
                            conversationEvent.Confidence,
                            conversationEvent.DetectedAt
                        };

                        await Clients.Caller.SendAsync("EventDetected", eventPayload);
                        await Clients.Group($"meeting_{frame.MeetingId}").SendAsync("EventDetected", eventPayload);

                        var userIdClaim = Context.User?.FindFirst("userId")?.Value;
                        if (userIdClaim is not null && Guid.TryParse(userIdClaim, out var userId))
                        {
                            var recommendation = await _recommendationEngine.GenerateRecommendationAsync(
                                meetingId, userId, conversationEvent);

                            if (recommendation is not null)
                            {
                                _diagnostics.TrackRecommendation(frame.MeetingId, 0, "llm");

                                dbContext.Recommendations.Add(recommendation);
                                await dbContext.SaveChangesAsync();

                                var recPayload = new
                                {
                                    recommendation.Id,
                                    recommendation.Type,
                                    recommendation.Title,
                                    recommendation.Summary,
                                    recommendation.Confidence,
                                    recommendation.References,
                                    recommendation.GeneratedAt
                                };

                                await Clients.Caller.SendAsync("RecommendationGenerated", recPayload);
                                await Clients.Group($"meeting_{frame.MeetingId}").SendAsync("RecommendationGenerated", recPayload);
                            }
                        }
                    }
                }
            }
        }

        await Clients.Caller.SendAsync("AudioFrameAcknowledged", new
        {
            frame.Sequence,
            Timestamp = DateTime.UtcNow
        });
    }

    public async Task SendHeartbeat(HeartbeatMessage heartbeat)
    {
        _logger.LogDebug("Heartbeat received: MeetingId={MeetingId}", heartbeat.MeetingId);
    }
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
    byte[] Audio);

public record HeartbeatMessage(
    string MeetingId,
    DateTime Timestamp);
