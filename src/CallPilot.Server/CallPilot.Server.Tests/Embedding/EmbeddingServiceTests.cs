using System.Net;
using System.Net.Http.Json;
using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.AI;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Embedding;
using CallPilot.Server.Infrastructure.Knowledge;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace CallPilot.Server.Tests.EmbeddingTests;

/// <summary>
/// Guards the live-query embedding contract: the query vector used for
/// retrieval on the real-time recommendation path MUST come from the same
/// real model (all-MiniLM-L6-v2, 384-dim, via /api/v1/ai/embeddings) that
/// produced the stored chunk embeddings at ingest.  A token-hash pseudo
/// vector in that path makes cosine similarity measure token overlap
/// instead of semantics — the exact regression this suite prevents.
/// </summary>
public class EmbeddingServiceTests
{
    private const string ModelName = "all-MiniLM-L6-v2";
    private const int ModelDimensions = 384;

    private sealed class StubHandler : HttpMessageHandler
    {
        public int CallCount;
        public string? LastPath;
        public string? LastBody;
        public HttpStatusCode ReturnStatusCode = HttpStatusCode.OK;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            LastPath = request.RequestUri?.AbsolutePath;
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(ReturnStatusCode)
            {
                Content = JsonContent.Create(new
                {
                    embedding = Enumerable.Repeat(1f, ModelDimensions).ToArray(),
                    model = ModelName,
                    dimensions = ModelDimensions
                })
            };
        }
    }

    private static EmbeddingService CreateService(StubHandler handler)
    {
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://ai-engine:8001") };
        return new EmbeddingService(client, NullLogger<EmbeddingService>.Instance);
    }

    [Fact]
    public async Task GenerateEmbeddingAsync_UsesRealModelEndpoint_WithIngestModelAndDimensions()
    {
        var handler = new StubHandler();
        var service = CreateService(handler);

        var vector = await service.GenerateEmbeddingAsync("technical documentation architecture security");

        Assert.NotNull(vector);
        Assert.Equal("/api/v1/ai/embeddings", handler.LastPath);
        Assert.Contains($"\"model\":\"{ModelName}\"", handler.LastBody);
        Assert.Equal(ModelDimensions, vector!.Length);
    }

    [Fact]
    public async Task GenerateEmbeddingAsync_RepeatedQuery_HitsCacheNotTheEngine()
    {
        var handler = new StubHandler();
        var service = CreateService(handler);

        await service.GenerateEmbeddingAsync("pricing plans cost licensing enterprise");
        await service.GenerateEmbeddingAsync("pricing plans cost licensing enterprise");

        Assert.Equal(1, handler.CallCount);
    }

    [Fact]
    public async Task GenerateEmbeddingAsync_ApiFailure_ReturnsNullSoFallbackCanTakeOver()
    {
        var handler = new StubHandler();
        handler.ReturnStatusCode = HttpStatusCode.InternalServerError;
        var service = CreateService(handler);

        var vector = await service.GenerateEmbeddingAsync("any text");

        Assert.Null(vector);
    }

    [Fact]
    public void GenerateLocalEmbedding_MatchesStoredChunkDimensions()
    {
        var service = CreateService(new StubHandler());

        var vector = service.GenerateLocalEmbedding("fallback query");

        Assert.Equal(ModelDimensions, vector.Length);
    }

    [Fact]
    public async Task LiveQueryAndStoredChunks_ShareModelAndDimensionality()
    {
        var options = new DbContextOptionsBuilder<CallPilotDbContext>()
            .UseInMemoryDatabase($"CallPilot_Embedding_{Guid.NewGuid()}")
            .Options;
        await using var db = new CallPilotDbContext(options);

        var userId = Guid.NewGuid();
        var meetingId = Guid.NewGuid();
        var doc = new KnowledgeDocument(userId, "rate-card-2026.md", "text/markdown", 1024);
        db.KnowledgeDocuments.Add(doc);
        await db.SaveChangesAsync();

        var chunk = new KnowledgeChunk(
            doc.Id, 0, "Enterprise tier pricing starts at $12k per year.", 9, 0, 42, source: "fast");
        db.KnowledgeChunks.Add(chunk);
        await db.SaveChangesAsync();

        var storedVector = Enumerable.Repeat(1f, ModelDimensions).ToArray();
        db.Embeddings.Add(new Embedding(chunk.Id, storedVector, ModelName));
        await db.SaveChangesAsync();

        var queryVector = Enumerable.Repeat(1f / MathF.Sqrt(ModelDimensions), ModelDimensions).ToArray();
        var spy = new SpyEmbeddingService(queryVector);
        var engine = new RecommendationEngine(
            new VectorSearchService(db, NullLogger<VectorSearchService>.Instance),
            spy,
            new PromptBuilder(),
            new LlmService(Mock.Of<IHttpClientFactory>(), db, NullLogger<LlmService>.Instance),
            NullLogger<RecommendationEngine>.Instance);

        var evt = new ConversationEvent(
            meetingId, "ProductMentioned", "prodigy", 0.92, "we are looking at the prodigy product");

        var result = await engine.GenerateRecommendationAsync(meetingId, userId, evt);

        Assert.NotNull(result);
        // The live query went through the REAL model path, never the hash fallback.
        Assert.Equal(1, spy.RealEmbeddingCalls);
        Assert.Equal(0, spy.HashEmbeddingCalls);
        // Retrieval found the stored chunk, so the vector pipeline is coherent.
        Assert.Contains("rate-card-2026.md", result!.References);

        var storedEmbedding = await db.Embeddings.SingleAsync();
        Assert.Equal(ModelName, storedEmbedding.Model);
        Assert.Equal(ModelDimensions, storedEmbedding.Dimensions);
    }

    /// <summary>
    /// Records which embedding path the RecommendationEngine exercised,
    /// and answers the live query from the "real" endpoint vector.
    /// </summary>
    private sealed class SpyEmbeddingService : EmbeddingService
    {
        private readonly float[] _realVector;

        public int RealEmbeddingCalls;
        public int HashEmbeddingCalls;

        public SpyEmbeddingService(float[] realVector)
            : base(new HttpClient(), NullLogger<EmbeddingService>.Instance)
        {
            _realVector = realVector;
        }

        public override Task<float[]?> GenerateEmbeddingAsync(string text, string model = ModelName)
        {
            RealEmbeddingCalls++;
            return Task.FromResult<float[]?>(_realVector);
        }

        public override float[] GenerateLocalEmbedding(string text, int dimensions = ModelDimensions)
        {
            HashEmbeddingCalls++;
            return base.GenerateLocalEmbedding(text, dimensions);
        }
    }
}
