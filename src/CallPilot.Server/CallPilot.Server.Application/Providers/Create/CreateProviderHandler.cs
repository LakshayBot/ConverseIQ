using CallPilot.Server.Domain.Providers;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Shared.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Providers.Create;

public class CreateProviderHandler
{
    private readonly CallPilotDbContext _dbContext;
    private readonly IApiKeyEncryptionService _encryptionService;

    public CreateProviderHandler(
        CallPilotDbContext dbContext,
        IApiKeyEncryptionService encryptionService)
    {
        _dbContext = dbContext;
        _encryptionService = encryptionService;
    }

    public async Task<CreateProviderResponse> HandleAsync(Guid userId, CreateProviderCommand command)
    {
        var existing = await _dbContext.ProviderConfigurations
            .FirstOrDefaultAsync(p => p.UserId == userId && p.ProviderType == command.ProviderType);

        var encryptedKey = _encryptionService.Encrypt(command.ApiKey);

        if (existing is not null)
        {
            existing.Update(command.Model, command.Endpoint, encryptedKey, command.Temperature, command.MaxTokens, command.TimeoutSeconds);
            await _dbContext.SaveChangesAsync();

            return new CreateProviderResponse(
                existing.Id, existing.ProviderType, existing.Model, existing.Endpoint,
                existing.Temperature, existing.MaxTokens, existing.TimeoutSeconds,
                existing.IsEnabled, existing.CreatedAt);
        }

        var provider = new ProviderConfiguration(
            userId, command.ProviderType, command.Model, command.Endpoint,
            encryptedKey, command.Temperature, command.MaxTokens, command.TimeoutSeconds);

        _dbContext.ProviderConfigurations.Add(provider);
        await _dbContext.SaveChangesAsync();

        return new CreateProviderResponse(
            provider.Id, provider.ProviderType, provider.Model, provider.Endpoint,
            provider.Temperature, provider.MaxTokens, provider.TimeoutSeconds,
            provider.IsEnabled, provider.CreatedAt);
    }
}
