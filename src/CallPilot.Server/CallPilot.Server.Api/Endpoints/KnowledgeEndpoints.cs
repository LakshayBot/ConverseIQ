using System.Security.Claims;
using CallPilot.Server.Application.Knowledge;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Api.Endpoints;

public static class KnowledgeEndpoints
{
    public static void MapKnowledgeEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/knowledge").RequireAuthorization();

        group.MapPost("/upload", async (
            HttpRequest request,
            ClaimsPrincipal user,
            string? mode,
            KnowledgeUploadHandler handler) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            if (!request.HasFormContentType || request.Form.Files.Count == 0)
                return Results.BadRequest(new { error = "No file provided" });

            var ingestMode = ParseMode(mode);
            if (ingestMode is null)
                return Results.BadRequest(new { error = $"Unknown mode '{mode}'. Use 'fast' or 'structured'." });

            var file = request.Form.Files[0];

            using var stream = file.OpenReadStream();
            var document = await handler.UploadAsync(
                Guid.Parse(userIdClaim),
                file.FileName,
                file.ContentType,
                file.Length,
                stream,
                ingestMode.Value);

            return Results.Created($"/api/v1/knowledge/{document.Id}", new
            {
                id = document.Id,
                fileName = document.FileName,
                contentType = document.ContentType,
                fileSizeBytes = document.FileSizeBytes,
                processingStatus = document.ProcessingStatus,
                createdAt = document.CreatedAt,
                chunkCount = 0,
                mode = ingestMode.Value.ToString().ToLowerInvariant(),
            });
        }).DisableAntiforgery();

        group.MapGet("/", async (
            ClaimsPrincipal user,
            KnowledgeUploadHandler handler) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            var documents = await handler.ListDocumentsAsync(Guid.Parse(userIdClaim));
            return Results.Ok(documents.Select(d => new
            {
                id = d.Id,
                fileName = d.FileName,
                contentType = d.ContentType,
                fileSizeBytes = d.FileSizeBytes,
                processingStatus = d.ProcessingStatus,
                createdAt = d.CreatedAt,
                chunkCount = d.Chunks.Count
            }));
        });

        group.MapGet("/{id:guid}", async (
            ClaimsPrincipal user,
            Guid id,
            CallPilotDbContext db) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            var doc = await db.KnowledgeDocuments
                .Include(d => d.Chunks)
                .Include(d => d.DocumentEntities)
                .FirstOrDefaultAsync(d => d.Id == id && d.UserId == Guid.Parse(userIdClaim));

            if (doc is null) return Results.NotFound();

            return Results.Ok(new
            {
                id = doc.Id,
                fileName = doc.FileName,
                contentType = doc.ContentType,
                fileSizeBytes = doc.FileSizeBytes,
                processingStatus = doc.ProcessingStatus,
                createdAt = doc.CreatedAt,
                chunks = doc.Chunks.OrderBy(c => c.ChunkIndex).Select(c => new
                {
                    c.Id,
                    c.ChunkIndex,
                    text = c.Text,
                    c.TokenCount,
                    c.SectionHeading,
                    c.ChunkType,
                    c.PageHint,
                    metadata = c.MetadataJson,
                }),
                entities = doc.DocumentEntities.Select(e => new
                {
                    e.Id,
                    e.EntityText,
                    e.EntityType,
                    e.Confidence,
                }),
            });
        });

        group.MapDelete("/{id:guid}", async (
            ClaimsPrincipal user,
            Guid id,
            KnowledgeUploadHandler handler) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            try
            {
                await handler.DeleteDocumentAsync(Guid.Parse(userIdClaim), id);
                return Results.NoContent();
            }
            catch (KeyNotFoundException)
            {
                return Results.NotFound();
            }
        });

        // Re-run extraction → chunking → embedding on an already-stored document.
        // Useful when the document was ingested with a broken extractor (e.g. legacy
        // regex fallback that produced garbled chunks) and the user wants to recover
        // it without re-uploading.
        // Optional `?mode=structured` forwards the PDF to the Python AI Engine
        // (Docling) for layout-aware extraction. Default is `fast` (Docnet in-process).
        group.MapPost("/{id:guid}/reindex", async (
            ClaimsPrincipal user,
            Guid id,
            string? mode,
            KnowledgeUploadHandler handler) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            var ingestMode = ParseMode(mode);
            if (ingestMode is null)
                return Results.BadRequest(new { error = $"Unknown mode '{mode}'. Use 'fast' or 'structured'." });

            var document = await handler.ReindexAsync(Guid.Parse(userIdClaim), id, ingestMode.Value);
            if (document is null) return Results.NotFound();

            return Results.Ok(new
            {
                id = document.Id,
                fileName = document.FileName,
                processingStatus = document.ProcessingStatus,
                updatedAt = document.UpdatedAt,
                mode = ingestMode.Value.ToString().ToLowerInvariant(),
            });
        });
    }

    private static IngestMode? ParseMode(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw.Equals("fast", StringComparison.OrdinalIgnoreCase))
            return IngestMode.Fast;
        if (raw.Equals("structured", StringComparison.OrdinalIgnoreCase))
            return IngestMode.Structured;
        return null;
    }
}
