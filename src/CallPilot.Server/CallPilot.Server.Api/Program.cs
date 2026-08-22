using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.SignalR;
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
using CallPilot.Server.Domain.Providers;
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
//
// Tauri origins are included so the desktop Tauri 2 webview can connect
// to /hubs/desktop-agent - the SignalR `negotiate` HTTP call is subject to
// CORS preflight, and the webview origin is otherwise not in the allowlist.
//
// In dev mode (`pnpm tauri:dev`), the webview loads from the Next.js dev
// server at http://localhost:3118 - that is the actual Origin header the
// browser sends. In production builds (`tauri://localhost` and the
// `http(s)://tauri.localhost` variants on macOS/iOS/Android), the webview
// loads from the custom scheme instead.
//
// `null` (the literal 4-character string) is the Origin header WebKit sends
// for sandboxed loads from `tauri://localhost` on macOS - without it the
// preflight comes back 204 with no `Access-Control-Allow-Origin` and the
// browser silently drops the negotiate request as a CORS failure, surfacing
// in the desktop as `TypeError: Load failed`.
var corsAllowedOrigins = new[]
{
    "http://localhost:3000",       // Next.js dashboard
    "http://localhost:3118",       // Tauri 2 dev mode webview (Next.js dev server)
    "http://127.0.0.1:3118",       // Tauri 2 dev mode (IPv4 loopback variant)
    "tauri://localhost",           // Tauri 2 webview prod (Windows / Linux)
    "http://tauri.localhost",      // Tauri 2 webview prod (macOS / iOS / Android)
    "https://tauri.localhost",     // Tauri 2 webview prod (some platforms / dev)
    "null",                        // WKWebView macOS sandboxed Origin
};

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
            // above `AddCors` for the full explanation - without this the
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
// list explicit origins - `AllowAnyOrigin()` is incompatible with
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
builder.Services.AddScoped<CallPilot.Server.Infrastructure.AI.ProviderSvc>();

builder.Services.AddSingleton<CallPilot.Server.Infrastructure.Products.ProductIntelQueue>();
builder.Services.AddScoped<CallPilot.Server.Infrastructure.Products.ProductIntelService>();
builder.Services.AddHostedService<CallPilot.Server.Infrastructure.AI.ProductIntelWorker>();

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
        // migrations added afterwards - that left a previous
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
app.MapKnowledgeEndpoints();
app.MapKnowledgeBaseEndpoints();
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
            title = m.Title,
            status = m.Status,
            createdAt = m.CreatedAt,
            startedAt = m.StartedAt,
            endedAt = m.EndedAt,
            folderPath = m.FolderPath,
        })
        .ToListAsync();

    return Results.Ok(meetings);
}).RequireAuthorization();

// ── Single meeting detail (replaces desktop SQLite api_get_meeting +
//    api_get_meeting_metadata). Includes metadata but not transcripts -
//    use /api/v1/meetings/{id}/transcripts for those.
app.MapGet("/api/v1/meetings/{id:guid}", async (Guid id, CallPilotDbContext db, ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .Where(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim))
        .Select(m => new
        {
            id = m.Id,
            title = m.Title,
            status = m.Status,
            createdAt = m.CreatedAt,
            startedAt = m.StartedAt,
            endedAt = m.EndedAt,
            folderPath = m.FolderPath,
            transcriptCount = db.TranscriptSegments.Count(ts => ts.MeetingId == m.Id),
            eventCount = db.ConversationEvents.Count(e => e.MeetingId == m.Id),
            recommendationCount = db.Recommendations.Count(r => r.MeetingId == m.Id)
        })
        .FirstOrDefaultAsync();

    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });
    return Results.Ok(meeting);
}).RequireAuthorization();

// ── Meeting summary - JSON blob generated client-side by the desktop and
//    persisted here so it survives an app restart. The desktop polls this
//    endpoint to detect when a summary it kicked off has finished. Replaces
//    the desktop SQLite `summary_processes` table.
app.MapGet("/api/v1/meetings/{id:guid}/summary", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .Where(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim))
        .Select(m => new { m.Id, m.SummaryJson })
        .FirstOrDefaultAsync();
    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });

    if (string.IsNullOrEmpty(meeting.SummaryJson))
    {
        return Results.Ok(new { status = "idle", data = (object?)null });
    }

    try
    {
        // The stored envelope is { "status": "...", "data": ... } - return the
        // REAL stored status so the UI can distinguish completed vs failed or
        // a locally-generated summary that hasn't been saved yet.
        var parsed = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(meeting.SummaryJson);
        var storedStatus = parsed.TryGetProperty("status", out var statusProp)
            ? statusProp.GetString()
            : "completed";
        var data = parsed.TryGetProperty("data", out var dataProp) && dataProp.ValueKind != System.Text.Json.JsonValueKind.Null
            ? dataProp
            : (System.Text.Json.JsonElement?)null;
        return Results.Ok(new { status = storedStatus ?? "completed", data });
    }
    catch
    {
        return Results.Ok(new { status = "completed", data = (object?)null });
    }
}).RequireAuthorization();

