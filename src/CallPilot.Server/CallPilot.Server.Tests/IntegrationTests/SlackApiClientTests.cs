using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CallPilot.Server.Domain.Integrations;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Encryption;
using CallPilot.Server.Infrastructure.Integrations;
using CallPilot.Server.Infrastructure.AI; // ProviderSvc (SafeMask)
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace CallPilot.Server.Tests.IntegrationTests;

/// <summary>
/// Contract tests for the SlackApiClient channel resolution and error
/// mapping. The HTTP layer is stubbed; token resolution runs through the REAL
/// SlackTokenService + ApiKeyEncryptionService over an InMemory database so
/// the "caller never touches the raw token" contract is exercised.
/// </summary>
public class SlackApiClientTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        public List<(string Path, string? Body)> Calls { get; } = new();
        public Func<string, HttpResponseMessage> Responder { get; set; } =
            _ => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"ok\":true}", System.Text.Encoding.UTF8, "application/json"),
            };

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.PathAndQuery;
            var body = request.Content is null
                ? null
                : await request.Content.ReadAsStringAsync(cancellationToken);
            Calls.Add((path, body));
            return Responder(path);
        }
    }

    private sealed class StubFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public StubFactory(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler) { BaseAddress = new Uri("https://slack.com/api/") };
    }

    private static (SlackApiClient Client, StubHandler Handler, Guid UserId, SlackQueue Queue)
        CreateClient()
    {
        var options = new DbContextOptionsBuilder<CallPilotDbContext>()
            .UseInMemoryDatabase($"CallPilot_Slack_{Guid.NewGuid()}")
            .Options;
        var db = new CallPilotDbContext(options);
        var encryption = new ApiKeyEncryptionService(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Encryption:Key"] = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=",
            })
            .Build());
        var tokens = new SlackTokenService(db, encryption, NullLogger<SlackTokenService>.Instance);

        var userId = Guid.NewGuid();
        db.SlackIntegrations.Add(new SlackIntegration(
            userId, encryption.Encrypt("xoxb-fake-token"), "T123", "Test workspace", "U0BOT", null));
        db.SaveChanges();

        var handler = new StubHandler();
        var client = new SlackApiClient(
            new StubFactory(handler),
            tokens,
            new MemoryCache(new MemoryCacheOptions()),
            NullLogger<SlackApiClient>.Instance);
        return (client, handler, userId, new SlackQueue());
    }

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
    };

    [Fact]
    public async Task FindOrCreateChannelAsync_ExistingChannel_ReturnsWithoutCreate()
    {
        var (client, handler, userId, _) = CreateClient();
        handler.Responder = path =>
        {
            if (path.Contains("conversations.list"))
            {
                return Json("""
                    {"ok":true,"channels":[{"id":"C_EXISTING","name":"deal-prodigy-tata-power","is_channel":true}]}
                    """);
            }
            return Json("{\"ok\":true}");
        };

        var id = await client.FindOrCreateChannelAsync(userId, "deal-prodigy-tata-power");

        Assert.Equal("C_EXISTING", id);
        Assert.DoesNotContain(handler.Calls, c => c.Path.Contains("conversations.create"));
    }

    [Fact]
    public async Task FindOrCreateChannelAsync_EmptyList_CreatesChannel()
    {
        var (client, handler, userId, _) = CreateClient();
        handler.Responder = path =>
        {
            if (path.Contains("conversations.list"))
            {
                return Json("""{"ok":true,"channels":[]}""");
            }
            if (path.Contains("conversations.create"))
            {
                return Json("""{"ok":true,"channel":{"id":"C_NEW","name":"deal-prodigy-general"}}""");
            }
            return Json("{\"ok\":true}");
        };

        var id = await client.FindOrCreateChannelAsync(userId, "deal-prodigy-general");

        Assert.Equal("C_NEW", id);
        Assert.Contains(handler.Calls, c => c.Path.Contains("conversations.create"));
    }

    [Fact]
    public async Task FindOrCreateChannelAsync_NameTaken_FallsBackToList()
    {
        var (client, handler, userId, _) = CreateClient();
        var listCalls = 0;
        handler.Responder = path =>
        {
            if (path.Contains("conversations.list"))
            {
                listCalls++;
                // First list: empty (channel doesn't exist yet). Second list
                // (after the create race): the channel exists.
                return listCalls == 1
                    ? Json("""{"ok":true,"channels":[]}""")
                    : Json("""{"ok":true,"channels":[{"id":"C_RACED","name":"deal-prodigy-tata-power"}]}""");
            }
            if (path.Contains("conversations.create"))
            {
                return Json("""{"ok":false,"error":"name_taken"}""");
            }
            return Json("{\"ok\":true}");
        };

        var id = await client.FindOrCreateChannelAsync(userId, "deal-prodigy-tata-power");

        Assert.Equal("C_RACED", id);
        Assert.Equal(2, listCalls);
    }

    [Fact]
    public async Task PostMessageAsync_OkFalse_ThrowsSlackApiException()
    {
        var (client, handler, userId, _) = CreateClient();
        handler.Responder = _ => Json("""{"ok":false,"error":"channel_not_found"}""");

        var ex = await Assert.ThrowsAsync<SlackApiException>(
            () => client.PostMessageAsync(userId, "C_MISSING", new object[] { new { type = "section" } }));
        Assert.Equal("channel_not_found", ex.SlackError);
    }

    [Fact]
    public async Task PostMessageAsync_NoIntegration_ThrowsNotConnected()
    {
        var (client, handler, _, _) = CreateClient();
        var missingUser = Guid.NewGuid();

        var ex = await Assert.ThrowsAsync<SlackApiException>(
            () => client.PostMessageAsync(missingUser, "C1", Array.Empty<object>()));
        Assert.Equal("not_connected", ex.SlackError);
        Assert.Empty(handler.Calls); // never hit the API without a token
    }
}

