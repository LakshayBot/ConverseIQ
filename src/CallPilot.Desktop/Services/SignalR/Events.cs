namespace CallPilot.Desktop.Services.SignalR;

/// <summary>
/// Server → client transcript event delivered by the
/// <c>TranscriptReceived</c> hub method.
/// </summary>
internal record TranscriptEvent(
    string Speaker,
    string Text,
    double Confidence,
    bool IsFinal,
    int Sequence,
    long LatencyMs = 0);

/// <summary>
/// Server → client signal that the audio source is silent (used to nudge
/// the operator to check permissions / device).
/// </summary>
internal record SilenceEvent(string MeetingId, string Message, DateTime Timestamp);
