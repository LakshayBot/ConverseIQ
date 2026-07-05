namespace CallPilot.Server.Domain.Entities;

public class Recommendation
{
    public Guid Id { get; set; }
    public Guid MeetingId { get; set; }
    public string RecommendationType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public string? KnowledgeReferences { get; set; }
    public string? TriggerEvent { get; set; }
    public string? Provider { get; set; }
    public string? Model { get; set; }
    public DateTime CreatedAt { get; set; }

    public Meeting Meeting { get; set; } = null!;
}
