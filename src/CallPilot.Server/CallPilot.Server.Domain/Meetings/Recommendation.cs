namespace CallPilot.Server.Domain.Meetings;

public class Recommendation
{
    public Guid Id { get; private set; }
    public Guid MeetingId { get; private set; }
    public string Type { get; private set; }
    public string Title { get; private set; }
    public string Summary { get; private set; }
    /// <summary>Structured LLM output — the rep's next action (JSON "talking_point").</summary>
    public string? TalkingPoint { get; private set; }
    /// <summary>Structured LLM output — short factual bullets (JSON "key_facts").</summary>
    public List<string> KeyFacts { get; private set; } = [];
    /// <summary>Structured LLM output — "high" | "medium" | "low" (JSON "priority").</summary>
    public string? Priority { get; private set; }
    /// <summary>
    /// For contextual matches: the exact buyer sentence that drove the match.
    /// Null for keyword-triggered recommendations.
    /// </summary>
    public string? TriggerSpan { get; private set; }
    /// <summary>"keyword" (event-detector trigger, default) | "contextual" (semantic match).</summary>
    public string TriggerType { get; private set; } = "keyword";
    public double Confidence { get; private set; }
    public List<string> References { get; private set; }
    public string? TriggerEvent { get; private set; }
    public string? Provider { get; private set; }
    public string? Model { get; private set; }
    public DateTime GeneratedAt { get; private set; }

    private Recommendation() { }

    public Recommendation(
        Guid meetingId,
        string type,
        string title,
        string summary,
        string? talkingPoint,
        List<string>? keyFacts,
        string? priority,
        double confidence,
        List<string> references,
        string? triggerEvent,
        string? provider,
        string? model,
        string? triggerSpan = null,
        string triggerType = "keyword")
    {
        Id = Guid.NewGuid();
        MeetingId = meetingId;
        Type = type;
        Title = title;
        Summary = summary;
        TalkingPoint = talkingPoint;
        KeyFacts = keyFacts ?? [];
        Priority = priority;
        TriggerSpan = triggerSpan;
        TriggerType = string.IsNullOrWhiteSpace(triggerType) ? "keyword" : triggerType;
        Confidence = confidence;
        References = references;
        TriggerEvent = triggerEvent;
        Provider = provider;
        Model = model;
        GeneratedAt = DateTime.UtcNow;
    }
}