app.MapPut("/api/v1/meetings/{id:guid}/summary", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    SummaryUpsertRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .FirstOrDefaultAsync(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim));
    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });

    meeting.SetSummaryJson(body.Status, body.Data is null ? null : System.Text.Json.JsonSerializer.Serialize(body.Data));
    await db.SaveChangesAsync();
    return Results.Ok(new { id, status = body.Status });
}).RequireAuthorization();

// ── Delete a meeting + cascade child rows. Replaces desktop SQLite
//    api_delete_meeting. TranscriptSegments / ConversationEvents /
//    Recommendations have ON DELETE CASCADE on MeetingId.
app.MapDelete("/api/v1/meetings/{id:guid}", async (Guid id, CallPilotDbContext db, ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .FirstOrDefaultAsync(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim));
    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });

    db.Meetings.Remove(meeting);
    await db.SaveChangesAsync();
    return Results.Ok(new { id, deleted = true });
}).RequireAuthorization();

// ── Partial update - currently just the user-supplied title and folder
//    path. Replaces desktop SQLite api_save_meeting_title.
app.MapPatch("/api/v1/meetings/{id:guid}", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    MeetingUpdateRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .FirstOrDefaultAsync(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim));
    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });

    if (body.Title is not null) meeting.SetTitle(body.Title);
    if (body.FolderPath is not null) meeting.SetFolderPath(body.FolderPath);
    if (body.MarkEnded == true) meeting.End();

    await db.SaveChangesAsync();
    return Results.Ok(new { id, title = meeting.Title, folderPath = meeting.FolderPath });
}).RequireAuthorization();

// ── Bulk-save final transcript segments for a meeting. Replaces desktop
//    SQLite api_save_transcript. The desktop batches all finalised
//    segments at end-of-recording and posts them in one call.
app.MapPost("/api/v1/meetings/{id:guid}/transcripts", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    BulkTranscriptRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .FirstOrDefaultAsync(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim));
    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });

    // Upsert speakers first (client-supplied ids, meeting-scoped) so the
    // segments below can reference them. Idempotent across re-saves.
    var speakerLabels = new Dictionary<Guid, string>();
    if (body.Speakers is { Count: > 0 } speakers)
    {
        foreach (var sp in speakers)
        {
            var existing = await db.Speakers.FirstOrDefaultAsync(s => s.Id == sp.Id && s.MeetingId == id);
            if (existing is null)
            {
                var created = new CallPilot.Server.Domain.Meetings.Speaker(sp.Id, id, sp.DisplayName, sp.SortOrder);
                db.Speakers.Add(created);
                speakerLabels[sp.Id] = sp.DisplayName;
            }
            else
            {
                if (existing.DisplayName != sp.DisplayName) existing.Rename(sp.DisplayName);
                speakerLabels[sp.Id] = existing.DisplayName;
            }
        }
        await db.SaveChangesAsync();
    }

    // Existing segments get deleted first so re-saves (e.g., retranscription)
    // are idempotent. Idempotent saves keep desktop retry logic simple.
    var existingSegments = db.TranscriptSegments.Where(ts => ts.MeetingId == id);
    db.TranscriptSegments.RemoveRange(existingSegments);

    if (body.Segments is { Count: > 0 } segments)
    {
        var entities = segments.Select(s => new TranscriptSegment(
            id,
            s.Speaker ?? (s.SpeakerId is { } sid && speakerLabels.TryGetValue(sid, out var label) ? label : string.Empty),
            s.Text,
            s.Confidence,
            s.StartOffset,
            s.EndOffset,
            s.IsFinal,
            s.Sequence,
            s.SpeakerId)).ToList();
        db.TranscriptSegments.AddRange(entities);
    }

    if (body.Title is not null) meeting.SetTitle(body.Title);
    if (body.FolderPath is not null) meeting.SetFolderPath(body.FolderPath);
    if (body.MarkEnded == true) meeting.End();

    await db.SaveChangesAsync();
    return Results.Ok(new { id, savedSegments = body.Segments?.Count ?? 0 });
}).RequireAuthorization();

