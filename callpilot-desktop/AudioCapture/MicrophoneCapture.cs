namespace CallPilot.Desktop.AudioCapture;

public sealed class MicrophoneCapture : IAudioCaptureService
{
    public event EventHandler<byte[]>? AudioDataAvailable;
    public string Source => "Microphone";

    public void Start()
    {
        Console.WriteLine("[MicrophoneCapture] Starting microphone capture...");
        Console.WriteLine("[MicrophoneCapture] Platform-specific WASAPI/CoreAudio implementation required.");
    }

    public void Stop()
    {
        Console.WriteLine("[MicrophoneCapture] Stopping microphone capture...");
    }
}
