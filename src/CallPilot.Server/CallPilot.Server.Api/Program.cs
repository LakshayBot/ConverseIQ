using System.Security.Claims;
using System.Text;
using CallPilot.Server.Api.Endpoints;
using CallPilot.Server.Api.Hubs;
using CallPilot.Server.Application.Authentication.Login;
using CallPilot.Server.Application.Authentication.Logout;
using CallPilot.Server.Application.Authentication.Refresh;
using CallPilot.Server.Application.Authentication.Register;
using CallPilot.Server.Application.Knowledge;
using CallPilot.Server.Application.Providers.Create;
using CallPilot.Server.Application.Providers.Delete;
using CallPilot.Server.Application.Providers.List;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.AI;
using CallPilot.Server.Infrastructure.Auth;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Embedding;
using CallPilot.Server.Infrastructure.Encryption;
using CallPilot.Server.Infrastructure.Knowledge;
using CallPilot.Server.Infrastructure.Reliability;
using CallPilot.Server.Shared.Abstractions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.IdentityModel.Tokens;
using Polly;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, loggerConfig) =>
{
    loggerConfig
        .MinimumLevel.Information()
        .WriteTo.Console()
        .ReadFrom.Configuration(context.Configuration);
});

builder.Services.AddDbContext<CallPilotDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

var jwtSecret = builder.Configuration["Jwt:Secret"]!;

// Declared up here so the JWT bearer `OnChallenge` event (below) can
// reuse the same origin list without duplicating the literal.  See the
// CORS comment near `AddCors` for the rationale.
var corsAllowedOrigins = new[] { "http://localhost:3000" };

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "CallPilot",
            ValidAudience = builder.Configuration["Jwt:Audience"] ?? "CallPilot",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            },
            // Re-attach CORS headers on 401 responses.  See the comment
            // above `AddCors` for the full explanation — without this the
            // browser blocks the 401 with "No Access-Control-Allow-Origin
            // header" and the dashboard sees ERR_FAILED instead of a real
            // auth error.
            OnChallenge = context =>
            {
                var origin = context.Request.Headers["Origin"].ToString();
                if (!string.IsNullOrEmpty(origin) &&
                    corsAllowedOrigins.Contains(origin))
                {
                    context.Response.Headers["Access-Control-Allow-Origin"] = origin;
                    context.Response.Headers["Access-Control-Allow-Credentials"] = "true";
                    context.Response.Headers["Vary"] = "Origin";
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSignalR();

// ── CORS ───────────────────────────────────────────────────────────────────
// Dashboard runs on http://localhost:3000 and calls this API on :5001.
// We allow credentials (JWT in Authorization header) so the policy must
// list explicit origins — `AllowAnyOrigin()` is incompatible with
// `AllowCredentials()`.
//
// Why `WithExposedHeaders("*")`: the file-download and chunked endpoints
// return custom headers (Content-Disposition, X-...) that the browser
// would otherwise strip from the JS-visible response.
//
// Why the `OnChallenge` hook on the JWT bearer (below): when an
// authenticated request fails (expired/invalid token), the JWT middleware
// writes a 401 response directly via its challenge handler.  In some
// .NET 8+ pipelines the CORS headers are not yet attached to the response
// at that point, so the browser blocks the 401 with
// "No 'Access-Control-Allow-Origin' header is present" even though the
// CORS middleware is registered.  Re-adding the headers from the challenge
// handler is the documented workaround.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(corsAllowedOrigins)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials()
              .WithExposedHeaders("*")
              .SetPreflightMaxAge(TimeSpan.FromMinutes(10));
    });
});

builder.Services.AddSingleton<IJwtTokenGenerator, JwtTokenGenerator>();
builder.Services.AddSingleton<IPasswordHasher, PasswordHasher>();
builder.Services.AddSingleton<IApiKeyEncryptionService, ApiKeyEncryptionService>();

builder.Services.AddScoped<RegisterHandler>();
builder.Services.AddScoped<LoginHandler>();
builder.Services.AddScoped<RefreshHandler>();
builder.Services.AddScoped<LogoutHandler>();
builder.Services.AddScoped<CreateProviderHandler>();
builder.Services.AddScoped<ListProvidersHandler>();
builder.Services.AddScoped<DeleteProviderHandler>();

