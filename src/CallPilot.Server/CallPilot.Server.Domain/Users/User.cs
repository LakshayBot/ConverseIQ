using CallPilot.Server.Domain.Providers;

namespace CallPilot.Server.Domain.Users;

public class User
{
    public Guid Id { get; private set; }
    public string Email { get; private set; }
    public string PasswordHash { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    public ICollection<RefreshToken> RefreshTokens { get; private set; } = new List<RefreshToken>();
    public ICollection<ProviderConfiguration> ProviderConfigurations { get; private set; } = new List<ProviderConfiguration>();
    public ICollection<CallPilot.Server.Domain.AI.UserFeaturePreference> FeaturePreferences { get; private set; } = new List<CallPilot.Server.Domain.AI.UserFeaturePreference>();
    public ICollection<CallPilot.Server.Domain.AI.AiUsageLog> AiUsageLogs { get; private set; } = new List<CallPilot.Server.Domain.AI.AiUsageLog>();
    public ICollection<CallPilot.Server.Domain.AI.ProviderLimitSnapshot> LimitSnapshots { get; private set; } = new List<CallPilot.Server.Domain.AI.ProviderLimitSnapshot>();

    private User() { }

    public User(string email, string passwordHash)
    {
        Id = Guid.NewGuid();
        Email = email.ToLowerInvariant().Trim();
        PasswordHash = passwordHash;
        CreatedAt = DateTime.UtcNow;
    }

    public void UpdatePassword(string passwordHash)
    {
        PasswordHash = passwordHash;
        UpdatedAt = DateTime.UtcNow;
    }
}
