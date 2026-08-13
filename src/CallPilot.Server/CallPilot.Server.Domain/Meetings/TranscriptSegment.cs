namespace CallPilot.Server.Domain.Meetings;

public class TranscriptSegment
{
    public Guid Id { get; private set; }
    public Guid MeetingId { get; private set; }
    public string Speaker { get; private set; }
    /// <summary>Stable per-meeting speaker reference (nullable = speaker not identified).</summary>
    public Guid? SpeakerId { get; private set; }
    public string Text { get; private set; }
    public double Confidence { get; private set; }
    public double StartOffset { get; private set; }
    public double EndOffset { get; private set; }
    public bool IsFinal { get; private set; }
    public int Sequence { get; private set; }
    public DateTime CreatedAt { get; private set; }

    private TranscriptSegment() { }

    public TranscriptSegment(
        Guid meetingId,
        string speaker,
        string text,
        double confidence,
        double startOffset,
        double endOffset,
        bool isFinal,
        int sequence,
        Guid? speakerId = null)
    {
        Id = Guid.NewGuid();
        MeetingId = meetingId;
        Speaker = speaker;
        SpeakerId = speakerId;
        Text = text;
        Confidence = confidence;
        StartOffset = startOffset;
        EndOffset = endOffset;
        IsFinal = isFinal;
        Sequence = sequence;
        CreatedAt = DateTime.UtcNow;
    }

    public void AssignSpeaker(Guid? speakerId, string speakerLabel)
    {
        SpeakerId = speakerId;
        Speaker = speakerLabel;
    }
}
