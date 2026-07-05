namespace CallPilot.Desktop.AudioCapture;

public sealed class DesktopAudioCapture : IAudioCaptureService
{
    public event EventHandler<byte[]>? AudioDataAvailable;
    public string Source => "DesktopAudio";

    public void Start()
    {
        Console.WriteLine("[DesktopAudioCapture] Starting desktop audio capture...");
        Console.WriteLine("[DesktopAudioCapture] Platform-specific WASAPI Loopback/CoreAudio implementation required.");
    }

    public void Stop()
    {
        Console.WriteLine("[DesktopAudioCapture] Stopping desktop audio capture...");
    }
}
