namespace CallPilot.Server.Domain.Meetings;

public class ConversationEvent
{
    public Guid Id { get; private set; }
    public Guid MeetingId { get; private set; }
    public string EventType { get; private set; }
    public string? EntityName { get; private set; }
    public double Confidence { get; private set; }
    public string SupportingTranscript { get; private set; }
    public DateTime DetectedAt { get; private set; }

    private ConversationEvent() { }

    public ConversationEvent(
        Guid meetingId,
        string eventType,
        string? entityName,
        double confidence,
        string supportingTranscript)
    {
        Id = Guid.NewGuid();
        MeetingId = meetingId;
        EventType = eventType;
        EntityName = entityName;
        Confidence = confidence;
        SupportingTranscript = supportingTranscript;
        DetectedAt = DateTime.UtcNow;
    }
}
