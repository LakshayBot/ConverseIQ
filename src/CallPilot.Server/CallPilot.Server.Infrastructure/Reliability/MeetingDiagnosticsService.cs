using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Reliability;

public class MeetingDiagnosticsService
{
    private readonly ConcurrentDictionary<string, MeetingMetrics> _meetings = new();
    private readonly ILogger<MeetingDiagnosticsService> _logger;

    public MeetingDiagnosticsService(ILogger<MeetingDiagnosticsService> logger)
    {
        _logger = logger;
    }

    public void TrackTranscript(string meetingId, long latencyMs)
    {
        var metrics = _meetings.GetOrAdd(meetingId, _ => new MeetingMetrics());
        metrics.TranscriptCount++;
        metrics.TotalTranscriptLatencyMs += latencyMs;
    }

    public void TrackEvent(string meetingId, string eventType)
    {
        var metrics = _meetings.GetOrAdd(meetingId, _ => new MeetingMetrics());
        metrics.EventCount++;
        metrics.EventsByType.AddOrUpdate(eventType, 1, (_, count) => count + 1);
    }

    public void TrackRecommendation(string meetingId, long latencyMs, string source)
    {
        var metrics = _meetings.GetOrAdd(meetingId, _ => new MeetingMetrics());
        metrics.RecommendationCount++;
        metrics.TotalRecommendationLatencyMs += latencyMs;
    }

    public void TrackAudioFrame(string meetingId, int bytes)
    {
        var metrics = _meetings.GetOrAdd(meetingId, _ => new MeetingMetrics());
        metrics.AudioBytesProcessed += bytes;
    }

    public void TrackRetry(string meetingId)
    {
        var metrics = _meetings.GetOrAdd(meetingId, _ => new MeetingMetrics());
        metrics.RetryCount++;
    }

    public MeetingMetrics? GetMetrics(string meetingId)
    {
        _meetings.TryGetValue(meetingId, out var metrics);
        return metrics;
    }

    public IReadOnlyDictionary<string, MeetingMetrics> GetAllMetrics() => _meetings;

    public void RemoveMeeting(string meetingId)
    {
        _meetings.TryRemove(meetingId, out _);
    }
}

public class MeetingMetrics
{
    public int AudioBytesProcessed { get; set; }
    public int TranscriptCount { get; set; }
    public long TotalTranscriptLatencyMs { get; set; }
    public int EventCount { get; set; }
    public ConcurrentDictionary<string, int> EventsByType { get; } = new();
    public int RecommendationCount { get; set; }
    public long TotalRecommendationLatencyMs { get; set; }
    public int RetryCount { get; set; }

    public double AverageTranscriptLatencyMs =>
        TranscriptCount > 0 ? (double)TotalTranscriptLatencyMs / TranscriptCount : 0;

    public double AverageRecommendationLatencyMs =>
        RecommendationCount > 0 ? (double)TotalRecommendationLatencyMs / RecommendationCount : 0;
}
