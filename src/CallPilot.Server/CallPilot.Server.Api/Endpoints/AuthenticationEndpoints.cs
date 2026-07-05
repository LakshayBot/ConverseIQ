using CallPilot.Server.Application.Authentication.Login;
using CallPilot.Server.Application.Authentication.Logout;
using CallPilot.Server.Application.Authentication.Refresh;
using CallPilot.Server.Application.Authentication.Register;
using FluentValidation;

namespace CallPilot.Server.Api.Endpoints;

public static class AuthenticationEndpoints
{
    public static void MapAuthenticationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/auth");

        group.MapPost("/register", async (
            RegisterCommand command,
            RegisterValidator validator,
            RegisterHandler handler) =>
        {
            var validation = validator.Validate(command);
            if (!validation.IsValid)
            {
                return Results.ValidationProblem(validation.ToDictionary());
            }

            try
            {
                var result = await handler.HandleAsync(command);
                return Results.Created($"/api/v1/users/{result.Id}", result);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new { error = ex.Message });
            }
        });

        group.MapPost("/login", async (
            LoginCommand command,
            LoginValidator validator,
            LoginHandler handler) =>
        {
            var validation = validator.Validate(command);
            if (!validation.IsValid)
            {
                return Results.ValidationProblem(validation.ToDictionary());
            }

            try
            {
                var result = await handler.HandleAsync(command);
                return Results.Ok(result);
            }
            catch (UnauthorizedAccessException)
            {
                return Results.Unauthorized();
            }
        });

        group.MapPost("/refresh", async (
            RefreshCommand command,
            RefreshHandler handler) =>
        {
            try
            {
                var result = await handler.HandleAsync(command);
                return Results.Ok(result);
            }
            catch (UnauthorizedAccessException)
            {
                return Results.Unauthorized();
            }
        });

        group.MapPost("/logout", async (
            LogoutCommand command,
            LogoutHandler handler) =>
        {
            await handler.HandleAsync(command);
            return Results.Ok(new { message = "Logged out successfully." });
        }).RequireAuthorization();
    }
}
