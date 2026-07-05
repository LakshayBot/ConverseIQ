namespace CallPilot.Server.Application.Features.Providers.Commands;

public sealed record SaveProviderCommand(
    Guid UserId,
    string Provider,
    string Model,
    string? Endpoint,
    string ApiKey,
    double Temperature,
    int MaxTokens,
    int Timeout,
    string Capabilities);
