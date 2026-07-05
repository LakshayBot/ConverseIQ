using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Api.Services;

public sealed class HealthService
{
    private readonly CallPilotDbContext _db;

    public HealthService(CallPilotDbContext db)
    {
        _db = db;
    }

    public async Task<HealthReport> GetHealthAsync()
    {
        var dbOk = false;
        try
        {
            dbOk = await _db.Database.CanConnectAsync();
        }
        catch
        {
            // db unavailable
        }

        return new HealthReport(
            Status: dbOk ? "Healthy" : "Degraded",
            Database: dbOk ? "Connected" : "Disconnected",
            Timestamp: DateTime.UtcNow
        );
    }

    public sealed record HealthReport(string Status, string Database, DateTime Timestamp);
}
