using System.Net.Http.Json;
using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.AI;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Embedding;
using CallPilot.Server.Infrastructure.Knowledge;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace CallPilot.Server.Tests.AiTests;

/// <summary>
/// The contextual (non-keyword) battle-card path: GenerateFromContextualMatchAsync
/// must persist TriggerType="contextual" and preserve the buyer's trigger
/// sentence, and must NOT re-run cosine retrieval (the engine already picked
/// the chunk).
/// </summary>
public class RecommendationEngineContextualTests
{
    private sealed class StubLlmService : LlmService
    {
        private readonly string? _response;
        public int CallCount;

        public StubLlmService(CallPilotDbContext db, string? response)
            : base(Mock.Of<IHttpClientFactory>(), db, NullLogger<LlmService>.Instance)
        {
            _response = response;
        }

        public override Task<string?> GenerateResponseAsync(Guid userId, string prompt)
        {
            CallCount++;
            return Task.FromResult(_response);
        }
    }

    private static CallPilotDbContext CreateDb() => new(
        new DbContextOptionsBuilder<CallPilotDbContext>()
            .UseInMemoryDatabase($"CallPilot_Contextual_{Guid.NewGuid()}")
            .Options);

    [Fact]
    public async Task GenerateFromContextualMatchAsync_PersistsTriggerSpanAndContextualType()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var meetingId = Guid.NewGuid();

        var doc = new KnowledgeDocument(userId, "accuracy-spec.pdf", "application/pdf", 2048);
        db.KnowledgeDocuments.Add(doc);
        var chunk = new KnowledgeChunk(
            doc.Id, 0, "Meter accuracy holds at 99.2% over the first six months of deployment.",
            14, 0, 78, sectionHeading: "Accuracy", source: "structured");
        db.KnowledgeChunks.Add(chunk);
        await db.SaveChangesAsync();

        var llmJson = """
            {"talking_point": "Reassure the buyer with the 99.2% six-month accuracy figure.",
             "key_facts": ["99.2% accuracy over six months"],
             "priority": "medium"}
            """;
        var engine = new RecommendationEngine(
            db,
            new VectorSearchService(db, NullLogger<VectorSearchService>.Instance),
            new EmbeddingService(new System.Net.Http.HttpClient(), NullLogger<EmbeddingService>.Instance),
            new PromptBuilder(),
            new StubLlmService(db, llmJson),
            NullLogger<RecommendationEngine>.Instance);

        var match = new ContextualMatchResult
        {
            ChunkId = chunk.Id,
            ChunkText = chunk.Text,
            Similarity = 0.83,
            TriggerSpan = "does the meter accuracy drift after six months?",
            KnowledgeSource = "structured",
        };

        var result = await engine.GenerateFromContextualMatchAsync(meetingId, userId, match, chunk);

        Assert.NotNull(result);
        Assert.Equal("ContextualMatch", result!.Type);
        Assert.Equal("contextual", result.TriggerType);
        Assert.Equal("does the meter accuracy drift after six months?", result.TriggerSpan);
        Assert.Equal("accuracy-spec.pdf", result.References.Single());
        Assert.Equal(0.83, result.Confidence);
    }

    [Fact]
    public async Task GenerateFromContextualMatchAsync_LlmFails_RuleBasedFallbackStillContextual()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var doc = new KnowledgeDocument(userId, "spec.md", "text/markdown", 100);
        db.KnowledgeDocuments.Add(doc);
        var chunk = new KnowledgeChunk(doc.Id, 0, "Pricing starts at $12k per year for the enterprise tier.", 10, 0, 52);
        db.KnowledgeChunks.Add(chunk);
        await db.SaveChangesAsync();

        var engine = new RecommendationEngine(
            db,
            new VectorSearchService(db, NullLogger<VectorSearchService>.Instance),
            new EmbeddingService(new System.Net.Http.HttpClient(), NullLogger<EmbeddingService>.Instance),
            new PromptBuilder(),
            new StubLlmService(db, response: null),
            NullLogger<RecommendationEngine>.Instance);

        var match = new ContextualMatchResult
        {
            ChunkId = chunk.Id,
            ChunkText = chunk.Text,
            Similarity = 0.75,
            TriggerSpan = "what does this cost for a company our size?",
            KnowledgeSource = "fast",
        };

        var result = await engine.GenerateFromContextualMatchAsync(Guid.NewGuid(), userId, match, chunk);

        Assert.NotNull(result);
        Assert.Equal("contextual", result!.TriggerType);
        Assert.Equal(match.TriggerSpan, result.TriggerSpan);
        Assert.Equal("rule-based", result.Provider);
    }

    [Fact]
    public async Task GenerateFromContextualMatchAsync_MissingChunk_ReturnsNull()
    {
        await using var db = CreateDb();
        var engine = new RecommendationEngine(
            db,
            new VectorSearchService(db, NullLogger<VectorSearchService>.Instance),
            new EmbeddingService(new System.Net.Http.HttpClient(), NullLogger<EmbeddingService>.Instance),
            new PromptBuilder(),
            new StubLlmService(db, response: null),
            NullLogger<RecommendationEngine>.Instance);

        var match = new ContextualMatchResult
        {
            ChunkId = Guid.NewGuid(),
            ChunkText = "ghost",
            Similarity = 0.9,
            TriggerSpan = "span",
            KnowledgeSource = "fast",
        };

        var result = await engine.GenerateFromContextualMatchAsync(Guid.NewGuid(), Guid.NewGuid(), match, chunk: null!);

        Assert.Null(result);
    }
}
