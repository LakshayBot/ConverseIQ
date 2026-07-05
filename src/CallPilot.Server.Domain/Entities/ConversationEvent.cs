namespace CallPilot.Server.Domain.Entities;

public class ConversationEvent
{
    public Guid Id { get; set; }
    public Guid MeetingId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public string? Speaker { get; set; }
    public string? RelatedEntities { get; set; }
    public string? SupportingTranscript { get; set; }
    public string? SourceWorker { get; set; }
    public DateTime CreatedAt { get; set; }

    public Meeting Meeting { get; set; } = null!;
}
