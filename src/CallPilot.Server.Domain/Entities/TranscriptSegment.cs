namespace CallPilot.Server.Domain.Entities;

public class TranscriptSegment
{
    public Guid Id { get; set; }
    public Guid MeetingId { get; set; }
    public int Sequence { get; set; }
    public string? SpeakerId { get; set; }
    public string Text { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public string StartTime { get; set; } = string.Empty;
    public string? EndTime { get; set; }
    public bool IsFinal { get; set; }
    public DateTime CreatedAt { get; set; }

    public Meeting Meeting { get; set; } = null!;
}
