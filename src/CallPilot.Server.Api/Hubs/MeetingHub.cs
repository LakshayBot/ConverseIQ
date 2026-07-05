using CallPilot.Server.Domain.Entities;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Api.Hubs;

[Authorize]
public sealed class MeetingHub : Hub
{
    private readonly CallPilotDbContext _db;
    private readonly ILogger<MeetingHub> _logger;

    public MeetingHub(CallPilotDbContext db, ILogger<MeetingHub> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<string> RegisterAgent(AgentRegistration registration)
    {
        var userId = Guid.Parse(Context.UserIdentifier!);
        var meeting = new Meeting
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            State = "Streaming",
            StartedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };

        _db.Meetings.Add(meeting);
        await _db.SaveChangesAsync();

        await Groups.AddToGroupAsync(Context.ConnectionId, meeting.Id.ToString());
        _logger.LogInformation("Agent registered for meeting {MeetingId} by user {UserId}", meeting.Id, userId);

        return meeting.Id.ToString();
    }

    public async Task SendAudioFrame(AudioFramePayload frame)
    {
        var segment = new TranscriptSegment
        {
            Id = Guid.NewGuid(),
            MeetingId = Guid.Parse(frame.MeetingId),
            Sequence = frame.Sequence,
            StartTime = frame.Timestamp,
            Text = string.Empty,
            Confidence = 0,
            CreatedAt = DateTime.UtcNow
        };

        _db.TranscriptSegments.Add(segment);
        await _db.SaveChangesAsync();
    }

    public async Task Heartbeat(string meetingId)
    {
        _logger.LogDebug("Heartbeat received for meeting {MeetingId}", meetingId);
        await Task.CompletedTask;
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("Agent disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public sealed record AgentRegistration(string AgentVersion, string Platform, string[] Capabilities);

    public sealed record AudioFramePayload(string MeetingId, int Sequence, string Timestamp, int SampleRate, int Channels, byte[] Audio);
}