builder.Services.AddScoped<RegisterValidator>();
builder.Services.AddScoped<LoginValidator>();
builder.Services.AddScoped<CreateProviderValidator>();

var aiEngineUrl = builder.Configuration["AiEngine:BaseUrl"] ?? "http://localhost:8001";
builder.Services.AddHttpClient<AiCoordinatorService>(client =>
{
    client.BaseAddress = new Uri(aiEngineUrl);
    client.Timeout = TimeSpan.FromSeconds(30);
}).AddTransientHttpErrorPolicy(policy =>
    policy.WaitAndRetryAsync(3, retryAttempt =>
        TimeSpan.FromMilliseconds(Math.Pow(2, retryAttempt) * 200)));

builder.Services.AddHttpClient<EmbeddingService>(client =>
{
    client.BaseAddress = new Uri(aiEngineUrl);
    client.Timeout = TimeSpan.FromSeconds(60);
}).AddTransientHttpErrorPolicy(policy =>
    policy.WaitAndRetryAsync(2, retryAttempt =>
        TimeSpan.FromMilliseconds(Math.Pow(2, retryAttempt) * 500)));

builder.Services.AddHttpClient<EventDetectionService>(client =>
{
    client.BaseAddress = new Uri(aiEngineUrl);
    client.Timeout = TimeSpan.FromSeconds(15);
}).AddTransientHttpErrorPolicy(policy =>
    policy.WaitAndRetryAsync(3, retryAttempt =>
        TimeSpan.FromMilliseconds(Math.Pow(2, retryAttempt) * 100)));

builder.Services.AddHttpClient("LlmClient", client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
}).AddTransientHttpErrorPolicy(policy =>
    policy.WaitAndRetryAsync(2, retryAttempt =>
        TimeSpan.FromMilliseconds(Math.Pow(2, retryAttempt) * 1000)));

builder.Services.AddHttpClient("AiEngine", client =>
{
    client.BaseAddress = new Uri(aiEngineUrl);
    client.Timeout = TimeSpan.FromSeconds(120);
});

builder.Services.AddScoped<RecommendationEngine>();

// Note: AiCoordinatorService, EmbeddingService, EventDetectionService, and LlmService
// are registered via AddHttpClient<T> which auto-registers them as transient.
// No separate AddScoped call needed for those.

builder.Services.AddScoped<VectorSearchService>();
builder.Services.AddScoped<PromptBuilder>();
builder.Services.AddScoped<LlmService>();
builder.Services.AddScoped<RecommendationEngine>();

builder.Services.AddSingleton<ChunkingService>();
builder.Services.AddSingleton<ITextExtractor, PdfTextExtractor>();
builder.Services.AddSingleton<ITextExtractor, DocxTextExtractor>();
builder.Services.AddSingleton<ITextExtractor, MarkdownTextExtractor>();
builder.Services.AddSingleton<TextExtractorFactory>();

builder.Services.AddScoped<KnowledgeUploadHandler>();
builder.Services.AddScoped<StructuredIngestClient>();
builder.Services.AddScoped<EnrichmentClient>();

builder.Services.AddMemoryCache();
builder.Services.AddSingleton<CacheService>();
builder.Services.AddSingleton<MeetingDiagnosticsService>();

builder.Services.AddHealthChecks()
    .AddCheck<DbHealthCheck>("postgresql", failureStatus: HealthStatus.Unhealthy, tags: ["database"])
    .AddCheck("ai-engine", new UrlHealthCheck(aiEngineUrl + "/health"), failureStatus: HealthStatus.Degraded, tags: ["ai"]);

builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();
    try
    {
        // MigrateAsync applies any pending EF Core migrations in order.
        // We previously used EnsureCreatedAsync here, which only creates
        // the schema when the database is empty and silently ignores any
        // migrations added afterwards — that left a previous
        // AddEnrichmentStatus migration unapplied, causing every upload
        // to 500 with "column EnrichmentStatus does not exist".
        // MigrateAsync is idempotent: it applies only what hasn't been
        // applied yet, and is safe to call on every container start.
        await db.Database.MigrateAsync();
        Log.Information("Database migrations applied");
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Failed to apply database migrations");
        throw;
    }
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseSerilogRequestLogging();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { Status = "Healthy", Timestamp = DateTime.UtcNow }));

