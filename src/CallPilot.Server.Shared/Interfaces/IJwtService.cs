namespace CallPilot.Server.Shared.Interfaces;

public interface IJwtService
{
    string GenerateAccessToken(Guid userId, string email);
    string GenerateRefreshToken();
    Guid? ValidateToken(string token);
}