app.MapGet("/api/v1/meetings/{id:guid}/transcripts", async (Guid id, CallPilotDbContext db) =>
{
    var segments = await db.TranscriptSegments
        .Where(ts => ts.MeetingId == id)
        .OrderBy(ts => ts.Sequence)
        .Select(ts => new
        {
            ts.Id,
            ts.Speaker,
            ts.SpeakerId,
            ts.Text,
            ts.Confidence,
            ts.IsFinal,
            ts.Sequence,
            ts.CreatedAt,
            // Recording-relative offsets - the desktop renders these as the
            // [MM:SS] transcript column; without them every segment shows 00:00.
            ts.StartOffset,
            ts.EndOffset
        })
        .ToListAsync();

    return Results.Ok(segments);
});

// ── Speaker management (per-meeting speaker diarization). Speakers are
//    upserted by client-supplied id so the desktop can reuse them across
//    idempotent saves; renames and merges update every referencing segment.
app.MapGet("/api/v1/meetings/{id:guid}/speakers", async (Guid id, CallPilotDbContext db) =>
{
    var speakers = await db.Speakers
        .Where(s => s.MeetingId == id)
        .OrderBy(s => s.SortOrder)
        .Select(s => new
        {
            s.Id,
            s.DisplayName,
            s.SortOrder,
            s.CreatedAt,
            s.UpdatedAt,
            segmentCount = db.TranscriptSegments.Count(ts => ts.SpeakerId == s.Id),
            totalSpeakingTime = db.TranscriptSegments
                .Where(ts => ts.SpeakerId == s.Id)
                .Sum(ts => ts.EndOffset - ts.StartOffset)
        })
        .ToListAsync();

    return Results.Ok(speakers);
}).RequireAuthorization();

app.MapPost("/api/v1/meetings/{id:guid}/speakers", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    List<BulkSpeaker> body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .FirstOrDefaultAsync(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim));
    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });

    if (body is { Count: > 0 })
    {
        foreach (var sp in body)
        {
            var existing = await db.Speakers.FirstOrDefaultAsync(s => s.Id == sp.Id && s.MeetingId == id);
            if (existing is null)
            {
                db.Speakers.Add(new CallPilot.Server.Domain.Meetings.Speaker(sp.Id, id, sp.DisplayName, sp.SortOrder));
            }
            else if (existing.DisplayName != sp.DisplayName)
            {
                existing.Rename(sp.DisplayName);
            }
        }
        await db.SaveChangesAsync();
    }

    var saved = await db.Speakers
        .Where(s => s.MeetingId == id)
        .OrderBy(s => s.SortOrder)
        .Select(s => new { s.Id, s.DisplayName, s.SortOrder })
        .ToListAsync();
    return Results.Ok(saved);
}).RequireAuthorization();

app.MapPatch("/api/v1/meetings/{id:guid}/speakers/{speakerId:guid}", async (
    Guid id,
    Guid speakerId,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    SpeakerRenameRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var speaker = await db.Speakers
        .FirstOrDefaultAsync(s => s.Id == speakerId && s.MeetingId == id);
    if (speaker is null) return Results.NotFound(new { error = "Speaker not found" });

    speaker.Rename(body.DisplayName);
    // Keep the denormalized per-segment label in sync so legacy clients
    // reading the Speaker string still see the renamed name.
    var segments = await db.TranscriptSegments
        .Where(ts => ts.SpeakerId == speakerId)
        .ToListAsync();
    foreach (var segment in segments) segment.AssignSpeaker(speakerId, speaker.DisplayName);

    await db.SaveChangesAsync();
    return Results.Ok(new { id = speaker.Id, displayName = speaker.DisplayName, sortOrder = speaker.SortOrder });
}).RequireAuthorization();

app.MapPost("/api/v1/meetings/{id:guid}/speakers/{speakerId:guid}/merge", async (
    Guid id,
    Guid speakerId,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    SpeakerMergeRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();
    if (body.TargetSpeakerId == speakerId) return Results.BadRequest(new { error = "Cannot merge a speaker into itself" });

    var source = await db.Speakers
        .FirstOrDefaultAsync(s => s.Id == speakerId && s.MeetingId == id);
    var target = await db.Speakers
        .FirstOrDefaultAsync(s => s.Id == body.TargetSpeakerId && s.MeetingId == id);
    if (source is null || target is null) return Results.NotFound(new { error = "Speaker not found" });

    var segments = await db.TranscriptSegments
        .Where(ts => ts.SpeakerId == speakerId)
        .ToListAsync();
    foreach (var segment in segments) segment.AssignSpeaker(target.Id, target.DisplayName);

    db.Speakers.Remove(source);
    await db.SaveChangesAsync();
    return Results.Ok(new { merged = source.Id, into = target.Id, reassignedSegments = segments.Count });
}).RequireAuthorization();

