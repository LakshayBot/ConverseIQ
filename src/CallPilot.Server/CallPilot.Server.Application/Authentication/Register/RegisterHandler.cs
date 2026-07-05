using CallPilot.Server.Domain.Users;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Shared.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Authentication.Register;

public class RegisterHandler
{
    private readonly CallPilotDbContext _dbContext;
    private readonly IPasswordHasher _passwordHasher;

    public RegisterHandler(CallPilotDbContext dbContext, IPasswordHasher passwordHasher)
    {
        _dbContext = dbContext;
        _passwordHasher = passwordHasher;
    }

    public async Task<RegisterResponse> HandleAsync(RegisterCommand command)
    {
        var email = command.Email.ToLowerInvariant().Trim();

        var existing = await _dbContext.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (existing is not null)
        {
            throw new InvalidOperationException("A user with this email already exists.");
        }

        var passwordHash = _passwordHasher.Hash(command.Password);
        var user = new User(email, passwordHash);

        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();

        return new RegisterResponse(user.Id, user.Email, user.CreatedAt);
    }
}
