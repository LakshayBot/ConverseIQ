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

    /// <summary>
    /// Set when this mention resolves to a canonical
    /// <see cref="CallPilot.Server.Domain.Products.ProductIntelligence"/> row
    /// (backfilled when enrichment completes). Links the meeting-specific
    /// mention to the global product profile.
    /// </summary>
    public Guid? ProductIntelligenceId { get; private set; }

    private ConversationEvent()
    {
        SupportingTranscript = string.Empty;
    }

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

    /// <summary>Associates this meeting mention with a canonical product profile.</summary>
    public void LinkToProduct(Guid productIntelligenceId)
    {
        ProductIntelligenceId = productIntelligenceId;
    }
}
