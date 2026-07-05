using System.Net.Http.Json;
using CallPilot.Server.Domain.Knowledge;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Embedding;

public class EmbeddingService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<EmbeddingService> _logger;

    public EmbeddingService(HttpClient httpClient, ILogger<EmbeddingService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<float[]?> GenerateEmbeddingAsync(string text, string model = "all-MiniLM-L6-v2")
    {
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
            return result?.Embedding;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate embedding");
            return null;
        }
    }

    public float[] GenerateLocalEmbedding(string text, int dimensions = 384)
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