app.MapDelete("/api/v1/meetings/{id:guid}/speakers/{speakerId:guid}", async (
    Guid id,
    Guid speakerId,
    CallPilotDbContext db,
    ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var speaker = await db.Speakers
        .FirstOrDefaultAsync(s => s.Id == speakerId && s.MeetingId == id);
    if (speaker is null) return Results.NotFound(new { error = "Speaker not found" });

    var segments = await db.TranscriptSegments
        .Where(ts => ts.SpeakerId == speakerId)
        .ToListAsync();
    foreach (var segment in segments) segment.AssignSpeaker(null, string.Empty);

    db.Speakers.Remove(speaker);
    await db.SaveChangesAsync();
    return Results.Ok(new { deleted = speakerId });
}).RequireAuthorization();

// ── Bulk speaker assignments (post-hoc diarization of existing meetings).
//    Each assignment validates that both the segment and the speaker belong
//    to the meeting, and refreshes the denormalized Speaker label.
app.MapPost("/api/v1/meetings/{id:guid}/transcripts/speaker-assignments", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    SpeakerAssignmentsRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var meeting = await db.Meetings
        .FirstOrDefaultAsync(m => m.Id == id && m.UserId == Guid.Parse(userIdClaim));
    if (meeting is null) return Results.NotFound(new { error = "Meeting not found" });

    var assignments = body.Assignments ?? new List<SpeakerAssignmentRequest>();
    if (assignments.Count == 0) return Results.Ok(new { updated = 0 });

    var assignmentMap = assignments.ToDictionary(a => a.SegmentId, a => a.SpeakerId);
    var segmentIds = assignmentMap.Keys.ToList();
    var speakerIds = assignmentMap.Values.Distinct().ToList();

    var segments = await db.TranscriptSegments
        .Where(ts => ts.MeetingId == id && segmentIds.Contains(ts.Id))
        .ToListAsync();
    var speakers = await db.Speakers
        .Where(s => s.MeetingId == id && speakerIds.Contains(s.Id))
        .ToDictionaryAsync(s => s.Id);

    var updated = 0;
    foreach (var segment in segments)
    {
        if (assignmentMap.TryGetValue(segment.Id, out var speakerId) &&
            speakers.TryGetValue(speakerId, out var speaker))
        {
            segment.AssignSpeaker(speakerId, speaker.DisplayName);
            updated++;
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { updated });
}).RequireAuthorization();

app.MapGet("/api/v1/meetings/{id:guid}/recommendations", async (Guid id, CallPilotDbContext db) =>
{
    var recommendations = await db.Recommendations
        .Where(r => r.MeetingId == id)
        .OrderByDescending(r => r.GeneratedAt)
        .ToListAsync();

    return Results.Ok(recommendations);
});

// Fetch persisted ConversationEvents for a past meeting so the desktop
// meeting-details view can reconstruct the intelligence cards the user saw
// during the live recording. Ordered by DetectedAt asc so the timeline reads
// in conversation order (matches the SignalR broadcast order the desktop
// originally consumed them in).
app.MapGet("/api/v1/meetings/{id:guid}/events", async (Guid id, CallPilotDbContext db) =>
{
    var events = await db.ConversationEvents
        .Where(e => e.MeetingId == id)
        .OrderBy(e => e.DetectedAt)
        .Select(e => new
        {
            e.Id,
            e.EventType,
            e.EntityName,
            e.Confidence,
            e.SupportingTranscript,
            e.DetectedAt
        })
        .ToListAsync();

    return Results.Ok(events);
});

