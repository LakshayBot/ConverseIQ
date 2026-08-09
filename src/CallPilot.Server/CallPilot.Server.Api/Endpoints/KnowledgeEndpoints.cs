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
            string? knowledgeBaseId,
            KnowledgeUploadHandler handler,
            CallPilotDbContext db) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId))
                return Results.Unauthorized();

            if (!request.HasFormContentType || request.Form.Files.Count == 0)
                return Results.BadRequest(new { error = "No file provided" });

            var ingestMode = ParseMode(mode);
            if (ingestMode is null)
                return Results.BadRequest(new { error = $"Unknown mode '{mode}'. Use 'fast' or 'structured'." });

            Guid? kbId = null;
            if (!string.IsNullOrWhiteSpace(knowledgeBaseId) && Guid.TryParse(knowledgeBaseId, out var parsedKb))
            {
                var kbExists = await db.KnowledgeBases.AnyAsync(k => k.Id == parsedKb && k.UserId == userId);
                if (!kbExists)
                    return Results.BadRequest(new { error = "Knowledge base not found." });
                kbId = parsedKb;
            }

            var file = request.Form.Files[0];

            using var stream = file.OpenReadStream();
            var document = await handler.UploadAsync(
                userId,
                file.FileName,
                file.ContentType,
                file.Length,
                stream,
                ingestMode.Value,
                kbId);

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
                knowledgeBaseId = document.KnowledgeBaseId,
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
                knowledgeBaseId = d.KnowledgeBaseId,
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

            // For each match, fetch the most useful chunk text - prefer the
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

        // Lightweight status poll endpoint.  Returns the two status
        // fields, cheap counts, plus the per-stage log + last error +
        // heartbeat so the dashboard can show a detailed progress bar
        // without re-pulling the full document.  The stage log is a
        // jsonb column on the same row, so the SELECT is still one
        // row and a jsonb read - cheap enough to poll every ~1.5s.
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
                    d.Mode,
                    d.KnowledgeBaseId,
                    d.ProcessingStatus,
                    d.EnrichmentStatus,
                    d.StagesJson,
                    d.LastErrorJson,
                    d.EnrichmentProgressJson,
                    d.UpdatedAt,
                    ChunkCount = db.KnowledgeChunks.Count(c => c.DocumentId == d.Id),
                    EntityCount = db.DocumentEntities.Count(e => e.DocumentId == d.Id),
                })
                .FirstOrDefaultAsync();

            if (doc is null) return Results.NotFound();

            // Parse the jsonb into typed objects on the server so the
            // client gets a clean array, not a string field.  Falls
            // back to empty array / null on legacy rows.
            IReadOnlyList<CallPilot.Server.Domain.Knowledge.IngestStage> stages =
                Array.Empty<CallPilot.Server.Domain.Knowledge.IngestStage>();
            if (!string.IsNullOrEmpty(doc.StagesJson))
            {
                try
                {
                    stages = System.Text.Json.JsonSerializer
                        .Deserialize<List<CallPilot.Server.Domain.Knowledge.IngestStage>>(doc.StagesJson)
                        ?? new List<CallPilot.Server.Domain.Knowledge.IngestStage>();
                }
                catch (System.Text.Json.JsonException) { /* leave empty */ }
            }

            CallPilot.Server.Domain.Knowledge.IngestStageError? lastError = null;
            if (!string.IsNullOrEmpty(doc.LastErrorJson))
            {
                try
                {
                    lastError = System.Text.Json.JsonSerializer
                        .Deserialize<CallPilot.Server.Domain.Knowledge.IngestStageError>(doc.LastErrorJson);
                }
                catch (System.Text.Json.JsonException) { /* leave null */ }
            }

            CallPilot.Server.Domain.Knowledge.EnrichmentProgress? enrichmentProgress = null;
            if (!string.IsNullOrEmpty(doc.EnrichmentProgressJson))
            {
                try
                {
                    enrichmentProgress = System.Text.Json.JsonSerializer
                        .Deserialize<CallPilot.Server.Domain.Knowledge.EnrichmentProgress>(doc.EnrichmentProgressJson);
                }
                catch (System.Text.Json.JsonException) { /* leave null */ }
            }

            // Per-document product enrichment progress: the products
            // extracted from THIS document. Product entities are the
            // document-scoped "extracted product" records - each carries its
            // OWN enrichment status (DocumentEntity.EnrichmentStatus), so two
            // documents never share processing state. Only entities classified
            // as PRODUCT appear here (never FEATURE/COMPONENT/etc). Legacy
            // rows predating the EntityCategory field (EntityCategory IS NULL)
            // are still genuine product entities and remain visible.
            var productEntities = await db.DocumentEntities
                .Where(e => e.DocumentId == id
                            && e.EntityType == "product"
                            && (e.EntityCategory == "PRODUCT" || e.EntityCategory == null))
                .Select(e => new
                {
                    e.Id,
                    e.EntityText,
                    e.EnrichmentStatus,
                    e.LastEnrichedAt,
                    e.ProductIntelligenceId,
                    SourcePage = e.Chunk != null ? e.Chunk.PageHint : (int?)null,
                    SourceChunk = e.Chunk != null ? e.Chunk.ChunkIndex : (int?)null,
                })
                .ToListAsync();
            var canonicalNames = productEntities
                .Select(e => CallPilot.Server.Infrastructure.Products.ProductIntelService.NormalizeName(e.EntityText))
                .Distinct()
                .ToList();
            // Lookup profiles scoped to the document's own knowledge base so a
            // doc never inherits another company/legacy row's display name.
            var productRows = await db.ProductIntelligences
                .Where(p => p.KnowledgeBaseId == doc.KnowledgeBaseId && canonicalNames.Contains(p.CanonicalName))
                .Select(p => new { p.CanonicalName, p.DisplayName, p.Id, Status = p.EnrichmentStatus.ToString(), p.LastEnrichedAt })
                .ToListAsync();

            var products = new List<object>();
            var productsEnriched = 0;
            foreach (var entity in productEntities)
            {
                var canonical = CallPilot.Server.Infrastructure.Products.ProductIntelService.NormalizeName(entity.EntityText);
                var match = productRows.FirstOrDefault(r =>
                    string.Equals(r.CanonicalName, canonical, StringComparison.OrdinalIgnoreCase));
                // Per-document status is the source of truth; fall back to the
                // shared profile's status only for rows that predate the
                // per-document status field.
                var status = entity.EnrichmentStatus ?? match?.Status ?? "Pending";
                if (status == "Completed") productsEnriched++;
                products.Add(new
                {
                    id = entity.Id,
                    name = entity.EntityText,
                    canonical,
                    displayName = match?.DisplayName ?? entity.EntityText,
                    enrichmentStatus = status,
                    lastEnrichedAt = entity.LastEnrichedAt ?? match?.LastEnrichedAt,
                    sourcePage = entity.SourcePage,
                    sourceChunk = entity.SourceChunk,
                });
            }

            return Results.Ok(new
            {
                doc.Id,
                mode = doc.Mode ?? "fast",
                doc.ProcessingStatus,
                doc.EnrichmentStatus,
                doc.ChunkCount,
                doc.EntityCount,
                lastUpdatedAt = doc.UpdatedAt,
                stages,
                lastError,
                enrichmentProgress,
                products,
                productsTotal = products.Count,
                productsEnriched,
            });
        });

        // Bulk enrichment for a document's selected products. Reuses the same
        // enrichment pipeline as the individual action (no duplicate jobs for
        // already-Processing products). Operates only on this document's rows.
        group.MapPost("/{id:guid}/products/bulk-enrich", async (
            Guid id,
            ClaimsPrincipal user,
            CallPilot.Server.Infrastructure.Products.ProductIntelService productIntelService,
            BulkProductRequest body) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId)) return Results.Unauthorized();

            var result = await productIntelService.BulkEnrichAsync(id, userId, body?.Ids ?? []);
            return Results.Ok(result);
        });

        // Bulk delete for a document's selected products. Follows the same
        // relationship rules as individual deletion - never removes the source
        // document, never touches other documents' products.
        group.MapPost("/{id:guid}/products/bulk-delete", async (
            Guid id,
            ClaimsPrincipal user,
            CallPilot.Server.Infrastructure.Products.ProductIntelService productIntelService,
            BulkProductRequest body) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId)) return Results.Unauthorized();

            var result = await productIntelService.BulkDeleteAsync(id, userId, body?.Ids ?? []);
            return Results.Ok(result);
        });

        // Explicit product enrichment action, scoped to a document (used by
        // the product detail drawer's Start enrichment / Reprocess / Retry).
        // The shared profile + this document's own product entity are marked
        // Enriching; duplicate-trigger protection lives in the service.
        group.MapPost("/{id:guid}/products/{name}/enrich", async (
            Guid id,
            string name,
            ClaimsPrincipal user,
            CallPilot.Server.Infrastructure.Products.ProductIntelService productIntelService) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId)) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(name)) return Results.BadRequest(new { error = "Product name is required" });

            var dto = await productIntelService.ForceReenrichAsync(name, userId, id);
            return Results.Ok(dto);
        });

        // Removes an extracted product from a document's product intelligence.
        // Deletes the per-document product entity; the shared KB-level
        // intelligence row is removed only when no other document in the
        // knowledge base still references the product. Never touches the
        // source document or unrelated products.
        group.MapDelete("/{id:guid}/products/{name}", async (
            Guid id,
            string name,
            ClaimsPrincipal user,
            CallPilot.Server.Infrastructure.Products.ProductIntelService productIntelService) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null || !Guid.TryParse(userIdClaim, out var userId)) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(name)) return Results.BadRequest(new { error = "Product name is required" });

            var ok = await productIntelService.RemoveDocumentProductAsync(id, userId, name);
            return ok ? Results.NoContent() : Results.NotFound();
        });

        // Powers the dashboard's "View raw" tab.  Returns the last
        // Docling metadata block + last LLM enrichment response so the
        // user can see exactly what the AI engine produced.
        // Auth-checked against the document owner.
        group.MapGet("/{id:guid}/raw-output", async (
            ClaimsPrincipal user,
            Guid id,
            CallPilotDbContext db) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            var userId = Guid.Parse(userIdClaim);
            var doc = await db.KnowledgeDocuments
                .Where(d => d.Id == id && d.UserId == userId)
                .Select(d => new { d.Id, d.RawOutputJson, d.FileName, d.Mode })
                .FirstOrDefaultAsync();

            if (doc is null) return Results.NotFound();

            object? rawOutput = null;
            if (!string.IsNullOrEmpty(doc.RawOutputJson))
            {
                try
                {
                    // Re-serialize through JsonElement so the client gets
                    // the nested structure verbatim (jsonb-as-object on
                    // the wire, not a string).
                    using var parsed = System.Text.Json.JsonDocument.Parse(doc.RawOutputJson);
                    rawOutput = System.Text.Json.JsonSerializer
                        .Deserialize<object>(parsed.RootElement.GetRawText());
                }
                catch (System.Text.Json.JsonException) { /* leave null */ }
            }

            return Results.Ok(new
            {
                doc.Id,
                doc.FileName,
                mode = doc.Mode ?? "fast",
                rawOutput,
            });
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

public record BulkProductRequest(Guid[]? Ids);
