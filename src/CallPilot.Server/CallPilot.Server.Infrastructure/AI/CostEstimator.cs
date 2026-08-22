namespace CallPilot.Server.Infrastructure.AI;

/// <summary>
/// Simple cost-estimate table for the providers/models CallPilot tracks.
/// Rates are USD per 1M tokens (input/output) and clearly labelled as
/// estimates in the UI - never presented as provider-official billing.
/// </summary>
public static class CostEstimator
{
    private static readonly (string Provider, string ModelWildcard, decimal InputPerM, decimal OutputPerM)[] Rates =
    [
        ("groq", "qwen", 0.18m, 0.18m),
        ("groq", "gpt-oss", 0.10m, 0.10m),
        ("groq", "llama", 0.05m, 0.05m),
        ("openai", "gpt-4.1", 2.00m, 8.00m),
        ("openai", "gpt-4o", 2.50m, 10.00m),
        ("openai", "gpt-4o-mini", 0.15m, 0.60m),
        ("openai", "o3", 2.00m, 8.00m),
        ("anthropic", "claude-opus", 15.00m, 75.00m),
        ("anthropic", "claude-sonnet", 3.00m, 15.00m),
        ("anthropic", "claude-haiku", 0.80m, 4.00m),
    ];

    /// <summary>Estimate USD for a call.  Returns null when unknown or not computable.</summary>
    public static decimal? EstimateUsd(string providerType, string? model, int? inputTokens, int? outputTokens)
    {
        if (!inputTokens.HasValue || !outputTokens.HasValue) return null;
        var inputs = (decimal)inputTokens.Value / 1_000_000m;
        var outputs = (decimal)outputTokens.Value / 1_000_000m;
        var narrowed = providerType.ToLowerInvariant();
        var modelLower = (model ?? "").ToLowerInvariant();
        foreach (var r in Rates)
        {
            if (r.Provider != narrowed) continue;
            if (modelLower.Contains(r.ModelWildcard, StringComparison.OrdinalIgnoreCase))
                return Math.Round(inputs * r.InputPerM + outputs * r.OutputPerM, 6);
        }
        return null;
    }
}
