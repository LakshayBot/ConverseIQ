using CallPilot.Server.Api.Services;

namespace CallPilot.Server.Api.Endpoints;

public static class DiagnosticsEndpoints
{
    public static void MapDiagnosticsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/diagnostics");

        group.MapGet("/health", async (HealthService health) =>
        {
            var report = await health.GetHealthAsync();
            return report.Status == "Healthy" ? Results.Ok(report) : Results.StatusCode(503);
        });

        group.MapGet("/health/ready", async (HealthService health) =>
        {
            var report = await health.GetHealthAsync();
            return report.Database == "Connected"
                ? Results.Ok(new { status = "Ready" })
                : Results.StatusCode(503);
        });

        group.MapGet("/health/live", () =>
        {
            return Results.Ok(new { status = "Alive" });
        });
    }
}
