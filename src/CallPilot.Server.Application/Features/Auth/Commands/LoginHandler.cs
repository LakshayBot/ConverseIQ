using CallPilot.Server.Domain.Entities;
using CallPilot.Server.Shared.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Features.Auth.Commands;

public sealed class LoginHandler
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly IJwtService _jwt;

    public LoginHandler(IApplicationDbContext db, IPasswordHasher hasher, IJwtService jwt)
    {
        _db = db;
        _hasher = hasher;
        _jwt = jwt;
    }

    public async Task<Result> Handle(LoginCommand command, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == command.Email, ct);
        if (user is null || !_hasher.Verify(command.Password, user.PasswordHash))
            return new Result(false, "Invalid email or password");

        var accessToken = _jwt.GenerateAccessToken(user.Id, user.Email);
        var refreshToken = _jwt.GenerateRefreshToken();

        return new Result(true, null, accessToken, refreshToken, user.Id);
    }

    public sealed record Result(bool Success, string? Error = null, string? AccessToken = null, string? RefreshToken = null, Guid? UserId = null);
}
