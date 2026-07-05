using CallPilot.Server.Domain.Entities;
using CallPilot.Server.Shared.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Features.Auth.Commands;

public sealed class RegisterHandler
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;

    public RegisterHandler(IApplicationDbContext db, IPasswordHasher hasher)
    {
        _db = db;
        _hasher = hasher;
    }

    public async Task<Result> Handle(RegisterCommand command, CancellationToken ct)
    {
        var exists = await _db.Users.AnyAsync(u => u.Email == command.Email, ct);
        if (exists)
            return new Result(false, "Email already registered");

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = command.Email,
            PasswordHash = _hasher.Hash(command.Password),
            DisplayName = command.DisplayName,
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync(ct);

        return new Result(true, null, user.Id);
    }

    public sealed record Result(bool Success, string? Error = null, Guid? UserId = null);
}
