using CallPilot.Server.Infrastructure.Products;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

/// <summary>
/// Background consumer for the product enrichment queue. Opens a fresh scope
/// per request so scoped services (CallPilotDbContext, ProductIntelService)
/// are safe inside the long-lived worker. A single consumer keeps research
/// serialized and bounded.
/// </summary>
public class ProductIntelWorker : BackgroundService
{
    private readonly ProductIntelQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ProductIntelWorker> _logger;

    public ProductIntelWorker(
        ProductIntelQueue queue,
        IServiceScopeFactory scopeFactory,
        ILogger<ProductIntelWorker> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Product intelligence worker started");
        while (!stoppingToken.IsCancellationRequested)
        {
            var request = await _queue.DequeueAsync(stoppingToken);
            if (request is null) break;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<ProductIntelService>();
                await service.ResearchAndPersistAsync(request.Value);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Product enrichment failed in worker for {Product}", request.Value.CanonicalName);
            }
            finally
            {
                _queue.Release(request.Value.CanonicalName, request.Value.CompanyName);
            }
        }
    }
}
