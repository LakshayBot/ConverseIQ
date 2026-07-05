using CallPilot.Server.Application.Features.Auth.Commands;

namespace CallPilot.Server.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/auth");

        group.MapPost("/register", async (RegisterCommand command, RegisterHandler handler, CancellationToken ct) =>
        {
            var result = await handler.Handle(command, ct);
            return result.Success
                ? Results.Created($"/api/v1/users/{result.UserId}", result)
                : Results.Conflict(new { error = result.Error });
        });

        group.MapPost("/login", async (LoginCommand command, LoginHandler handler, CancellationToken ct) =>
        {
            var result = await handler.Handle(command, ct);
            return result.Success
                ? Results.Ok(new { accessToken = result.AccessToken, refreshToken = result.RefreshToken })
                : Results.Unauthorized();
        });

        group.MapPost("/logout", () =>
        {
            return Results.Ok();
        }).RequireAuthorization();
    }
}
