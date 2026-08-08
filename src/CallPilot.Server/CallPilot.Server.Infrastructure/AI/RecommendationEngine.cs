using System.Text.Json;
using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Embedding;
using CallPilot.Server.Infrastructure.Knowledge;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

/// <summary>Shape of the strict-JSON output requested by PromptBuilder.</summary>
internal sealed class StructuredRecommendation
{
    public string? TalkingPoint { get; set; }
    public List<string>? KeyFacts { get; set; }
    public string? Priority { get; set; }
}

public class RecommendationEngine
{
    private readonly VectorSearchService _vectorSearch;
    private readonly EmbeddingService _embeddingService;
    private readonly PromptBuilder _promptBuilder;
    private readonly LlmService _llmService;
    private readonly ILogger<RecommendationEngine> _logger;

    public RecommendationEngine(
        VectorSearchService vectorSearch,
        EmbeddingService embeddingService,
        PromptBuilder promptBuilder,
        LlmService llmService,
        ILogger<RecommendationEngine> logger)
    {
        _vectorSearch = vectorSearch;
        _embeddingService = embeddingService;
        _promptBuilder = promptBuilder;
        _llmService = llmService;
        _logger = logger;
    }

    public async Task<Recommendation?> GenerateRecommendationAsync(
        Guid meetingId,
        Guid userId,
        ConversationEvent conversationEvent)
    {
        try
        {
            var queryText = BuildSearchQuery(conversationEvent);
            var queryVector = _embeddingService.GenerateLocalEmbedding(queryText);
            var relevantChunks = await _vectorSearch.SearchAsync(queryVector, topK: 3, userId: userId);

            string summary;
            string? llmProvider = null;
            string? llmModel = null;
            string? talkingPoint = null;
            List<string>? keyFacts = null;
            string? priority = null;

            var llmResponse = await _llmService.GenerateResponseAsync(
                userId,
                _promptBuilder.BuildRecommendationPrompt(
                    conversationEvent.EventType,
                    conversationEvent.EntityName,
                    conversationEvent.SupportingTranscript,
                    relevantChunks));

            if (llmResponse is not null)
            {
                var parsed = TryParseStructured(llmResponse);
                if (parsed is not null)
                {
                    summary = llmResponse; // keep raw text for dashboard back-compat
                    talkingPoint = parsed.TalkingPoint;
                    keyFacts = parsed.KeyFacts;
                    priority = NormalizePriority(parsed.Priority);
                    llmProvider = "llm";
                    llmModel = "configured";
                }
                else
                {
                    // LLM answered but not with the JSON shape — degrade to the
                    // safe rule-based fallback rather than surfacing raw prose.
                    summary = _promptBuilder.BuildFallbackRecommendation(
                        conversationEvent.EventType,
                        conversationEvent.EntityName,
                        conversationEvent.SupportingTranscript,
                        relevantChunks);
                    llmProvider = "rule-based";
                    llmModel = "fallback";
                }
            }
            else
            {
                summary = _promptBuilder.BuildFallbackRecommendation(
                    conversationEvent.EventType,
                    conversationEvent.EntityName,
                    conversationEvent.SupportingTranscript,
                    relevantChunks);
                llmProvider = "rule-based";
                llmModel = "fallback";
            }

            // Priority source of truth is the structured LLM output; when the
            // fallback path ran, derive it from the detector confidence.
            priority ??= conversationEvent.Confidence >= 0.9
                ? "high"
                : conversationEvent.Confidence >= 0.7
                    ? "medium"
                    : "low";

            var references = relevantChunks
                .Select(c => c.Document?.FileName ?? $"chunk-{c.ChunkIndex}")
                .Distinct()
                .ToList();

            return new Recommendation(
                meetingId,
                conversationEvent.EventType,
                GetRecommendationTitle(conversationEvent),
                summary,
                talkingPoint,
                keyFacts,
                priority,
                conversationEvent.Confidence,
                references,
                conversationEvent.EventType,
                llmProvider,
                llmModel);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Recommendation generation failed for event {EventType}", conversationEvent.EventType);
            return null;
        }
    }

    private static string? NormalizePriority(string? raw)
    {
        return raw?.Trim().ToLowerInvariant() switch
        {
            "high" => "high",
            "medium" => "medium",
            "low" => "low",
            _ => null,
        };
    }

    /// <summary>
    /// Parses the strict-JSON response. Tolerates a ```json fence the model
    /// may wrap the object in; returns null if the shape is unusable so the
    /// caller can fall back to the rule-based path.
    /// </summary>
    private static StructuredRecommendation? TryParseStructured(string raw)
    {
        var text = raw.Trim();
        var fenceStart = text.IndexOf("```", StringComparison.Ordinal);
        if (fenceStart >= 0)
        {
            var fenceEnd = text.LastIndexOf("```", StringComparison.Ordinal);
            if (fenceEnd > fenceStart)
            {
                text = text[(fenceStart + 3)..fenceEnd].Trim();
                var jsonStart = text.IndexOf('{');
                var jsonEnd = text.LastIndexOf('}');
                if (jsonStart >= 0 && jsonEnd > jsonStart)
                {
                    text = text[jsonStart..(jsonEnd + 1)];
                }
            }
        }

        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("talking_point", out var tp) ||
                tp.ValueKind != JsonValueKind.String ||
                string.IsNullOrWhiteSpace(tp.GetString()))
            {
                return null;
            }

            var facts = new List<string>();
            if (root.TryGetProperty("key_facts", out var kf) && kf.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in kf.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        var s = item.GetString()?.Trim();
                        if (!string.IsNullOrWhiteSpace(s)) facts.Add(s);
                    }
                    if (facts.Count >= 3) break;
                }
            }

            string? priority = null;
            if (root.TryGetProperty("priority", out var pr) && pr.ValueKind == JsonValueKind.String)
            {
                priority = NormalizePriority(pr.GetString());
            }

            return new StructuredRecommendation
            {
                TalkingPoint = tp.GetString()!.Trim(),
                KeyFacts = facts,
                Priority = priority,
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string BuildSearchQuery(ConversationEvent evt)
    {
        return evt.EventType switch
        {
            "CompetitorMentioned" => $"{evt.EntityName} comparison competitive advantages migration",
            "PricingQuestion" => "pricing plans cost licensing enterprise",
            "Objection" => $"{evt.EntityName} objection handling competitive response",
            "TechnicalQuestion" => "technical documentation architecture security compliance",
            _ => evt.SupportingTranscript
        };
    }

    private static string GetRecommendationTitle(ConversationEvent evt)
    {
        return evt.EventType switch
        {
            // Product recommendations must carry the PRODUCT ENTITY, not a
            // generic label - the Intelligence rail groups PRODUCTS by
            // entity, and a generic title rendered a recommendation as a
            // bogus product ("Contextual Recommendation" inside PRODUCTS).
            "ProductMentioned" => evt.EntityName ?? "Product Recommendation",
            "PricingQuestion" or "PricingDiscussion" => "Pricing Guidance",
            "CompetitorMentioned" => $"{evt.EntityName ?? "Competitor"} Comparison",
            "Objection" => $"Addressing {evt.EntityName ?? "Objection"}",
            "TechnicalQuestion" => "Technical Reference",
            _ => "Contextual Recommendation"
        };
    }
}
