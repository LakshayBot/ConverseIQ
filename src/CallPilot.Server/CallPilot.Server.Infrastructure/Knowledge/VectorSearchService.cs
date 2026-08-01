using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Knowledge;

public class VectorSearchService
{
    private readonly CallPilotDbContext _dbContext;
    private readonly ILogger<VectorSearchService> _logger;

    public VectorSearchService(CallPilotDbContext dbContext, ILogger<VectorSearchService> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<IReadOnlyList<KnowledgeChunk>> SearchAsync(float[] queryVector, int topK = 5, Guid? userId = null)
    {
        // Structured product-card chunks (LLM-enriched) are cleaner and less
        // likely to carry letterhead/contact boilerplate — give them a
        // ranking boost over raw extraction chunks.
        const double EnrichedChunkBoost = 1.2;

        try
        {
            var query = _dbContext.KnowledgeChunks
                .Include(c => c.Embedding)
                .Include(c => c.Document)
                .AsQueryable();

            if (userId.HasValue)
            {
                query = query.Where(c => c.Document.UserId == userId.Value);
            }

            var chunks = await query.ToListAsync();

            var scoredChunks = new List<(KnowledgeChunk chunk, double score)>();

            foreach (var chunk in chunks)
            {
                if (chunk.Embedding is null) continue;

                var chunkVector = chunk.Embedding.GetVector();
                var similarity = CosineSimilarity(queryVector, chunkVector);
                if (chunk.Source == "enriched")
                {
                    similarity *= EnrichedChunkBoost;
                }

                scoredChunks.Add((chunk, similarity));
            }

            return scoredChunks
                .OrderByDescending(x => x.score)
                .Take(topK)
                .Select(x => x.chunk)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Vector search failed");
            return [];
        }
    }

    private static double CosineSimilarity(float[] a, float[] b)
    {
        if (a.Length != b.Length) return 0;

        double dotProduct = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.Length; i++)
        {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        if (normA == 0 || normB == 0) return 0;
        return dotProduct / (Math.Sqrt(normA) * Math.Sqrt(normB));
    }
}
