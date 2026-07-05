namespace CallPilot.Server.Domain.Meetings;

public class Meeting
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string Status { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? StartedAt { get; private set; }
    public DateTime? EndedAt { get; private set; }

    public ICollection<TranscriptSegment> TranscriptSegments { get; private set; } = new List<TranscriptSegment>();

    private Meeting() { }

    public Meeting(Guid userId)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        Status = "Created";
        CreatedAt = DateTime.UtcNow;
    }

    public void Start()
    {
        Status = "Streaming";
        StartedAt = DateTime.UtcNow;
    }

    public void End()
    {
        Status = "Completed";
        EndedAt = DateTime.UtcNow;
    }
}
