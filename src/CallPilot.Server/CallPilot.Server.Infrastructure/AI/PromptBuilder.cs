using System.Text;
using System.Text.Json;
using CallPilot.Server.Domain.Knowledge;

namespace CallPilot.Server.Infrastructure.AI;

/// <summary>Structured fields extracted from an enriched product-card chunk's MetadataJson.</summary>
internal sealed class ProductMeta
{
    public string Name { get; set; } = "";
    public string? Headline { get; set; }
    public List<string> KeyFeatures { get; set; } = [];
}

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

        sb.AppendLine("Respond with STRICT JSON only — no markdown, no prose outside the JSON object.");
        sb.AppendLine("Use exactly this shape:");
        sb.AppendLine("{");
        sb.AppendLine("  \"talking_point\": \"string — 1-2 sentences: what the sales rep should say or do right now\",");
        sb.AppendLine("  \"key_facts\": [\"string — max 3 short factual phrases from the knowledge base\"],");
        sb.AppendLine("  \"priority\": \"high\" | \"medium\" | \"low\"");
        sb.AppendLine("}");
        sb.AppendLine();
        sb.AppendLine("Rules:");
        sb.AppendLine("- talking_point must be actionable advice for the rep in this exact moment.");
        sb.AppendLine("- key_facts must be short, factual, and drawn ONLY from the provided knowledge.");
        sb.AppendLine("- EXCLUDE contact information, addresses, phone/fax numbers, email addresses, and generic company-history or marketing boilerplate from BOTH fields, even if present in the source chunks.");
        sb.AppendLine("- priority: \"high\" for deal-critical moments (pricing commitment, security blocker, competitor threat), \"medium\" for standard objections or technical questions, \"low\" for informational mentions.");

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

        // Never paste raw chunk text into the fallback body — that is how
        // letterhead/contact boilerplate leaked into cards. Prefer the
        // structured enrichment metadata when available, otherwise emit a
        // neutral reference line and let the card's sources carry the detail.
        var productLines = new List<string>();
        var sourceNames = new List<string>();
        foreach (var chunk in knowledgeChunks.Take(3))
        {
            if (!string.IsNullOrEmpty(chunk.Document?.FileName))
            {
                sourceNames.Add(chunk.Document.FileName);
            }
            var meta = TryGetProductMetadata(chunk);
            if (meta is not null)
            {
                productLines.Add(FormatProductLine(meta));
            }
        }

        sb.AppendLine();
        sb.AppendLine();
        if (productLines.Count > 0)
        {
            sb.AppendLine("From the knowledge base:");
            foreach (var line in productLines)
            {
                sb.AppendLine($"- {line}");
            }
        }
        else
        {
            sb.AppendLine(entityName is not null
                ? $"Related to **{entityName}** — see sources for details."
                : "See sources for details.");
        }

        if (sourceNames.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Sources: " + string.Join(", ", sourceNames.Distinct()));
        }

        return sb.ToString();
    }

    private static ProductMeta? TryGetProductMetadata(KnowledgeChunk chunk)
    {
        if (chunk.Source != "enriched" || string.IsNullOrEmpty(chunk.MetadataJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(chunk.MetadataJson);
            if (!doc.RootElement.TryGetProperty("enrichment", out var en)) return null;
            if (!en.TryGetProperty("name", out var name) ||
                name.ValueKind != JsonValueKind.String ||
                string.IsNullOrWhiteSpace(name.GetString()))
            {
                return null;
            }

            var meta = new ProductMeta { Name = name.GetString()!.Trim() };
            if (en.TryGetProperty("headline", out var h) && h.ValueKind == JsonValueKind.String)
                meta.Headline = h.GetString();
            if (en.TryGetProperty("key_features", out var kf) && kf.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in kf.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.String) continue;
                    var s = item.GetString()?.Trim();
                    if (!string.IsNullOrWhiteSpace(s)) meta.KeyFeatures.Add(s);
                    if (meta.KeyFeatures.Count >= 2) break;
                }
            }
            return meta;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string FormatProductLine(ProductMeta m)
    {
        var parts = new List<string> { m.Name };
        if (!string.IsNullOrEmpty(m.Headline)) parts.Add(m.Headline);
        if (m.KeyFeatures.Count > 0) parts.Add(string.Join("; ", m.KeyFeatures));
        return string.Join(" — ", parts);
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

            "Objection" =>
                entityName is not null
                    ? $"Address the {entityName} objection with supporting evidence and case studies."
                    : "Acknowledge the concern with empathy. Provide evidence, ROI data, and relevant case studies.",

            "TechnicalQuestion" =>
                "Provide a clear technical answer. Reference documentation, architecture diagrams, and technical whitepapers. Offer to connect with a solutions engineer.",

            _ => "Listen actively and respond thoughtfully to the customer's needs.",
        };
    }
}
