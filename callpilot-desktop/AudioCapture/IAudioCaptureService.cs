namespace CallPilot.Desktop.AudioCapture;

public interface IAudioCaptureService
{
    event EventHandler<byte[]>? AudioDataAvailable;
    void Start();
    void Stop();
    string Source { get; }
}
