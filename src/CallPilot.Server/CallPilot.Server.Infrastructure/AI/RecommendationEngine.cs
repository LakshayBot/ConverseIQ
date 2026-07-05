using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Embedding;
using CallPilot.Server.Infrastructure.Knowledge;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

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

            var llmResponse = await _llmService.GenerateResponseAsync(
                userId,
                _promptBuilder.BuildRecommendationPrompt(
                    conversationEvent.EventType,
                    conversationEvent.EntityName,
                    conversationEvent.SupportingTranscript,
                    relevantChunks));

            if (llmResponse is not null)
            {
                summary = llmResponse;
                llmProvider = "llm";
                llmModel = "configured";
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

            var references = relevantChunks
                .Select(c => c.Document?.FileName ?? $"chunk-{c.ChunkIndex}")
                .Distinct()
                .ToList();

            return new Recommendation(
                meetingId,
                conversationEvent.EventType,
                GetRecommendationTitle(conversationEvent),
                summary,
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

    private static string BuildSearchQuery(ConversationEvent evt)
    {
        return evt.EventType switch
        {
            "CompetitorMentioned" => $"{evt.EntityName} comparison competitive advantages migration",
            "PricingQuestion" => "pricing plans cost licensing enterprise",
            "PositiveBuyingSignal" => "case studies success stories customer testimonials",
            "Objection" => $"{evt.EntityName} objection handling competitive response",
            "TechnicalQuestion" => "technical documentation architecture security compliance",
            "NegativeBuyingSignal" => "competitive landscape alternatives switching costs",
            _ => evt.SupportingTranscript
        };
    }

    private static string GetRecommendationTitle(ConversationEvent evt)
    {
        return evt.EventType switch
        {
            "CompetitorMentioned" => $"{evt.EntityName ?? "Competitor"} Comparison",
            "PricingQuestion" => "Pricing Guidance",
            "PositiveBuyingSignal" => "Next Steps",
            "Objection" => $"Addressing {evt.EntityName ?? "Objection"}",
            "TechnicalQuestion" => "Technical Reference",
            "NegativeBuyingSignal" => "Relationship Guidance",
            _ => "Contextual Recommendation"
        };
    }
}
