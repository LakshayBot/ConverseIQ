namespace CallPilot.Server.Application.Features.Auth.Commands;

public sealed record LoginCommand(string Email, string Password);
