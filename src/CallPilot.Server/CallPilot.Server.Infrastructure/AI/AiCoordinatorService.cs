using System.Net.Http.Json;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

public class AiCoordinatorService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<AiCoordinatorService> _logger;
    private readonly string _transcribePath;

    public AiCoordinatorService(HttpClient httpClient, IConfiguration configuration, ILogger<AiCoordinatorService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;

        // Resolve once at construction. Reads the same NEMOTRON_ENABLED
        // setting the Python engine uses (config key or env var) so flipping
        // the flag in one place switches both sides. Defaults to Nemotron
        // because the Whisper STT pipeline was removed - the legacy
        // `/api/v1/ai/transcribe` path no longer exists, so falling back to
        // it would silently produce 404s from the AI engine.
        var useNemotron = configuration.GetValue<bool?>("NEMOTRON_ENABLED")
            ?? !string.Equals(
                Environment.GetEnvironmentVariable("NEMOTRON_ENABLED"),
                "false",
                StringComparison.OrdinalIgnoreCase);
        _transcribePath = useNemotron
            ? "/api/v1/ai/transcribe/nemotron"
            : "/api/v1/ai/transcribe";
        _logger.LogInformation(
            "AiCoordinatorService initialised: transcribe path = {Path} (NEMOTRON_ENABLED config={Config}, env={Env})",
            _transcribePath,
            configuration.GetValue<bool?>("NEMOTRON_ENABLED"),
            Environment.GetEnvironmentVariable("NEMOTRON_ENABLED"));
    }

    public async Task<(TranscriptSegment? segment, bool silenceDetected)> ProcessAudioAsync(
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
            var url = $"{_transcribePath}?meeting_id={meetingId}&sequence={sequence}&sample_rate={sampleRate}&channels={channels}&source={source}";

            var content = new ByteArrayContent(audio);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await _httpClient.PostAsync(url, content);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                _logger.LogWarning(
                    "AI Engine returned {StatusCode} for meeting {MeetingId}: {ErrorBody}",
                    (int)response.StatusCode, meetingId, errorBody);
                return (null, false);
            }

            var result = await response.Content.ReadFromJsonAsync<AiTranscribeResponse>();
            if (result is not { Success: true })
                return (null, result?.SilenceDetected ?? false);

            if (result.Transcript is null)
                return (null, result.SilenceDetected);

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

            return (segment, false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AI Engine request failed for meeting {MeetingId}");
            return (null, false);
        }
    }

    private class AiTranscribeResponse
    {
        public string TaskId { get; set; } = string.Empty;
        public bool Success { get; set; }
        public AiTranscript? Transcript { get; set; }
        public string? Error { get; set; }
        public double DurationMs { get; set; }
        public bool SilenceDetected { get; set; }
    }

    private class AiTranscript
    {
        public string Speaker { get; set; } = string.Empty;
        public string Text { get; set; } = string.Empty;
        public double Confidence { get; set; }
        public string Start { get; set; } = string.Empty;
        public string End { get; set; } = string.Empty;
        [System.Text.Json.Serialization.JsonPropertyName("is_final")]
        public bool IsFinal { get; set; }
        public string MeetingId { get; set; } = string.Empty;
        public int Sequence { get; set; }
    }
}