app.MapPost("/api/v1/meetings/{id:guid}/process", async (
    Guid id,
    ClaimsPrincipal user,
    CallPilotDbContext db,
    EventDetectionService eventDetector,
    RecommendationEngine recommendationEngine,
    MeetingDiagnosticsService diagnostics,
    IHubContext<DesktopAgentHub> hubContext,
    CallPilot.Server.Infrastructure.Products.ProductIntelQueue productIntelQueue,
    ProcessTextRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var text = body.text;
    if (string.IsNullOrWhiteSpace(text))
        return Results.BadRequest(new { error = "No text provided" });

    // Broadcast events/recommendations to the same SignalR group the
    // DesktopAgentHub uses (`meeting_{id}`), so any client joined to that
    // meeting (desktop Tauri app, web dashboard, .NET CLI agent) sees the
    // live cards. Payload shapes mirror DesktopAgentHub.ProcessTranscriptAsync
    // (Hubs/DesktopAgentHub.cs:157-166, 183-192) so existing consumers work
    // without changes.
    var groupName = $"meeting_{id}";

    var events = await eventDetector.DetectEventsAsync(text, id.ToString());
    var persistedEvents = new List<object>();
    var recommendations = new List<object>();

    foreach (var evt in events)
    {
        diagnostics.TrackEvent(id.ToString(), evt.EventType);

        var conversationEvent = new ConversationEvent(
            id, evt.EventType, evt.EntityName, evt.Confidence,
            text.Length > 1000 ? text[..1000] : text);
        db.ConversationEvents.Add(conversationEvent);
        await db.SaveChangesAsync();
        persistedEvents.Add(new { conversationEvent.Id, conversationEvent.EventType, conversationEvent.EntityName, conversationEvent.Confidence });

        if (evt.EventType == "ProductMentioned" && !string.IsNullOrWhiteSpace(evt.EntityName))
        {
            productIntelQueue.Enqueue(
                CallPilot.Server.Infrastructure.Products.ProductIntelService.NormalizeName(evt.EntityName),
                conversationEvent.SupportingTranscript);
        }

        await hubContext.Clients.Group(groupName).SendAsync("EventDetected", new
        {
            conversationEvent.Id,
            conversationEvent.EventType,
            conversationEvent.EntityName,
            conversationEvent.Confidence,
            conversationEvent.DetectedAt,
            supportingTranscript = conversationEvent.SupportingTranscript
        });

        var rec = await recommendationEngine.GenerateRecommendationAsync(
            id, Guid.Parse(userIdClaim), conversationEvent);
        if (rec is not null)
        {
            diagnostics.TrackRecommendation(id.ToString(), 0, "rule-based");
            db.Recommendations.Add(rec);
            await db.SaveChangesAsync();
            recommendations.Add(new { rec.Id, rec.Type, rec.Title, rec.Summary, rec.Confidence, rec.References });

            await hubContext.Clients.Group(groupName).SendAsync("RecommendationGenerated", new
            {
                rec.Id,
                rec.Type,
                rec.Title,
                rec.Summary,
                rec.TalkingPoint,
                rec.KeyFacts,
                rec.Priority,
                triggerEventId = conversationEvent.Id,
                rec.Confidence,
                rec.References,
                rec.GeneratedAt
            });
        }
    }

    return Results.Ok(new { events = persistedEvents, recommendations });
}).RequireAuthorization();

// ── Product Intelligence (global, canonical product profiles) ───────────────
// Read path returns the cached profile; when a product has never been
// enriched (or its previous enrichment failed/expired) it creates the row
// and enqueues background research, so the UI can show a loading state and
// the result lands asynchronously. Enrichment itself lives in the AI engine
// (Tavily + LLM) and is persisted here - never repeated for cached products.

app.MapGet("/api/v1/products/intelligence/{name}", async (
    string name,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.Products.ProductIntelService productIntelService) =>
{
    if (string.IsNullOrWhiteSpace(name))
        return Results.BadRequest(new { error = "Product name is required" });

    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId)) return Results.Unauthorized();

    // READ-ONLY: retrieving a product never starts enrichment. Enrichment is
    // only initiated by the background ingest pipeline or an explicit action.
    var dto = await productIntelService.GetAsync(name, userId);
    return Results.Ok(dto);
}).RequireAuthorization();

app.MapGet("/api/v1/products/intelligence/{name}/sources", async (
    string name,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.Products.ProductIntelService productIntelService) =>
{
    if (string.IsNullOrWhiteSpace(name))
        return Results.BadRequest(new { error = "Product name is required" });

    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId)) return Results.Unauthorized();

    var sources = await productIntelService.GetSourcesAsync(name, userId);
    return Results.Ok(new { sources });
}).RequireAuthorization();

app.MapPost("/api/v1/products/intelligence/{name}/enrich", async (
    string name,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.Products.ProductIntelService productIntelService) =>
{
    if (string.IsNullOrWhiteSpace(name))
        return Results.BadRequest(new { error = "Product name is required" });

    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId)) return Results.Unauthorized();

    var dto = await productIntelService.ForceReenrichAsync(name, userId);
    return Results.Ok(dto);
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

