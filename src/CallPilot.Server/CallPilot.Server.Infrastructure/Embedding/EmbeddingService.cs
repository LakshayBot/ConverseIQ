using System.Collections.Concurrent;
using System.Net.Http.Json;
using CallPilot.Server.Domain.Knowledge;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Embedding;

public class EmbeddingService
{
    /// <summary>
    /// Bounded warm cache for real-model embeddings.  The live
    /// recommendation path re-uses a handful of static query strings
    /// (e.g. "pricing plans cost licensing enterprise") every event
    /// debounce window, so serving those from memory avoids a redundant
    /// HTTP round-trip to the AI engine on the real-time path.
    /// </summary>
    private static readonly ConcurrentDictionary<string, (float[] Vector, DateTime ExpiresAt)> Cache = new();
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);
    private const int CacheCapacity = 256;

    private readonly HttpClient _httpClient;
    private readonly ILogger<EmbeddingService> _logger;

    public EmbeddingService(HttpClient httpClient, ILogger<EmbeddingService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public virtual async Task<float[]?> GenerateEmbeddingAsync(string text, string model = "all-MiniLM-L6-v2")
    {
        var cacheKey = $"{model}:{text}";
        if (Cache.TryGetValue(cacheKey, out var hit) && hit.ExpiresAt > DateTime.UtcNow)
        {
            return hit.Vector;
        }

        try
        {
            var response = await _httpClient.PostAsJsonAsync("/api/v1/ai/embeddings", new
            {
                text,
                model
            });

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Embedding API returned {StatusCode}", response.StatusCode);
                return null;
            }

            var result = await response.Content.ReadFromJsonAsync<EmbeddingResponse>();
            if (result?.Embedding is { Length: > 0 } vector)
            {
                TrimCache();
                Cache[cacheKey] = (vector, DateTime.UtcNow.Add(CacheTtl));
                return vector;
            }

            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate embedding");
            return null;
        }
    }

    private static void TrimCache()
    {
        if (Cache.Count < CacheCapacity) return;

        foreach (var entry in Cache)
        {
            if (entry.Value.ExpiresAt <= DateTime.UtcNow)
            {
                Cache.TryRemove(entry.Key, out _);
            }
        }

        // Working set is tiny (a handful of static query strings); a
        // wholesale clear on overflow is acceptable and race-safe enough.
        if (Cache.Count >= CacheCapacity) Cache.Clear();
    }

    /// <summary>
    /// Deterministic hash-based pseudo-embedding.  FALLBACK ONLY — this is
    /// not a semantic model, and vectors produced here are NOT comparable
    /// to the real all-MiniLM-L6-v2 vectors stored at ingest time (cosine
    /// against them is token-overlap, not meaning).  Keep only for the
    /// degraded "engine unreachable" path; never use it when the real
    /// embedding endpoint is available.
    /// </summary>
    public virtual float[] GenerateLocalEmbedding(string text, int dimensions = 384)
    {
        var tokens = text.ToLowerInvariant()
            .Split([' ', '\n', '\r', '\t', '.', ',', '!', '?', ';', ':'], StringSplitOptions.RemoveEmptyEntries);

        var vector = new float[dimensions];
        var rng = new Random(text.GetHashCode());

        for (int i = 0; i < dimensions; i++)
        {
            vector[i] = (float)(rng.NextDouble() * 2 - 1) * 0.1f;
        }

        foreach (var token in tokens)
        {
            var hash = (uint)token.GetHashCode();
            for (int i = 0; i < Math.Min(dimensions, 32); i++)
            {
                var bit = (hash >> i) & 1;
                vector[i] += bit == 1 ? 0.05f : -0.05f;
            }
        }

        var magnitude = Math.Sqrt(vector.Sum(v => v * v));
        if (magnitude > 0)
        {
            for (int i = 0; i < dimensions; i++)
                vector[i] /= (float)magnitude;
        }

        return vector;
    }

    private class EmbeddingResponse
    {
        public float[] Embedding { get; set; } = [];
    }
}
