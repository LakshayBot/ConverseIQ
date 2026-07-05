using CallPilot.Server.Domain.Entities;
using CallPilot.Server.Shared.Interfaces;

namespace CallPilot.Server.Application.Features.Providers.Commands;

public sealed class SaveProviderHandler
{
    private readonly IApplicationDbContext _db;
    private readonly IEncryptionService _encryption;

    public SaveProviderHandler(IApplicationDbContext db, IEncryptionService encryption)
    {
        _db = db;
        _encryption = encryption;
    }

    public async Task<Result> Handle(SaveProviderCommand command, CancellationToken ct)
    {
        var config = new ProviderConfiguration
        {
            Id = Guid.NewGuid(),
            UserId = command.UserId,
            Provider = command.Provider,
            Model = command.Model,
            Endpoint = command.Endpoint,
            EncryptedApiKey = _encryption.Encrypt(command.ApiKey),
            Temperature = command.Temperature,
            MaxTokens = command.MaxTokens,
            Timeout = command.Timeout,
            Capabilities = command.Capabilities,
            CreatedAt = DateTime.UtcNow
        };

        _db.ProviderConfigurations.Add(config);
        await _db.SaveChangesAsync(ct);

        return new Result(true, config.Id);
    }

    public sealed record Result(bool Success, Guid? ProviderId = null);
}