// ── Transcript search (replaces desktop SQLite api_search_transcripts).
//    ILIKE-based - simple, correct, and good enough for the desktop sidebar.
//    Returns up to 50 results per query. Each hit carries the meeting id,
//    title, and a 200-char match snippet (truncation is done client-side
//    after the query because slice operators aren't allowed inside an
//    expression tree).
app.MapGet("/api/v1/search", async (
    string? q,
    int? limit,
    CallPilotDbContext db,
    ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(q)) return Results.Ok(Array.Empty<object>());

    var max = Math.Clamp(limit ?? 50, 1, 200);
    var pattern = $"%{q.Trim()}%";

    var raw = await (
        from ts in db.TranscriptSegments
        join m in db.Meetings on ts.MeetingId equals m.Id
        where m.UserId == Guid.Parse(userIdClaim)
              && EF.Functions.ILike(ts.Text, pattern)
        orderby ts.CreatedAt descending
        select new
        {
            id = m.Id,
            meetingId = m.Id,
            title = m.Title ?? "Untitled session",
            text = ts.Text,
            timestamp = ts.CreatedAt
        })
        .Take(max)
        .ToListAsync();

    var hits = raw.Select(h => new
    {
        h.id,
        meetingId = h.meetingId,
        title = h.title,
        text = h.text,
        timestamp = h.timestamp,
        matchContext = h.text.Length > 200 ? h.text[..200] + "…" : h.text
    });

    return Results.Ok(hits);
}).RequireAuthorization();

// ── Provider configuration (replaces desktop SQLite
//    api_get_model_config / api_save_model_config /
//    api_get_api_key / api_get_custom_openai_config /
//    api_save_custom_openai_config / api_test_custom_openai_connection).
//    Backed by the same ProviderConfiguration entity the existing
//    CreateProviderHandler / ListProvidersHandler / DeleteProviderHandler
//    already manage.
app.MapGet("/api/v1/providers", async (CallPilotDbContext db, ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var providers = await db.ProviderConfigurations
        .Where(p => p.UserId == Guid.Parse(userIdClaim) && p.DeletedAt == null)
        .Select(p => new
        {
            id = p.Id,
            providerType = p.ProviderType,
            model = p.Model,
            endpoint = p.Endpoint,
            temperature = p.Temperature,
            maxTokens = p.MaxTokens,
            timeoutSeconds = p.TimeoutSeconds,
            isEnabled = p.IsEnabled
        })
        .ToListAsync();

    return Results.Ok(providers);
}).RequireAuthorization();

// SECURITY: the old /api/v1/providers/{id}/api-key endpoint returned the
// DECRYPTED plaintext key to the client.  That is removed.  The frontend now
// only ever receives a masked form (gsk_****abcd) + a hasKey boolean; the
// plaintext key is decrypted only server-side, immediately before a provider
// call (see ProviderSvc.ResolveFeatureAsync).
app.MapGet("/api/v1/providers/{id:guid}/api-key", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user,
    IApiKeyEncryptionService encryption) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var provider = await db.ProviderConfigurations
        .FirstOrDefaultAsync(p => p.Id == id && p.UserId == Guid.Parse(userIdClaim) && p.DeletedAt == null);
    if (provider is null) return Results.NotFound(new { error = "Provider not found" });

    if (string.IsNullOrWhiteSpace(provider.EncryptedApiKey))
        return Results.Ok(new { hasKey = false, apiKey = (string?)null });

    // Decrypt ONLY to derive the masked display value; the full key never
    // leaves this handler.
    string masked;
    try
    {
        var plaintext = encryption.Decrypt(provider.EncryptedApiKey);
        masked = CallPilot.Server.Infrastructure.AI.ProviderSvc.SafeMask(plaintext);
    }
    catch
    {
        masked = "****";
    }
    return Results.Ok(new { hasKey = true, apiKey = masked });
}).RequireAuthorization();

