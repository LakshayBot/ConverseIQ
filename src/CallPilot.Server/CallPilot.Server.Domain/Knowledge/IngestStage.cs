namespace CallPilot.Server.Domain.Knowledge;

/// <summary>
/// One stage of the document ingest pipeline.  Persisted as a jsonb array
/// on <see cref="KnowledgeDocument"/> via <c>Stages</c> and surfaced to
/// the dashboard so the user can see exactly where the pipeline is
/// (or where it failed) without a server-log round-trip.
/// </summary>
/// <param name="Key">
/// Stable identifier for the stage.  Used by the recorder to look up the
/// existing entry when a transition runs twice.  One of:
/// <c>uploaded | extracting | chunking | embedding | indexed |
/// entityextraction | enriching</c>.
/// </param>
/// <param name="Label">Human-readable label rendered in the dashboard.</param>
/// <param name="Status">
/// <c>pending | running | done | failed | skipped</c>.  <c>pending</c> is
/// the default for a stage the recorder has not yet touched.
/// </param>
/// <param name="StartedAt">UTC timestamp when the stage entered <c>running</c>.</param>
/// <param name="FinishedAt">UTC timestamp when the stage reached a terminal status.</param>
/// <param name="Detail">
/// Optional human note, e.g. <c>"Docling 30-60s model load"</c> or
/// <c>"12 pages, 7 products"</c>.
/// </param>
/// <param name="Error">Present iff <paramref name="Status"/> is <c>failed</c>.</param>
public sealed record IngestStage(
    string Key,
    string Label,
    string Status,
    DateTime? StartedAt,
    DateTime? FinishedAt,
    string? Detail,
    IngestStageError? Error);

/// <summary>
/// A failure captured for a single ingest stage.  Carries enough context
/// to debug without a server-log round-trip — the underlying exception
/// (truncated to 500 chars), HTTP status from the upstream call, the
/// model name, and when it happened.
/// </summary>
public sealed record IngestStageError(
    string Stage,
    string Source,    // "ai-engine" | "groq" | "gliner" | "dotnet" | "unknown"
    int? HttpStatus,
    string Message,
    string? Model,
    DateTime At);
