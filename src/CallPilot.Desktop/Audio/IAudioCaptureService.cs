using CallPilot.Desktop.Audio;

namespace CallPilot.Desktop.Audio;

public interface IAudioCaptureService
{
    event EventHandler<AudioFrame>? AudioFrameCaptured;
    Task StartCaptureAsync(int sampleRate, int channels, CancellationToken cancellationToken);
    Task StopCaptureAsync();
}
