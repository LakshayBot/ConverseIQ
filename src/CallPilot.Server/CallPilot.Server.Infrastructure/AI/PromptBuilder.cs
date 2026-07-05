using System.Text;
using CallPilot.Server.Domain.Knowledge;

namespace CallPilot.Server.Infrastructure.AI;

public class PromptBuilder
{
    public string BuildRecommendationPrompt(
        string eventType,
        string? entityName,
        string transcript,
        IReadOnlyList<KnowledgeChunk> knowledgeChunks)
    {
        var sb = new StringBuilder();

        sb.AppendLine("You are a sales intelligence assistant for CallPilot AI.");
        sb.AppendLine();
        sb.AppendLine($"A sales conversation just triggered this event: **{eventType}**");

        if (!string.IsNullOrEmpty(entityName))
        {
            sb.AppendLine($"Entity mentioned: **{entityName}**");
        }

        sb.AppendLine();
        sb.AppendLine("Customer said:");
        sb.AppendLine($"\"{transcript}\"");
        sb.AppendLine();

        if (knowledgeChunks.Count > 0)
        {
            sb.AppendLine("Relevant company knowledge:");
            foreach (var chunk in knowledgeChunks)
            {
                sb.AppendLine($"- [From: {chunk.Document?.FileName ?? "document"}] {chunk.Text[..Math.Min(chunk.Text.Length, 200)]}");
            }
            sb.AppendLine();
        }

        sb.AppendLine("Please provide:");
        sb.AppendLine("1. A brief summary of the situation (1-2 sentences)");
        sb.AppendLine("2. A recommended talking point or response for the salesperson (2-3 sentences)");
        sb.AppendLine("3. Key facts to mention from the knowledge base (if any)");

        return sb.ToString();
    }

    public string BuildFallbackRecommendation(
        string eventType,
        string? entityName,
        string transcript,
        IReadOnlyList<KnowledgeChunk> knowledgeChunks)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"**{eventType}** detected.");

        if (!string.IsNullOrEmpty(entityName))
        {
            sb.Append($" Customer mentioned: **{entityName}**. ");
        }

        sb.Append(GetContextualAdvice(eventType, entityName));

        if (knowledgeChunks.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine();
            sb.AppendLine("Supporting documents:");
            foreach (var chunk in knowledgeChunks.Take(3))
            {
                sb.AppendLine($"- {chunk.Text[..Math.Min(chunk.Text.Length, 150)]}...");
            }
        }

        return sb.ToString();
    }

    private static string GetContextualAdvice(string eventType, string? entityName)
    {
        return eventType switch
        {
            "CompetitorMentioned" =>
                entityName is not null
                    ? $"Highlight our key differentiators against {entityName}. Reference any comparison documents and migration guides in your knowledge base."
                    : "Mention your competitive advantages and reference comparison documents if available.",

            "PricingQuestion" =>
                "Address pricing concerns directly. Highlight ROI, flexible plans, and any current promotions. Be transparent about costs.",

            "PositiveBuyingSignal" =>
                "Reinforce the positive sentiment. Summarize key benefits discussed. Propose next steps like a demo or trial.",

            "Objection" =>
                entityName is not null
                    ? $"Address the {entityName} objection with supporting evidence and case studies."
                    : "Acknowledge the concern with empathy. Provide evidence, ROI data, and relevant case studies.",

            "TechnicalQuestion" =>
                "Provide a clear technical answer. Reference documentation, architecture diagrams, and technical whitepapers. Offer to connect with a solutions engineer.",

            "NegativeBuyingSignal" =>
                "Don't push. Ask clarifying questions to understand their concerns. Focus on building relationship rather than closing.",

            _ => "Listen actively and respond thoughtfully to the customer's needs.",
        };
    }
}
