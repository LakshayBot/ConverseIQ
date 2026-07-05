using CallPilot.Server.Domain.Users;

namespace CallPilot.Server.Domain.Providers;

public class ProviderConfiguration
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string ProviderType { get; private set; }
    public string Model { get; private set; }
    public string? Endpoint { get; private set; }
    public string EncryptedApiKey { get; private set; }
    public double Temperature { get; private set; }
    public int MaxTokens { get; private set; }
    public int TimeoutSeconds { get; private set; }
    public bool IsEnabled { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    public User User { get; private set; } = null!;

    private ProviderConfiguration() { }

    public ProviderConfiguration(
        Guid userId,
        string providerType,
        string model,
        string? endpoint,
        string encryptedApiKey,
        double temperature,
        int maxTokens,
        int timeoutSeconds)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        ProviderType = providerType;
        Model = model;
        Endpoint = endpoint;
        EncryptedApiKey = encryptedApiKey;
        Temperature = temperature;
        MaxTokens = maxTokens;
        TimeoutSeconds = timeoutSeconds;
        IsEnabled = true;
        CreatedAt = DateTime.UtcNow;
    }

    public void Update(
        string model,
        string? endpoint,
        string encryptedApiKey,
        double temperature,
        int maxTokens,
        int timeoutSeconds)
    {
        Model = model;
        Endpoint = endpoint;
        EncryptedApiKey = encryptedApiKey;
        Temperature = temperature;
        MaxTokens = maxTokens;
        TimeoutSeconds = timeoutSeconds;
        UpdatedAt = DateTime.UtcNow;
    }
}
