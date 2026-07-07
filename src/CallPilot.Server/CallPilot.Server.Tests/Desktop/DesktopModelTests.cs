using CallPilot.Desktop.Audio;
using CallPilot.Desktop.Models;
using Xunit;

namespace CallPilot.Server.Tests.Desktop;

public class DesktopModelTests
{
    [Fact]
    public void AgentConfiguration_HasCorrectDefaults()
    {
        var config = new AgentConfiguration();

        Assert.Equal("http://localhost:5001", config.ServerUrl);
        Assert.True(config.EnableMicrophone);
        Assert.True(config.EnableDesktopAudio);
        Assert.Equal(16000, config.SampleRate);
        Assert.Equal(1, config.Channels);
        Assert.Equal(16, config.BitDepth);
        Assert.Equal(40, config.ChunkDurationMs);
        Assert.Equal(15, config.HeartbeatIntervalSeconds);
        Assert.Equal(5, config.ReconnectDelaySeconds);
        Assert.Equal(10, config.MaxReconnectAttempts);
    }

    [Fact]
    public void AudioFrame_HasCorrectProperties()
    {
        var timestamp = DateTime.UtcNow;
        var data = new byte[] { 1, 2, 3, 4 };
        var frame = new AudioFrame(42, timestamp, data, 16000, 1);

        Assert.Equal(42, frame.Sequence);
        Assert.Equal(timestamp, frame.Timestamp);
        Assert.Equal(data, frame.Data);
        Assert.Equal(16000, frame.SampleRate);
        Assert.Equal(1, frame.Channels);
    }

    [Fact]
    public void AgentConfiguration_CanOverride()
    {
        var config = new AgentConfiguration
        {
            ServerUrl = "https://custom:8000",
            SampleRate = 24000,
            Channels = 2,
            HeartbeatIntervalSeconds = 30
        };

        Assert.Equal("https://custom:8000", config.ServerUrl);
        Assert.Equal(24000, config.SampleRate);
        Assert.Equal(2, config.Channels);
        Assert.Equal(30, config.HeartbeatIntervalSeconds);
    }
}
