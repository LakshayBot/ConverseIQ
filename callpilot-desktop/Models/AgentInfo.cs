namespace CallPilot.Desktop.Models;

public sealed record AgentInfo
{
    public string AgentVersion { get; init; } = "1.0.0";
    public string Platform { get; init; } = GetPlatform();
    public string[] Capabilities { get; init; } = ["DesktopAudio", "MicrophoneAudio"];

    private static string GetPlatform()
    {
        if (OperatingSystem.IsWindows()) return "Windows";
        if (OperatingSystem.IsMacOS()) return "macOS";
        if (OperatingSystem.IsLinux()) return "Linux";
        return "Unknown";
    }
}
