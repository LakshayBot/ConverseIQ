using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using CallPilot.Server.Domain.Meetings;

namespace CallPilot.Server.Domain.Knowledge;

public class KnowledgeDocument
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string FileName { get; private set; }
    public string ContentType { get; private set; }
    public long FileSizeBytes { get; private set; }
    public string ProcessingStatus { get; private set; }

    /// <summary>
    /// Async LLM enrichment state, independent of <see cref="ProcessingStatus"/>.
    /// The main pipeline (extract → chunk → embed) tracks its own phase via
    /// <see cref="ProcessingStatus"/>; enrichment is a separate, post-Indexed
    /// background pass that produces richer product cards.
    /// Allowed values: null (not started / fast mode), "indexed" (queued),
    /// "enriching" (LLM pass in flight), "enriched" (done), "enrichment_failed".
    /// </summary>
    public string? EnrichmentStatus { get; private set; }

    /// <summary>
    /// Ingest path used to process this document.  "fast" = in-process
    /// Docnet/paragraph chunker; "structured" = Python AI Engine (Docling
    /// + LLM enrichment).  Default null for legacy rows.  The frontend
    /// uses this to decide whether the LLM enrichment column is "Skipped".
    /// </summary>
    public string? Mode { get; private set; }

    public string? StoragePath { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    /// <summary>
    /// Per-stage log of the ingest pipeline (jsonb).  Decoded on read
    /// via <see cref="Stages"/>; written via the
    /// <c>RecordStage*</c> methods.  Null for legacy rows and for
    /// documents still in the very first millisecond of processing.
    /// </summary>
    public string? StagesJson { get; private set; }

    /// <summary>
    /// Most recent failure across all stages (jsonb).  Cheap to read so
    /// the dashboard can render an "Errors" tab without traversing
    /// <see cref="StagesJson"/>.
    /// </summary>
    public string? LastErrorJson { get; private set; }

    /// <summary>
    /// Last response from the AI engine (jsonb).  Holds the Docling
    /// metadata block + the LLM enrichment response so the dashboard
    /// can show "View raw" without re-running anything.  Null for
    /// legacy rows.
    /// </summary>
    public string? RawOutputJson { get; private set; }

    /// <summary>
    /// Live progress of the LLM enrichment pass (jsonb).  Updated by
    /// the background enrichment task as each page completes, so the
    /// dashboard polls see per-page status in real time.  Null until
    /// enrichment starts.
    /// </summary>
    public string? EnrichmentProgressJson { get; private set; }

    public ICollection<KnowledgeChunk> Chunks { get; private set; } = new List<KnowledgeChunk>();
    public ICollection<DocumentEntity> DocumentEntities { get; private set; } = new List<DocumentEntity>();

    private KnowledgeDocument() { }

    public KnowledgeDocument(Guid userId, string fileName, string contentType, long fileSizeBytes)
    {
        Id = Guid.NewGuid();
        UserId = userId;
        FileName = fileName;
        ContentType = contentType;
        FileSizeBytes = fileSizeBytes;
        ProcessingStatus = "Uploaded";
        CreatedAt = DateTime.UtcNow;
    }

    public void SetStoragePath(string path)
    {
        StoragePath = path;
    }

    public void SetProcessingStatus(string status)
    {
        ProcessingStatus = status;
        UpdatedAt = DateTime.UtcNow;
    }

    public void SetEnrichmentStatus(string? status)
    {
        EnrichmentStatus = status;
        UpdatedAt = DateTime.UtcNow;
    }

    public void SetMode(string mode)
    {
        Mode = mode;
    }

    /// <summary>
    /// Bump <see cref="UpdatedAt"/> without changing any other field.
    /// Used as a heartbeat by long-running background tasks so the
    /// dashboard can distinguish "stuck" from "still running".
    /// </summary>
    public void Touch()
    {
        UpdatedAt = DateTime.UtcNow;
    }

    // ── Stage recorder API ──────────────────────────────────────────────
    // These are the only sanctioned ways to mutate StagesJson / LastErrorJson.
    // Each one reads the current list, mutates the entry for `key`, and
    // re-serialises — there's no separate "find or create" path because
    // every transition is idempotent for a given (key, status) pair.

    /// <summary>
    /// Move the stage with <paramref name="key"/> into <c>running</c>.
    /// If the stage is already running, leaves <c>StartedAt</c> alone
    /// (don't reset the clock on duplicate events) and overwrites
    /// <c>Detail</c>.
    /// </summary>
    public void RecordStageRunning(string key, string label, string? detail = null)
    {
        var list = LoadStages();
        var idx = list.FindIndex(s => s.Key == key);
        var now = DateTime.UtcNow;
        if (idx >= 0)
        {
            var existing = list[idx];
            list[idx] = existing with
            {
                Label = label,
                Status = "running",
                StartedAt = existing.StartedAt ?? now,
                Detail = detail ?? existing.Detail,
                Error = null,
            };
        }
        else
        {
            list.Add(new IngestStage(key, label, "running", now, null, detail, null));
        }
        StagesJson = JsonSerializer.Serialize(list);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Move the stage with <paramref name="key"/> into <c>done</c>.
    /// Sets <c>FinishedAt</c> and updates <c>Detail</c> if provided.
    /// </summary>
    public void RecordStageDone(string key, string? detail = null)
    {
        var list = LoadStages();
        var idx = list.FindIndex(s => s.Key == key);
        var now = DateTime.UtcNow;
        if (idx >= 0)
        {
            var existing = list[idx];
            list[idx] = existing with
            {
                Status = "done",
                FinishedAt = now,
                Detail = detail ?? existing.Detail,
                Error = null,
            };
        }
        else
        {
            // No prior running event — synthesise one so the dashboard
            // can still render a row.  Common after a crash recovery
            // when the in-memory state is lost.
            list.Add(new IngestStage(key, key, "done", now, now, detail, null));
        }
        StagesJson = JsonSerializer.Serialize(list);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Move the stage with <paramref name="key"/> into <c>failed</c> and
    /// stamp the last-error summary so the dashboard can show a single
    /// "what broke" entry without scanning the whole stage log.
    /// </summary>
    public void RecordStageFailed(string key, IngestStageError err, string? detail = null)
    {
        var list = LoadStages();
        var idx = list.FindIndex(s => s.Key == key);
        var now = DateTime.UtcNow;
        if (idx >= 0)
        {
            var existing = list[idx];
            list[idx] = existing with
            {
                Status = "failed",
                FinishedAt = now,
                Detail = detail ?? existing.Detail,
                Error = err,
            };
        }
        else
        {
            list.Add(new IngestStage(key, key, "failed", now, now, detail, err));
        }
        StagesJson = JsonSerializer.Serialize(list);
        LastErrorJson = JsonSerializer.Serialize(err);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Move the stage with <paramref name="key"/> into <c>skipped</c>
    /// (e.g. the document had no extractable text so chunking never ran).
    /// </summary>
    public void RecordStageSkipped(string key, string reason)
    {
        var list = LoadStages();
        var idx = list.FindIndex(s => s.Key == key);
        var now = DateTime.UtcNow;
        if (idx >= 0)
        {
            var existing = list[idx];
            list[idx] = existing with
            {
                Status = "skipped",
                FinishedAt = now,
                Detail = reason,
            };
        }
        else
        {
            list.Add(new IngestStage(key, key, "skipped", now, now, reason, null));
        }
        StagesJson = JsonSerializer.Serialize(list);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Append a new <c>pending</c> stage to the list.  Called by
    /// <c>KnowledgeUploadHandler.UploadAsync</c> up front so the
    /// dashboard's first poll already shows the full pipeline skeleton.
    /// </summary>
    public void RecordStagePending(string key, string label)
    {
        var list = LoadStages();
        if (list.Any(s => s.Key == key)) return;  // idempotent
        list.Add(new IngestStage(key, label, "pending", null, null, null, null));
        StagesJson = JsonSerializer.Serialize(list);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Persist the last response from the AI engine for a given
    /// <paramref name="source"/>.  <c>source</c> is one of
    /// <c>"docling"</c> or <c>"enrichment"</c>.  Merges into the existing
    /// jsonb so multiple sources can co-exist on one document.
    /// </summary>
    public void SetRawOutput(string source, object payload)
    {
        var dict = LoadRawOutput();
        dict[source] = payload;
        RawOutputJson = JsonSerializer.Serialize(dict);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Update the human-readable <c>Detail</c> on an existing stage row
    /// without changing its status.  Used by the recorder to surface
    /// "Docling 30-60s model load" or "trie rebuild failed: 502" as
    /// the pipeline runs.  No-op if the stage isn't in the list yet.
    /// </summary>
    public void SetStageDetail(string key, string detail)
    {
        var list = LoadStages();
        var idx = list.FindIndex(s => s.Key == key);
        if (idx < 0) return;
        list[idx] = list[idx] with { Detail = detail };
        StagesJson = JsonSerializer.Serialize(list);
        UpdatedAt = DateTime.UtcNow;
    }

    // ── Enrichment progress ─────────────────────────────────────────────

    /// <summary>
    /// Persist the live enrichment progress.  Called by the background
    /// enrichment task after each page completes.  The dashboard
    /// reads this via the <c>/status</c> endpoint to render per-page
    /// status without polling the AI engine directly.
    /// </summary>
    public void SetEnrichmentProgress(EnrichmentProgress progress)
    {
        EnrichmentProgressJson = JsonSerializer.Serialize(progress);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Convenience accessor — deserialises
    /// <see cref="EnrichmentProgressJson"/>.  Returns null for
    /// legacy / null rows and for documents that haven't started
    /// enrichment yet.
    /// </summary>
    [NotMapped]
    public EnrichmentProgress? EnrichmentProgress =>
        string.IsNullOrEmpty(EnrichmentProgressJson)
            ? null
            : JsonSerializer.Deserialize<EnrichmentProgress>(EnrichmentProgressJson);

    /// <summary>
    /// Convenience accessor — deserialises <see cref="StagesJson"/> on
    /// every read.  Returns an empty list for legacy / null rows.
    /// Excluded from the EF model — the column it reads is
    /// <see cref="StagesJson"/>, and EF would otherwise try to map
    /// <see cref="IngestStage"/> as a nested complex type.
    /// </summary>
    [NotMapped]
    public IReadOnlyList<IngestStage> Stages =>
        LoadStages().AsReadOnly();

    /// <summary>
    /// Convenience accessor — deserialises <see cref="LastErrorJson"/>.
    /// Returns null for legacy / null rows.
    /// Excluded from the EF model for the same reason as
    /// <see cref="Stages"/>.
    /// </summary>
    [NotMapped]
    public IngestStageError? LastError =>
        string.IsNullOrEmpty(LastErrorJson)
            ? null
            : JsonSerializer.Deserialize<IngestStageError>(LastErrorJson);

    private List<IngestStage> LoadStages()
    {
        if (string.IsNullOrEmpty(StagesJson)) return new List<IngestStage>();
        try
        {
            return JsonSerializer.Deserialize<List<IngestStage>>(StagesJson) ?? new List<IngestStage>();
        }
        catch (JsonException)
        {
            // A corrupt jsonb row — return empty so the recorder can
            // rebuild from scratch.  Better than throwing and leaving
            // the document stuck.
            return new List<IngestStage>();
        }
    }

    private Dictionary<string, object?> LoadRawOutput()
    {
        if (string.IsNullOrEmpty(RawOutputJson)) return new Dictionary<string, object?>();
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(RawOutputJson)
                   ?? new Dictionary<string, object?>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, object?>();
        }
    }
}
