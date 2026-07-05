using System.Security.Claims;
using CallPilot.Server.Application.Features.Providers.Commands;
using CallPilot.Server.Application.Features.Providers.Queries;
using CallPilot.Server.Application;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Api.Endpoints;

public static class ProviderEndpoints
{
    public static void MapProviderEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/providers").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, GetProvidersHandler handler, CancellationToken ct) =>
        {
            var userId = Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var providers = await handler.Handle(new GetProvidersQuery(userId), ct);
            return Results.Ok(providers);
        });

        group.MapPost("/", async (ClaimsPrincipal user, SaveProviderCommand command, SaveProviderHandler handler, CancellationToken ct) =>
        {
            var userId = Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var cmd = command with { UserId = userId };
            var result = await handler.Handle(cmd, ct);
            return result.Success
                ? Results.Created($"/api/v1/providers/{result.ProviderId}", result)
                : Results.Problem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, IApplicationDbContext db, CancellationToken ct) =>
        {
            var userId = Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var provider = await db.ProviderConfigurations.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId, ct);
            if (provider is null) return Results.NotFound();

            provider.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }
}