// Upsert a provider config keyed by ProviderType (so the desktop's
// "summary model" config - a single record per provider type - is
// idempotent across re-saves). Replaces api_save_model_config +
// api_save_custom_openai_config.
app.MapPost("/api/v1/providers", async (
    CallPilotDbContext db,
    ClaimsPrincipal user,
    IApiKeyEncryptionService encryption,
    ProviderUpsertRequest body) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();
    var userId = Guid.Parse(userIdClaim);

    var encrypted = encryption.Encrypt(body.ApiKey ?? "");
    var existing = await db.ProviderConfigurations
        .FirstOrDefaultAsync(p => p.UserId == userId && p.ProviderType == body.ProviderType && p.DeletedAt == null);

    if (existing is not null)
    {
        existing.Update(body.Model, body.Endpoint, encrypted, body.Temperature, body.MaxTokens, body.TimeoutSeconds);
        await db.SaveChangesAsync();
        return Results.Ok(new
        {
            id = existing.Id,
            providerType = existing.ProviderType,
            model = existing.Model,
            endpoint = existing.Endpoint,
            temperature = existing.Temperature,
            maxTokens = existing.MaxTokens,
            timeoutSeconds = existing.TimeoutSeconds
        });
    }

    var provider = new ProviderConfiguration(
        userId, body.ProviderType, body.Model, body.Endpoint, encrypted,
        body.Temperature, body.MaxTokens, body.TimeoutSeconds);
    db.ProviderConfigurations.Add(provider);
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        id = provider.Id,
        providerType = provider.ProviderType,
        model = provider.Model,
        endpoint = provider.Endpoint,
        temperature = provider.Temperature,
        maxTokens = provider.MaxTokens,
        timeoutSeconds = provider.TimeoutSeconds
    });
}).RequireAuthorization();

app.MapDelete("/api/v1/providers/{id:guid}", async (
    Guid id,
    CallPilotDbContext db,
    ClaimsPrincipal user) =>
{
    var userIdClaim = user.FindFirst("userId")?.Value;
    if (userIdClaim is null) return Results.Unauthorized();

    var provider = await db.ProviderConfigurations
        .FirstOrDefaultAsync(p => p.Id == id && p.UserId == Guid.Parse(userIdClaim) && p.DeletedAt == null);
    if (provider is null) return Results.NotFound(new { error = "Provider not found" });

    provider.MarkDeleted();
    await db.SaveChangesAsync();
    return Results.Ok(new { id, deleted = true });
}).RequireAuthorization();

// ── Internal LLM proxy (used by AI Engine for competitive intel) ────────────

// ── BYOK AI provider management (user-api-key settings) ───────────────
//
// These endpoints back the dedicated "AI Providers" section.  They extend the
// existing ProviderConfiguration storage with feature preferences, local usage
// tracking, limit snapshots and provider-aware model discovery.  The desktop/
// dashboard send the plaintext key ONLY on create/update; every read returns a
// masked key + connection status.

// Provider overview: connected providers + masked keys + feature usage.
app.MapGet("/api/v1/ai/providers", async (
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var providers = await svc.ListAsync(userId.Value);
    return Results.Ok(new { providers, features = CallPilot.Server.Infrastructure.AI.AiFeatures.All });
}).RequireAuthorization();

// Key test for an ALREADY-CONNECTED provider: uses the stored (encrypted)
// probe the provider through the AI engine and return validity + a mapped
// error code.  Never stores the key in this call.
app.MapPost("/api/v1/ai/providers/test", async (
    ClaimsPrincipal user,
    ProviderTestRequest body,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var result = await svc.TestKeyAsync(userId.Value, body.ProviderType, body.ApiKey, body.Endpoint);
    return Results.Ok(new { valid = result.Valid, errorCode = result.ErrorCode, error = result.Error });
}).RequireAuthorization();

// Key test for an ALREADY-CONNECTED provider: probes with the stored,
// server-side-decrypted key (the client never supplies or sees it).
app.MapPost("/api/v1/ai/providers/{id:guid}/test", async (
    Guid id,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var result = await svc.TestStoredProviderAsync(userId.Value, id);
    return Results.Ok(new { valid = result.Valid, errorCode = result.ErrorCode, error = result.Error });
}).RequireAuthorization();

// Model discovery for a provider the user has ALREADY connected.  Uses the
// stored (encrypted) key server-side - the client never sees the plaintext.
app.MapGet("/api/v1/ai/providers/{id:guid}/models", async (
    Guid id,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var models = await svc.ListModelsForProviderAsync(userId.Value, id);
    return Results.Ok(new { models });
}).RequireAuthorization();

// Model discovery for a provider key (live where supported, curated fallback
// for Anthropic / failures).
app.MapPost("/api/v1/ai/providers/models", async (
    ClaimsPrincipal user,
    ProviderTestRequest body,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var models = await svc.ListModelsAsync(userId.Value, body.ProviderType, body.ApiKey, body.Endpoint);
    return Results.Ok(new { models });
}).RequireAuthorization();

