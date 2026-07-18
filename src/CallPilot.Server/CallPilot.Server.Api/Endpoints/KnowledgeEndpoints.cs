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
                enrichmentStatus = document.EnrichmentStatus,
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
                enrichmentStatus = d.EnrichmentStatus,
                createdAt = d.CreatedAt,
                chunkCount = d.Chunks.Count,
                mode = d.Mode,
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
                enrichmentStatus = doc.EnrichmentStatus,
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

        // Lookup product details by canonical name.  Used by the live meeting
        // page's right-side product card to populate when a ProductMentioned
        // event arrives.  Returns the documents + a representative chunk
        // excerpt so the salesperson can see what the product is without a
        // second round-trip.  Case-insensitive name match (the trie and the
        // extractor both lowercase on insert).
        group.MapGet("/entities/{name}/details", async (
            ClaimsPrincipal user,
            string name,
            CallPilotDbContext db) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            var userId = Guid.Parse(userIdClaim);
            var normalized = name.ToLowerInvariant().Trim();

            // Find all entities with this name across the user's documents.
            // Join to the document and the originating chunk (if any) so the
            // caller can show "Found in: <doc> (page 3)" and a snippet.
            var matches = await db.DocumentEntities
                .Where(e => e.EntityText == normalized)
                .Join(db.KnowledgeDocuments.Where(d => d.UserId == userId),
                      e => e.DocumentId,
                      d => d.Id,
                      (e, d) => new { Entity = e, Document = d })
                .OrderByDescending(x => x.Entity.Confidence)
                .Take(5)
                .ToListAsync();

            if (matches.Count == 0)
            {
                return Results.Ok(new
                {
                    name = normalized,
                    type = "product",
                    description = (string?)null,
                    documents = Array.Empty<object>(),
                    isSeed = false,
                    notFound = true,
                });
            }

            // For each match, fetch the most useful chunk text — prefer the
            // chunk the entity was extracted from, otherwise the first chunk
            // of the document.  Truncate excerpts to 280 chars.
            var chunkIds = matches
                .Where(m => m.Entity.ChunkId.HasValue)
                .Select(m => m.Entity.ChunkId!.Value)
                .Distinct()
                .ToList();

            var docIds = matches.Select(m => m.Document.Id).Distinct().ToList();

            var chunks = await db.KnowledgeChunks
                .Where(c => docIds.Contains(c.DocumentId) || chunkIds.Contains(c.Id))
                .OrderBy(c => c.DocumentId)
                .ThenBy(c => c.ChunkIndex)
                .ToListAsync();

            var chunksByDoc = chunks
                .GroupBy(c => c.DocumentId)
                .ToDictionary(g => g.Key, g => g.OrderBy(c => c.ChunkIndex).ToList());

            var documents = matches.Select(m =>
            {
                var docId = m.Document.Id;
                var pool = chunksByDoc.TryGetValue(docId, out var list) ? list : new List<Domain.Knowledge.KnowledgeChunk>();
                // Prefer the chunk the entity was extracted from, otherwise
                // the first chunk of the document.
                var chosen = m.Entity.ChunkId.HasValue
                    ? pool.FirstOrDefault(c => c.Id == m.Entity.ChunkId.Value)
                    : pool.FirstOrDefault();
                var snippet = chosen?.Text is { Length: > 0 } txt
                    ? (txt.Length > 280 ? txt[..280] + "…" : txt)
                    : null;
                return new
                {
                    id = m.Document.Id,
                    fileName = m.Document.FileName,
                    pageHint = chosen?.PageHint ?? 0,
                    sectionHeading = chosen?.SectionHeading,
                    snippet,
                };
            }).ToList();

            var first = matches[0];
            return Results.Ok(new
            {
                name = first.Entity.EntityText,
                type = first.Entity.EntityType,
                confidence = first.Entity.Confidence,
                description = (string?)null,
                documents,
                isSeed = false,
                notFound = false,
            });
        });

        // Lightweight status poll endpoint.  Returns only the two status
        // fields plus cheap counts so the dashboard can poll every ~1.5s
        // during processing without pulling chunks/entities each time.
        // Cheap counts only — no joins to KnowledgeChunks or DocumentEntities.
        group.MapGet("/{id:guid}/status", async (
            ClaimsPrincipal user,
            Guid id,
            CallPilotDbContext db) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            var userId = Guid.Parse(userIdClaim);
            var doc = await db.KnowledgeDocuments
                .Where(d => d.Id == id && d.UserId == userId)
                .Select(d => new
                {
                    d.Id,
                    d.ProcessingStatus,
                    d.EnrichmentStatus,
                    ChunkCount = db.KnowledgeChunks.Count(c => c.DocumentId == d.Id),
                    EntityCount = db.DocumentEntities.Count(e => e.DocumentId == d.Id),
                })
                .FirstOrDefaultAsync();

            if (doc is null) return Results.NotFound();
            return Results.Ok(doc);
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
