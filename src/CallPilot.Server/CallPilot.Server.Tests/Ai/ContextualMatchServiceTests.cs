using System.Net;
using System.Net.Http.Json;
using CallPilot.Server.Infrastructure.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CallPilot.Server.Tests.AiTests;

/// <summary>
/// Contract tests for the contextual (non-keyword) match client. The service
/// must fail silently — 204, errors, and engine timeouts all map to null so
/// the transcript pipeline is never stalled by a slow AI engine.
/// </summary>
public class ContextualMatchServiceTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        public HttpStatusCode ReturnStatusCode = HttpStatusCode.OK;
        public string? ResponseJson;
        public TimeSpan? Delay;
        public string? LastPath;
        public string? LastBody;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (Delay is { } delay)
            {
                await Task.Delay(delay, cancellationToken);
            }

            LastPath = request.RequestUri?.AbsolutePath;
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);

            var response = new HttpResponseMessage(ReturnStatusCode);
            if (ResponseJson is not null)
            {
                response.Content = new StringContent(ResponseJson, System.Text.Encoding.UTF8, "application/json");
            }
            return response;
        }
    }

    private static ContextualMatchService CreateService(StubHandler handler)
    {
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://ai-engine:8001") };
        return new ContextualMatchService(client, NullLogger<ContextualMatchService>.Instance);
    }

    private static readonly string ValidMatchJson = """
        {
            "chunk_id": "3f2b8c54-1a2b-4c3d-8e9f-001122334455",
            "chunk_text": "Meter accuracy holds at 99.2% over the first six months.",
            "similarity": 0.81,
            "trigger_span": "how accurate are the meters after a few months",
            "knowledge_source": "enriched"
        }
        """;

    [Fact]
    public async Task MatchAsync_EngineReturns204_ReturnsNull()
    {
        var handler = new StubHandler { ReturnStatusCode = HttpStatusCode.NoContent };
        var service = CreateService(handler);

        var result = await service.MatchAsync("how accurate are the meters", Guid.NewGuid(), Guid.NewGuid());

        Assert.Null(result);
        Assert.Equal("/api/v1/ai/contextual-match", handler.LastPath);
    }

    [Fact]
    public async Task MatchAsync_EngineReturnsValidJson_ParsesResult()
    {
        var handler = new StubHandler { ResponseJson = ValidMatchJson };
        var service = CreateService(handler);

        var meetingId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var result = await service.MatchAsync("how accurate are the meters", meetingId, userId);

        Assert.NotNull(result);
        Assert.Equal(Guid.Parse("3f2b8c54-1a2b-4c3d-8e9f-001122334455"), result!.ChunkId);
        Assert.Equal("how accurate are the meters after a few months", result.TriggerSpan);
        Assert.Equal(0.81, result.Similarity);
        Assert.Equal("enriched", result.KnowledgeSource);
        // Engine contract: snake_case body per the /api/v1/ai/contextual-match spec.
        Assert.Contains("\"turn_text\"", handler.LastBody);
        Assert.Contains("\"user_id\"", handler.LastBody);
    }

    [Fact]
    public async Task MatchAsync_EngineExceedsTimeoutBudget_ReturnsNull()
    {
        // Engine stalls 350ms; the service's hard budget is 300ms.
        var handler = new StubHandler
        {
            ResponseJson = ValidMatchJson,
            Delay = TimeSpan.FromMilliseconds(350),
        };
        var service = CreateService(handler);

        var result = await service.MatchAsync("any turn", Guid.NewGuid(), Guid.NewGuid());

        Assert.Null(result);
    }

    [Fact]
    public async Task MatchAsync_EngineErrors_ReturnsNull()
    {
        var handler = new StubHandler { ReturnStatusCode = HttpStatusCode.InternalServerError };
        var service = CreateService(handler);

        var result = await service.MatchAsync("any turn", Guid.NewGuid(), Guid.NewGuid());

        Assert.Null(result);
    }
}
