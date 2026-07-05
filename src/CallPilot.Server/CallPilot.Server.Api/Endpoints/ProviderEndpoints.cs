using System.Security.Claims;
using CallPilot.Server.Application.Providers.Create;
using CallPilot.Server.Application.Providers.Delete;
using CallPilot.Server.Application.Providers.List;

namespace CallPilot.Server.Api.Endpoints;

public static class ProviderEndpoints
{
    public static void MapProviderEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/providers").RequireAuthorization();

        group.MapGet("/", async (
            ClaimsPrincipal user,
            ListProvidersHandler handler) =>
        {
            var userId = GetUserId(user);
            var result = await handler.HandleAsync(userId);
            return Results.Ok(result);
        });

        group.MapPost("/", async (
            ClaimsPrincipal user,
            CreateProviderCommand command,
            CreateProviderValidator validator,
            CreateProviderHandler handler) =>
        {
            var validation = validator.Validate(command);
            if (!validation.IsValid)
            {
                return Results.ValidationProblem(validation.ToDictionary());
            }

            var userId = GetUserId(user);
            var result = await handler.HandleAsync(userId, command);
            return Results.Created($"/api/v1/providers/{result.Id}", result);
        });

        group.MapDelete("/{id:guid}", async (
            ClaimsPrincipal user,
            Guid id,
            DeleteProviderHandler handler) =>
        {
            try
            {
                var userId = GetUserId(user);
                await handler.HandleAsync(userId, id);
                return Results.NoContent();
            }
            catch (KeyNotFoundException)
            {
                return Results.NotFound();
            }
        });
    }

    private static Guid GetUserId(ClaimsPrincipal user)
    {
        var userIdClaim = user.FindFirst("userId")?.Value
            ?? throw new UnauthorizedAccessException("User ID claim not found.");
        return Guid.Parse(userIdClaim);
    }
}