app.MapHealthChecks("/health/detailed", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var result = new
        {
            status = report.Status.ToString(),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
                duration = e.Value.Duration.TotalMilliseconds
            }),
            totalDuration = report.TotalDuration.TotalMilliseconds
        };
        await context.Response.WriteAsJsonAsync(result);
    }
});

app.MapGet("/api/v1/diagnostics/meetings/{meetingId}", (string meetingId, MeetingDiagnosticsService diag) =>
{
    var metrics = diag.GetMetrics(meetingId);
    if (metrics is null) return Results.NotFound();
    return Results.Ok(new
    {
        meetingId,
        metrics.AudioBytesProcessed,
        metrics.TranscriptCount,
        averageTranscriptLatencyMs = metrics.AverageTranscriptLatencyMs,
        metrics.EventCount,
        eventsByType = metrics.EventsByType.ToDictionary(kvp => kvp.Key, kvp => kvp.Value),
        metrics.RecommendationCount,
        averageRecommendationLatencyMs = metrics.AverageRecommendationLatencyMs,
        metrics.RetryCount
    });
});

app.MapGet("/api/v1/diagnostics", (MeetingDiagnosticsService diag) =>
{
    return Results.Ok(new
    {
        activeMeetings = diag.GetAllMetrics().Count,
        meetings = diag.GetAllMetrics().Select(kvp => new
        {
            meetingId = kvp.Key,
            kvp.Value.TranscriptCount,
            kvp.Value.EventCount,
            kvp.Value.RecommendationCount
        })
    });
});

app.MapAuthenticationEndpoints();
app.MapProviderEndpoints();
app.MapKnowledgeEndpoints();
app.MapHub<DesktopAgentHub>("/hubs/desktop-agent");
app.MapHub<DashboardHub>("/hubs/dashboard");

app.MapPost("/api/v1/meetings", async (CallPilotDbContext db, HttpContext httpContext, ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = new Meeting(Guid.Parse(userIdClaim));
    meeting.Start();
    db.Meetings.Add(meeting);
    await db.SaveChangesAsync();

    return Results.Created($"/api/v1/meetings/{meeting.Id}", new { meetingId = meeting.Id, status = meeting.Status });
}).RequireAuthorization();

app.MapGet("/api/v1/meetings", async (CallPilotDbContext db, ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meetings = await db.Meetings
        .Where(m => m.UserId == Guid.Parse(userIdClaim))
        .OrderByDescending(m => m.CreatedAt)
        .Select(m => new
        {
            id = m.Id,
            status = m.Status,
            createdAt = m.CreatedAt,
            startedAt = m.StartedAt,
            endedAt = m.EndedAt,
        })
        .ToListAsync();

    return Results.Ok(meetings);
}).RequireAuthorization();

app.MapGet("/api/v1/meetings/{id:guid}/transcripts", async (Guid id, CallPilotDbContext db) =>
{
    var segments = await db.TranscriptSegments
        .Where(ts => ts.MeetingId == id)
        .OrderBy(ts => ts.Sequence)
        .Select(ts => new
        {
            ts.Speaker,
            ts.Text,
            ts.Confidence,
            ts.IsFinal,
            ts.Sequence,
            ts.CreatedAt
        })
        .ToListAsync();

    return Results.Ok(segments);
});

app.MapGet("/api/v1/meetings/{id:guid}/recommendations", async (Guid id, CallPilotDbContext db) =>
{
    var recommendations = await db.Recommendations
        .Where(r => r.MeetingId == id)
        .OrderByDescending(r => r.GeneratedAt)
        .ToListAsync();

    return Results.Ok(recommendations);
});

