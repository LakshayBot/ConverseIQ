using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

public class EventDetectionService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<EventDetectionService> _logger;

    public EventDetectionService(HttpClient httpClient, ILogger<EventDetectionService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<IReadOnlyList<DetectedEvent>> DetectEventsAsync(string text)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync("/api/v1/ai/events", new { text });

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Event detection returned {StatusCode}", response.StatusCode);
                return [];
            }

            var result = await response.Content.ReadFromJsonAsync<EventDetectionResponse>();
            var events = result?.Events ?? [];

            // ── Phase 2: Fire-and-forget competitive intel for unknown entities ──
            _ = Task.Run(() => TriggerCompetitiveIntelAsync(text, meetingId: null));

            return events;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Event detection failed");
            return [];
        }
    }

    public async Task<IReadOnlyList<DetectedEvent>> DetectEventsForMeetingAsync(string text, string meetingId)
    {
        var events = await DetectEventsAsync(text);

        // Fire-and-forget with meeting context for dashboard broadcast
        _ = Task.Run(() => TriggerCompetitiveIntelAsync(text, meetingId));

        return events;
    }

    /// <summary>
    /// Fire-and-forget: extract capitalized noun phrases from the transcript,
    /// check each against the trie, and trigger competitive intel for unknown
    /// entities that match heuristic competitor signals.
    /// </summary>
    private async Task TriggerCompetitiveIntelAsync(string text, string? meetingId)
    {
        try
        {
            // Quick heuristic: only run if segment contains competitive trigger words
            var hasTrigger = _competitiveTriggers.Any(t => text.Contains(t, StringComparison.OrdinalIgnoreCase));
            if (!hasTrigger) return;

            var candidates = ExtractProperNouns(text);
            foreach (var entity in candidates.Take(3))
            {
                try
                {
                    await _httpClient.PostAsJsonAsync("/internal/competitor-intel", new
                    {
                        entity,
                        segment = text,
                        meeting_id = meetingId ?? Guid.NewGuid().ToString(),
                        company_name = "",
                    });
                }
                catch
                {
                    // fire-and-forget — individual failures are non-blocking
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Competitive intel trigger skipped");
        }
    }

    private static readonly string[] _competitiveTriggers =
    [
        "better than", "compared to", "instead of", "switching from",
        "currently using", "we use", "not as good as", "cheaper than",
        "their product", "your competitor", "alternative to",
        "we looked at", "evaluating", "considering", "migrating from",
        "replacing", "versus", " vs ",
    ];

    private static List<string> ExtractProperNouns(string text)
    {
        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // Match capitalized words/sequences (2+ chars)
        foreach (Match m in Regex.Matches(text, @"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b"))
        {
            var noun = m.Groups[1].Value.Trim();
            if (noun.Length > 2 && !_stopWords.Contains(noun.ToLowerInvariant()))
                candidates.Add(noun);
        }
        return candidates.ToList();
    }

    private static readonly HashSet<string> _stopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "this", "that", "these", "those", "what", "when", "where",
        "which", "who", "how", "and", "but", "for", "nor", "yet", "with",
        "have", "been", "has", "had", "was", "were", "will", "would", "could",
        "should", "might", "must", "shall", "can", "may", "not", "are", "is",
        "it", "they", "their", "our", "your", "its", "his", "her", "all",
        "some", "any", "every", "both", "most", "more", "less", "few", "many",
        "today", "tomorrow", "yesterday", "really", "actually", "basically",
        "probably", "definitely", "certainly", "maybe", "perhaps", "just",
        "now", "then", "here", "there", "also", "too", "very", "only", "even",
        "like", "just", "right", "left", "first", "second", "third", "last",
    };

    private class EventDetectionResponse
    {
        public List<DetectedEvent> Events { get; set; } = [];
        public int Count { get; set; }
    }
}

public class DetectedEvent
{
    public string EventType { get; set; } = string.Empty;
    public string? EntityName { get; set; }
    public double Confidence { get; set; }
    public string? Category { get; set; }
    public string? SupportingTranscript { get; set; }
}
