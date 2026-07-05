namespace CallPilot.Server.Application.Features.Auth.Commands;

public sealed record RegisterCommand(string Email, string Password, string DisplayName);