app.MapPost("/api/v1/meetings/{id:guid}/process", async (
    Guid id,
    ClaimsPrincipal user,
    CallPilotDbContext db,
    EventDetectionService eventDetector,
    RecommendationEngine recommendationEngine,
    MeetingDiagnosticsService diagnostics,
    ProcessTextRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var text = body.text;
    if (string.IsNullOrWhiteSpace(text))
        return Results.BadRequest(new { error = "No text provided" });

    var events = await eventDetector.DetectEventsAsync(text);
    var persistedEvents = new List<object>();
    var recommendations = new List<object>();

    foreach (var evt in events)
    {
        diagnostics.TrackEvent(id.ToString(), evt.EventType);

        var conversationEvent = new ConversationEvent(
            id, evt.EventType, evt.EntityName, evt.Confidence,
            text.Length > 1000 ? text[..1000] : text);
        db.ConversationEvents.Add(conversationEvent);
        persistedEvents.Add(new { conversationEvent.Id, conversationEvent.EventType, conversationEvent.EntityName, conversationEvent.Confidence });

        var rec = await recommendationEngine.GenerateRecommendationAsync(
            id, Guid.Parse(userIdClaim), conversationEvent);
        if (rec is not null)
        {
            diagnostics.TrackRecommendation(id.ToString(), 0, "rule-based");
            db.Recommendations.Add(rec);
            recommendations.Add(new { rec.Id, rec.Type, rec.Title, rec.Summary, rec.Confidence, rec.References });
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { events = persistedEvents, recommendations });
}).RequireAuthorization();

// ── Entity Admin (for trie sync) ──────────────────────────────────────────────

app.MapGet("/api/v1/knowledge/entities/all", async (CallPilotDbContext db) =>
{
    var entities = await db.DocumentEntities
        .Select(e => new { e.EntityText, e.EntityType, e.Confidence, e.DocumentId })
        .Distinct()
        .ToListAsync();
    return Results.Ok(new { entities, count = entities.Count });
}).RequireAuthorization();

app.MapPost("/api/v1/knowledge/entities/sync-trie", async (
    CallPilotDbContext db,
    IHttpClientFactory httpClientFactory) =>
{
    var entities = await db.DocumentEntities
        .Select(e => new { entity_text = e.EntityText, entity_type = e.EntityType, document_id = e.DocumentId.ToString() })
        .ToListAsync();

    var client = httpClientFactory.CreateClient("AiEngine");
    var response = await client.PostAsJsonAsync("/api/v1/ai/trie/rebuild", new { entities });
    return response.IsSuccessStatusCode
        ? Results.Ok(new { status = "synced", count = entities.Count })
        : Results.Problem("Trie rebuild failed", statusCode: 500);
}).RequireAuthorization();

// ── Service-to-service entity dump (anonymous, intended for the AI engine) ──
//
// Used by the AI engine's startup hook to populate the Aho-Corasick trie
// from the canonical entity list in PostgreSQL. Anonymous because the AI
// engine runs in the same docker network and doesn't carry a user JWT.
app.MapGet("/internal/knowledge/entities", async (CallPilotDbContext db) =>
{
    var entities = await db.DocumentEntities
        .Select(e => new { entity_text = e.EntityText, entity_type = e.EntityType, document_id = e.DocumentId.ToString() })
        .ToListAsync();
    return Results.Ok(new { entities, count = entities.Count });
});

// ── Internal LLM proxy (used by AI Engine for competitive intel) ────────────

app.MapPost("/internal/llm/generate", async (
    GenerateRequest req,
    LlmService llmService) =>
{
    if (string.IsNullOrEmpty(req.Prompt))
        return Results.BadRequest(new { error = "prompt is required" });

    try
    {
        // Find any enabled provider (userId doesn't matter for internal calls)
        var response = await llmService.GenerateResponseAsync(Guid.Empty, req.Prompt)
            ?? await llmService.GenerateResponseForAnyProviderAsync(req.Prompt);

        return Results.Ok(new { response = response ?? "" });
    }
    catch
    {
        return Results.Ok(new { response = "" });
    }
});

Log.Information("CallPilot Server starting...");

app.Run();

public record GenerateRequest(string Prompt, string? MeetingId);
public record ProcessTextRequest(string text);
