using CallPilot.Server.Api.Hubs;
using Xunit;

namespace CallPilot.Server.Tests.Hubs;

public class DesktopAgentHubTests
{
    [Fact]
    public void AgentRegistration_HasRequiredFields()
    {
        var registration = new AgentRegistration("1.0.0", "Windows", ["MicrophoneAudio", "DesktopAudio"]);

        Assert.Equal("1.0.0", registration.AgentVersion);
        Assert.Equal("Windows", registration.Platform);
        Assert.Equal(2, registration.Capabilities.Count);
        Assert.Contains("MicrophoneAudio", registration.Capabilities);
        Assert.Contains("DesktopAudio", registration.Capabilities);
    }

    [Fact]
    public void AudioFrameMessage_HasCorrectStructure()
    {
        var audio = new byte[] { 0, 1, 2, 3 };
        var frame = new AudioFrameMessage("meeting-123", 1, DateTime.UtcNow, 16000, 1, audio);

        Assert.Equal("meeting-123", frame.MeetingId);
        Assert.Equal(1, frame.Sequence);
        Assert.Equal(16000, frame.SampleRate);
        Assert.Equal(1, frame.Channels);
        Assert.Equal(4, frame.Audio.Length);
    }

    [Fact]
    public void HeartbeatMessage_HasCorrectStructure()
    {
        var timestamp = DateTime.UtcNow;
        var heartbeat = new HeartbeatMessage("meeting-456", timestamp);

        Assert.Equal("meeting-456", heartbeat.MeetingId);
        Assert.Equal(timestamp, heartbeat.Timestamp);
    }

    [Fact]
    public void HubMessageTypes_HaveCorrectStructure()
    {
        var registration = new AgentRegistration("1.0.0", "Windows", ["MicrophoneAudio"]);
        var frame = new AudioFrameMessage("mid", 1, DateTime.UtcNow, 16000, 1, [1, 2, 3]);
        var heartbeat = new HeartbeatMessage("mid", DateTime.UtcNow);

        Assert.Equal("1.0.0", registration.AgentVersion);
        Assert.Equal("mid", frame.MeetingId);
        Assert.Equal("mid", heartbeat.MeetingId);
    }
}
