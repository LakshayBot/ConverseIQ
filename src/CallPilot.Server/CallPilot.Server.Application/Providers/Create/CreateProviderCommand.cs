using FluentValidation;

namespace CallPilot.Server.Application.Providers.Create;

public record CreateProviderCommand(
    string ProviderType,
    string Model,
    string? Endpoint,
    string ApiKey,
    double Temperature,
    int MaxTokens,
    int TimeoutSeconds);

public record CreateProviderResponse(
    Guid Id,
    string ProviderType,
    string Model,
    string? Endpoint,
    double Temperature,
    int MaxTokens,
    int TimeoutSeconds,
    bool IsEnabled,
    DateTime CreatedAt);

public class CreateProviderValidator : AbstractValidator<CreateProviderCommand>
{
    public CreateProviderValidator()
    {
        RuleFor(x => x.ProviderType).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Model).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Endpoint).MaximumLength(500);
        RuleFor(x => x.ApiKey).NotEmpty().MaximumLength(500);
        RuleFor(x => x.Temperature).InclusiveBetween(0, 2);
        RuleFor(x => x.MaxTokens).InclusiveBetween(1, 100000);
        RuleFor(x => x.TimeoutSeconds).InclusiveBetween(1, 300);
    }
}