// Upsert (create or replace) a connected provider + key.
app.MapPost("/api/v1/ai/providers", async (
    ClaimsPrincipal user,
    UpsertProviderRequest body,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var dto = await svc.UpsertAsync(userId.Value, body);
    return Results.Ok(dto);
}).RequireAuthorization();

// Delete (soft) a connected provider.
app.MapDelete("/api/v1/ai/providers/{id:guid}", async (
    Guid id,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var ok = await svc.DeleteAsync(userId.Value, id);
    return ok ? Results.Ok(new { id, deleted = true }) : Results.NotFound(new { error = "Provider not found" });
}).RequireAuthorization();

// Feature preference: which provider+model serves a feature.
app.MapGet("/api/v1/ai/preferences/{feature}", async (
    string feature,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var pref = await svc.GetFeaturePreferenceAsync(userId.Value, feature);
    return pref is null
        ? Results.Ok(new { feature, providerConfigurationId = (Guid?)null, model = (string?)null })
        : Results.Ok(pref);
}).RequireAuthorization();

// Set feature preference (the user chooses knowledge processing -> provider -> model).
app.MapPut("/api/v1/ai/preferences/{feature}", async (
    string feature,
    SetFeaturePreferenceRequest body,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var pref = await svc.SetFeaturePreferenceAsync(userId.Value, feature, body.ProviderConfigurationId, body.Model);
    return Results.Ok(pref);
}).RequireAuthorization();

// Local CallPilot usage (what CallPilot consumed through the user key).
app.MapGet("/api/v1/ai/usage", async (
    Guid? providerId,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var usage = await svc.GetUsageAsync(userId.Value, providerId);
    return Results.Ok(usage);
}).RequireAuthorization();

// Provider rate-limit snapshot history (labeled "snapshot", never implied permanent).
app.MapGet("/api/v1/ai/providers/{id:guid}/limits", async (
    Guid id,
    ClaimsPrincipal user,
    CallPilot.Server.Infrastructure.AI.ProviderSvc svc) =>
{
    var userId = ClaimsHelpers.ClaimsUserId(user);
    if (userId is null) return Results.Unauthorized();
    var limits = await svc.GetLimitsAsync(userId.Value, id);
    return Results.Ok(new { limits, note = "Snapshot as reported by the provider; may change." });
}).RequireAuthorization();

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

// DTOs for the desktop-migration endpoints. Kept as records so JSON
// deserialisation follows the camelCase convention the desktop already
// uses (meetingId, folderPath, markEnded, startOffset, etc.).
public record MeetingUpdateRequest(
    string? Title,
    string? FolderPath,
    bool? MarkEnded);

public record BulkTranscriptRequest(
    string? Title,
    string? FolderPath,
    bool? MarkEnded,
    List<BulkTranscriptSegment>? Segments,
    List<BulkSpeaker>? Speakers);

public record BulkTranscriptSegment(
    string Text,
    string? Speaker,
    double Confidence,
    double StartOffset,
    double EndOffset,
    bool IsFinal,
    int Sequence,
    Guid? SpeakerId = null);

// Speakers are upserted by client-supplied id (the desktop mints stable
// per-meeting speaker ids at diarization time) so idempotent bulk saves
// reuse the same rows instead of duplicating them.
public record BulkSpeaker(
    Guid Id,
    string DisplayName,
    int SortOrder);

public record SpeakerRenameRequest(string DisplayName);

public record SpeakerMergeRequest(Guid TargetSpeakerId);

public record SpeakerAssignmentRequest(Guid SegmentId, Guid SpeakerId);

public record SpeakerAssignmentsRequest(List<SpeakerAssignmentRequest>? Assignments);

public record SummaryUpsertRequest(
    string Status,
    object? Data);

public record ProviderUpsertRequest(
    string ProviderType,
    string Model,
    string? Endpoint,
    string? ApiKey,
    double Temperature,
    int MaxTokens,
    int TimeoutSeconds);

// ── BYOK request/response DTOs ────────────────────────────────────────────

public record ProviderTestRequest(
    string ProviderType,
    string ApiKey,
    string? Endpoint);

public record SetFeaturePreferenceRequest(
    Guid? ProviderConfigurationId,
    string? Model);

/// <summary>Read the authenticated userId claim or null (top-level helper).</summary>
public static class ClaimsHelpers
{
    public static Guid? ClaimsUserId(System.Security.Claims.ClaimsPrincipal user)
    {
        var claim = user.FindFirst("userId")?.Value;
        return claim is not null && Guid.TryParse(claim, out var id) ? id : (Guid?)null;
    }
}
