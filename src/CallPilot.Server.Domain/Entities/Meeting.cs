namespace CallPilot.Server.Domain.Entities;

public class Meeting
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string State { get; set; } = "Created";
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public User User { get; set; } = null!;
    public ICollection<TranscriptSegment> TranscriptSegments { get; set; } = [];
}
