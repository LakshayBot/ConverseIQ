using System.Diagnostics;

namespace CallPilot.Server.Api.Middleware;

public sealed class DiagnosticsMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<DiagnosticsMiddleware> _logger;

    public DiagnosticsMiddleware(RequestDelegate next, ILogger<DiagnosticsMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var sw = Stopwatch.StartNew();

        await _next(context);

        sw.Stop();

        if (context.Response.StatusCode >= 400 || sw.ElapsedMilliseconds > 500)
        {
            _logger.LogWarning(
                "Request {Method} {Path} responded {StatusCode} in {Duration}ms",
                context.Request.Method,
                context.Request.Path,
                context.Response.StatusCode,
                sw.ElapsedMilliseconds);
        }
    }
}

public static class DiagnosticsMiddlewareExtensions
{
    public static IApplicationBuilder UseDiagnostics(this IApplicationBuilder app)
    {
        return app.UseMiddleware<DiagnosticsMiddleware>();
    }
}
