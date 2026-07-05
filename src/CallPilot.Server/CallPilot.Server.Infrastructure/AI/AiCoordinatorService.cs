using System.Net.Http.Json;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

public class AiCoordinatorService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<AiCoordinatorService> _logger;

    public AiCoordinatorService(HttpClient httpClient, ILogger<AiCoordinatorService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<TranscriptSegment?> ProcessAudioAsync(
        Guid meetingId,
        byte[] audio,
        long sequence,
        int sampleRate,
        int channels,
        string source,
        CallPilotDbContext dbContext)
    {
        try
        {
            var url = $"/api/v1/ai/transcribe?meeting_id={meetingId}&sequence={sequence}&sample_rate={sampleRate}&channels={channels}&source={source}";

            var content = new ByteArrayContent(audio);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await _httpClient.PostAsync(url, content);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("AI Engine returned {StatusCode} for meeting {MeetingId}", response.StatusCode, meetingId);
                return null;
            }

            var result = await response.Content.ReadFromJsonAsync<AiTranscribeResponse>();
            if (result is not { Success: true, Transcript: not null })
                return null;

            var segment = new TranscriptSegment(
                meetingId,
                result.Transcript.Speaker,
                result.Transcript.Text,
                result.Transcript.Confidence,
                double.TryParse(result.Transcript.Start, out var start) ? start : 0,
                double.TryParse(result.Transcript.End, out var end) ? end : 0,
                result.Transcript.IsFinal,
                result.Transcript.Sequence);

            dbContext.TranscriptSegments.Add(segment);
            await dbContext.SaveChangesAsync();

            _logger.LogDebug(
                "Transcript stored: Meeting={MeetingId}, Speaker={Speaker}, Text={Text}",
                meetingId, segment.Speaker, segment.Text[..Math.Min(segment.Text.Length, 50)]);

            return segment;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AI Engine request failed for meeting {MeetingId}", meetingId);
            return null;
        }
    }

    private class AiTranscribeResponse
    {
        public string TaskId { get; set; } = string.Empty;
        public bool Success { get; set; }
        public AiTranscript? Transcript { get; set; }
        public string? Error { get; set; }
        public double DurationMs { get; set; }
    }

    private class AiTranscript
    {
        public string Speaker { get; set; } = string.Empty;
        public string Text { get; set; } = string.Empty;
        public double Confidence { get; set; }
        public string Start { get; set; } = string.Empty;
        public string End { get; set; } = string.Empty;
        public bool IsFinal { get; set; }
        public string MeetingId { get; set; } = string.Empty;
        public int Sequence { get; set; }
    }
}
