namespace CallPilot.Desktop.Audio;

public record AudioFrame(
    long Sequence,
    DateTime Timestamp,
    byte[] Data,
    int SampleRate,
    int Channels,
    string Source = "microphone");
