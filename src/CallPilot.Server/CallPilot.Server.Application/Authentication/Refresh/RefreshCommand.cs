namespace CallPilot.Server.Application.Authentication.Refresh;

public record RefreshCommand(string RefreshToken);

public record RefreshResponse(
    string AccessToken,
    string RefreshToken,
    DateTime AccessTokenExpiresAt,
    DateTime RefreshTokenExpiresAt);
