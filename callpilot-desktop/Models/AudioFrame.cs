namespace CallPilot.Desktop.Models;

public sealed record AudioFrame
{
    public string MeetingId { get; init; } = string.Empty;
    public int Sequence { get; init; }
    public string Timestamp { get; init; } = string.Empty;
    public int SampleRate { get; init; } = 16000;
    public int Channels { get; init; } = 1;
    public byte[] Audio { get; init; } = [];
}
