namespace CallPilot.Server.Domain.Meetings;

/// <summary>
/// A meeting-scoped speaker identified by local speaker diarization.
/// Transcript segments reference a speaker by stable id (TranscriptSegment.SpeakerId);
/// the legacy TranscriptSegment.Speaker string remains as a denormalized label
/// snapshot for backwards compatibility. Id is client-supplied so the desktop can
/// reuse the same speaker across idempotent bulk saves.
/// </summary>
public class Speaker
{
    public Guid Id { get; private set; }
    public Guid MeetingId { get; private set; }
    public string DisplayName { get; private set; }
    public int SortOrder { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    public ICollection<TranscriptSegment> TranscriptSegments { get; private set; } = new List<TranscriptSegment>();

    private Speaker() { }

    public Speaker(Guid id, Guid meetingId, string displayName, int sortOrder)
    {
        Id = id;
        MeetingId = meetingId;
        DisplayName = displayName;
        SortOrder = sortOrder;
        CreatedAt = DateTime.UtcNow;
        UpdatedAt = CreatedAt;
    }

    public void Rename(string displayName)
    {
        DisplayName = displayName;
        UpdatedAt = DateTime.UtcNow;
    }
}
