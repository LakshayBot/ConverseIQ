using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

/// <summary>
/// Shape returned by the Python engine's POST /api/v1/ai/contextual-match.
/// Field names follow the engine's snake_case JSON contract.
/// </summary>
public class ContextualMatchResult
{
    [JsonPropertyName("chunk_id")]
    public Guid ChunkId { get; set; }

    [JsonPropertyName("chunk_text")]
    public string ChunkText { get; set; } = string.Empty;

    [JsonPropertyName("similarity")]
    public double Similarity { get; set; }

    /// <summary>The single buyer sentence that drove the match.</summary>
    [JsonPropertyName("trigger_span")]
    public string TriggerSpan { get; set; } = string.Empty;

    /// <summary>KnowledgeChunk.Source value ("fast" | "structured" | "enriched").</summary>
    [JsonPropertyName("knowledge_source")]
    public string KnowledgeSource { get; set; } = "fast";
}

/// <summary>
/// Client for the AI engine's contextual (non-keyword) match layer. Called
/// from the DesktopAgentHub on finalised PROSPECT turns — fire-and-forget on
/// a background task, never awaited inline on the hot audio path.
///
/// Any failure (timeout, engine down, bad payload) returns null and the
/// keyword pipeline remains the sole trigger — fail silently by design.
/// </summary>
public class ContextualMatchService
{
    /// <summary>Hard wall-clock budget; the engine targets 250ms internally.</summary>
    private static readonly TimeSpan MatchTimeout = TimeSpan.FromMilliseconds(300);

    private readonly HttpClient _httpClient;
    private readonly ILogger<ContextualMatchService> _logger;

    public ContextualMatchService(HttpClient httpClient, ILogger<ContextualMatchService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    /// <summary>
    /// Ask the engine for a semantic match. Returns null on 204, timeout, or
    /// any error — callers must treat null as "no match" and move on.
    /// </summary>
    public async Task<ContextualMatchResult?> MatchAsync(string turnText, Guid meetingId, Guid userId)
    {
        try
        {
            using var cts = new CancellationTokenSource(MatchTimeout);

            var response = await _httpClient.PostAsJsonAsync(
                "/api/v1/ai/contextual-match",
                new
                {
                    turn_text = turnText,
                    meeting_id = meetingId.ToString(),
                    user_id = userId.ToString(),
                },
                cts.Token);

            // 204 = engine evaluated it and found nothing above threshold.
            if ((int)response.StatusCode == 204) return null;

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Contextual match returned {StatusCode} for meeting {MeetingId}",
                    (int)response.StatusCode, meetingId);
                return null;
            }

            var match = await response.Content.ReadFromJsonAsync<ContextualMatchResult>(cancellationToken: cts.Token);
            if (match is null || match.ChunkId == Guid.Empty || string.IsNullOrWhiteSpace(match.TriggerSpan))
            {
                _logger.LogWarning("Contextual match returned an unusable payload for meeting {MeetingId}", meetingId);
                return null;
            }

            return match;
        }
        catch (OperationCanceledException)
        {
            _logger.LogDebug("Contextual match timed out for meeting {MeetingId}", meetingId);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Contextual match failed for meeting {MeetingId}", meetingId);
            return null;
        }
    }
}
