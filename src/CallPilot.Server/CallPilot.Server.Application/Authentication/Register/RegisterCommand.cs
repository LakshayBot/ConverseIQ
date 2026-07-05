using FluentValidation;

namespace CallPilot.Server.Application.Authentication.Register;

public record RegisterCommand(string Email, string Password, string ConfirmPassword);

public record RegisterResponse(Guid Id, string Email, DateTime CreatedAt);

public class RegisterValidator : AbstractValidator<RegisterCommand>
{
    public RegisterValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(256);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(8).MaximumLength(128);
        RuleFor(x => x.ConfirmPassword).Equal(x => x.Password).WithMessage("Passwords do not match.");
    }
}