/// <summary>
/// Worker gates: toggles off / integration inactive skip silently; a 429
/// re-enqueues the notification exactly once.
/// </summary>
public class SlackWorkerTests
{
    private sealed class StubSlackApiClient : SlackApiClient
    {
        public int PostCalls;
        public SlackApiException? PostError;

        public StubSlackApiClient(SlackTokenService tokens)
            : base(new StubHttpClientFactory(), tokens,
                   new MemoryCache(new MemoryCacheOptions()),
                   NullLogger<SlackApiClient>.Instance)
        {
        }

        public override Task<string> FindOrCreateChannelAsync(Guid userId, string channelName)
            => Task.FromResult("C_DEAL");

        public override async Task<string?> PostMessageAsync(Guid userId, string channelId, object[] blocks, string? text = null)
        {
            PostCalls++;
            if (PostError is not null) throw PostError;
            return "1700000000.000100";
        }

        private sealed class StubHttpClientFactory : IHttpClientFactory
        {
            public HttpClient CreateClient(string name) => new();
        }
    }

    private static (CallPilotDbContext Db, SlackQueue Queue, StubSlackApiClient Api, SlackWorker Worker, Guid UserId)
        CreateWorker(bool isActive = true, bool battleCards = true)
    {
        var dbName = $"CallPilot_SlackWorker_{Guid.NewGuid()}";
        var options = new DbContextOptionsBuilder<CallPilotDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;
        var db = new CallPilotDbContext(options);
        var encryption = new ApiKeyEncryptionService(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Encryption:Key"] = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=",
            })
            .Build());
        var tokens = new SlackTokenService(db, encryption, NullLogger<SlackTokenService>.Instance);

        var userId = Guid.NewGuid();
        var integration = new SlackIntegration(userId, encryption.Encrypt("xoxb-fake"), "T123", "WS", "U0", null);
        if (!isActive) integration.Revoke();
        if (!battleCards) integration.SetToggles(false, true, true, true);
        db.SlackIntegrations.Add(integration);
        db.SaveChanges();

        var queue = new SlackQueue();
        var api = new StubSlackApiClient(tokens);

        // The worker opens its own DI scope per notification, so the scoped
        // services it resolves (SlackTokenService / SlackApiClient /
        // ISlackMessageBuilderService) must be registered here — the stub
        // client instance is injected so post calls are observable.
        var services = new ServiceCollection();
        services.AddDbContext<CallPilotDbContext>(o => o.UseInMemoryDatabase(dbName));
        services.AddScoped(_ => tokens);
        services.AddScoped<SlackApiClient>(_ => api);
        services.AddScoped<ISlackMessageBuilderService, SlackMessageBuilderService>();
        var provider = services.BuildServiceProvider();

        var worker = new SlackWorker(
            queue,
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<SlackWorker>.Instance);

        return (db, queue, api, worker, userId);
    }

    private static BattleCardNotification SampleCard(Guid userId) => new()
    {
        UserId = userId,
        MeetingId = Guid.NewGuid(),
        RecommendationId = Guid.NewGuid(),
        Product = "Prodigy",
        TalkingPoint = "tp",
        TriggerType = "keyword",
        Priority = "high",
        Confidence = 0.9,
    };

    [Fact]
    public async Task ProcessAsync_ToggleOff_NeverPosts()
    {
        var (db, queue, api, worker, userId) = CreateWorker(battleCards: false);

        await worker.ProcessAsync(SampleCard(userId));

        Assert.Equal(0, api.PostCalls);
        Assert.Equal(0, queue.PendingCount);
    }

    [Fact]
    public async Task ProcessAsync_IntegrationInactive_NeverPosts()
    {
        var (db, queue, api, worker, userId) = CreateWorker(isActive: false);

        await worker.ProcessAsync(SampleCard(userId));

        Assert.Equal(0, api.PostCalls);
    }

    [Fact]
    public async Task ProcessAsync_ActiveAndEnabled_Posts()
    {
        var (db, queue, api, worker, userId) = CreateWorker();

        await worker.ProcessAsync(SampleCard(userId));

        Assert.Equal(1, api.PostCalls);
        Assert.Equal(0, queue.PendingCount);
    }

    [Fact]
    public async Task ProcessAsync_RateLimited_ReenqueuesExactlyOnce()
    {
        var (db, queue, api, worker, userId) = CreateWorker();
        api.PostError = new SlackApiException("rate_limited");

        await worker.ProcessAsync(SampleCard(userId));

        // One re-enqueue (IsRetry=true), no more than one Post attempt on
        // this direct call (the retry is left for the next dequeue).
        Assert.Equal(1, queue.PendingCount);
        Assert.Equal(1, api.PostCalls);
    }
}
