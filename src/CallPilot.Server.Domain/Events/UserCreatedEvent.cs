namespace CallPilot.Server.Domain.Events;

public sealed record UserCreatedEvent(Guid UserId, string Email) : DomainEvent;
