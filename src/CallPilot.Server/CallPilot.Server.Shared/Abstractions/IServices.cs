namespace CallPilot.Server.Shared.Abstractions;

public interface IJwtTokenGenerator
{
    string GenerateAccessToken(Guid userId, string email);
    string GenerateRefreshToken();
    (string token, DateTime expiresAt) GenerateRefreshTokenWithExpiry();
}

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}

public interface IApiKeyEncryptionService
{
    string Encrypt(string plainText);
    string Decrypt(string cipherText);
}
