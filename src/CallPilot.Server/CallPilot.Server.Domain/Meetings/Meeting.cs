namespace CallPilot.Server.Domain.Meetings;

public class Meeting
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string Status { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? StartedAt { get; private set; }
    public DateTime? EndedAt { get; private set; }
    /// <summary>User-supplied meeting title (set by the desktop client at save time).</summary>
    public string? Title { get; private set; }
    /// <summary>On-disk folder containing the recorded audio, set by the desktop client.</summary>
    public string? FolderPath { get; private set; }
    /// <summary>JSON blob holding the AI summary state + body. Written by the desktop's
    /// client-side summary generator. Replaces the desktop SQLite
    /// summary_processes table.</summary>
    public string? SummaryJson { get; private set; }

    public ICollection<TranscriptSegment> TranscriptSegments { get; private set; } = new List<TranscriptSegment>();

    private Meeting() { }

    public Meeting(Guid userId)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        Status = "Created";
        CreatedAt = DateTime.UtcNow;
    }

    public void Start()
    {
        Status = "Streaming";
        StartedAt = DateTime.UtcNow;
    }

    public void End()
    {
        Status = "Completed";
        EndedAt = DateTime.UtcNow;
    }

    public void SetTitle(string? title)
    {
        Title = title;
    }

    public void SetFolderPath(string? folderPath)
    {
        FolderPath = folderPath;
    }

    public void SetSummaryJson(string status, string? dataJson)
    {
        // Keep the existing schema simple: store a small JSON object with
        // { status, data } so the GET endpoint can return the exact shape
        // the desktop's polling expects.
        var payload = "{\"status\":\"" + EscapeJson(status) + "\"," +
                      (dataJson is null ? "\"data\":null" : "\"data\":" + dataJson) + "}";
        SummaryJson = payload;
    }

    private static string EscapeJson(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
