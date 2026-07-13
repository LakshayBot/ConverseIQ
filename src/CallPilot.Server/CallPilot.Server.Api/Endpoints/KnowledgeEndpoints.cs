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
            KnowledgeUploadHandler handler) =>
        {
            var userIdClaim = user.FindFirst("userId")?.Value;
            if (userIdClaim is null) return Results.Unauthorized();

            if (!request.HasFormContentType || request.Form.Files.Count == 0)
                return Results.BadRequest(new { error = "No file provided" });

            var file = request.Form.Files[0];

            using var stream = file.OpenReadStream();
            var document = await handler.UploadAsync(
                Guid.Parse(userIdClaim),
                file.FileName,
                file.ContentType,
                file.Length,
                stream);

            return Results.Created($"/api/v1/knowledge/{document.Id}", new
            {
                id = document.Id,
                fileName = document.FileName,
                contentType = document.ContentType,
                fileSizeBytes = document.FileSizeBytes,
                processingStatus = document.ProcessingStatus,
                createdAt = document.CreatedAt,
                chunkCount = 0,
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
    }
}
