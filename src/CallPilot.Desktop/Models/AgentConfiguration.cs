namespace CallPilot.Desktop.Models;

public class AgentConfiguration
{
    public string ServerUrl { get; set; } = "http://localhost:5001";
    public string? AccessToken { get; set; }
    public string? RefreshToken { get; set; }
    public string? MeetingId { get; set; }
    public bool EnableMicrophone { get; set; } = true;
    public bool EnableDesktopAudio { get; set; } = true;
    public string? MicrophoneDevice { get; set; }
    public string AudioSource { get; set; } = "microphone";
    public int SampleRate { get; set; } = 16000;
    public int Channels { get; set; } = 1;
    public int BitDepth { get; set; } = 16;
    public int ChunkDurationMs { get; set; } = 40;
    public int HeartbeatIntervalSeconds { get; set; } = 15;
    public int ReconnectDelaySeconds { get; set; } = 5;
    public int MaxReconnectAttempts { get; set; } = 10;
}
