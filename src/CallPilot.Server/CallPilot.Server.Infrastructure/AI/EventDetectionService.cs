using System.Net.Http.Json;
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
            return result?.Events ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Event detection failed");
            return [];
        }
    }

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
