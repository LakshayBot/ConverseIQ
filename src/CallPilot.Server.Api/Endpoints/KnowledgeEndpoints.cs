using System.Security.Claims;
using CallPilot.Server.Application;
using CallPilot.Server.Application.Features.Knowledge.Commands;
using CallPilot.Server.Application.Features.Knowledge.Queries;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Api.Endpoints;

public static class KnowledgeEndpoints
{
    public static void MapKnowledgeEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/knowledge").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, GetKnowledgeHandler handler, CancellationToken ct) =>
        {
            var userId = Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var documents = await handler.Handle(new GetKnowledgeQuery(userId), ct);
            return Results.Ok(documents);
        });

        group.MapPost("/upload", async (ClaimsPrincipal user, HttpRequest request, UploadKnowledgeHandler handler, CancellationToken ct) =>
        {
            var userId = Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

            if (!request.HasFormContentType || !request.Form.Files.Any())
                return Results.BadRequest(new { error = "No file provided" });

            var file = request.Form.Files[0];
            await using var stream = file.OpenReadStream();

            var command = new UploadKnowledgeCommand(
                userId,
                file.FileName,
                file.ContentType,
                file.Length,
                stream);

            var result = await handler.Handle(command, ct);
            return result.Success
                ? Results.Created($"/api/v1/knowledge/{result.DocumentId}", result)
                : Results.Problem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, IApplicationDbContext db, CancellationToken ct) =>
        {
            var userId = Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var document = await db.KnowledgeDocuments
                .FirstOrDefaultAsync(d => d.Id == id && d.UserId == userId, ct);
            if (document is null) return Results.NotFound();

            document.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }
}
