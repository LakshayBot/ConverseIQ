namespace CallPilot.Server.Domain.Knowledge;

/// <summary>
/// Live progress of the LLM enrichment pass.  Persisted on
/// <see cref="KnowledgeDocument"/> as a jsonb column and updated by
/// the background enrichment task as each page completes, so the
/// dashboard polls (every ~1.5s) see real-time per-page status
/// during the run rather than just "enriching" until the batch
/// returns.
/// </summary>
/// <param name="Total">Total pages to enrich (snapshot at start).</param>
/// <param name="Completed">
/// Pages whose outcome status is one of <c>ok | no_products</c> -
/// these are the "successful" pages (the LLM was reachable and gave
/// us an answer, even if the answer was "no products here").
/// </param>
/// <param name="Failed">
/// Pages whose outcome status is anything else (auth, rate limit,
/// timeout, parse error, etc.) - surfaced on the Errors tab.
/// </param>
/// <param name="InFlight">
/// Pages still in the semaphore - <c>Total - Completed - Failed - InFlight</c>
/// is the number of pages not yet started.  Useful for the dashboard
/// to render "5 in flight, 3 done, 1 failed" live.
/// </param>
/// <param name="Pages">
/// Per-page status, one entry per page (order matches the input).
/// Updated as each page completes; consumers should re-read the
/// column on every poll.
/// </param>
public sealed record EnrichmentProgress(
    int Total,
    int Completed,
    int Failed,
    int InFlight,
    IReadOnlyList<EnrichmentPageStatus> Pages)
{
    public int NotStarted => Math.Max(0, Total - Completed - Failed - InFlight);
}

/// <summary>
/// One page's outcome in the enrichment pass.  Mirrors the
/// <c>outcome</c> object the AI engine emits on each NDJSON line.
/// </summary>
public sealed record EnrichmentPageStatus(
    int Page,
    string Status,    // "ok" | "no_products" | "missing_key" | "http_4xx" |
                      // "http_5xx" | "timeout" | "connection_error" |
                      // "parse_error" | "unknown"
    string? Model,
    int DurationMs,
    string? Error,
    DateTime? FinishedAt,
    /// <summary>
    /// How many times the AI engine retried this page on a Groq
    /// rate-limit (429) before succeeding (or giving up).  Surfaced
    /// in the dashboard so the user can see which pages needed a
    /// retry - 0 = clean first-try, 1+ = at least one rate-limit
    /// backoff.
    /// </summary>
    int RetryCount = 0,
    /// <summary>
    /// Prefilter skip reason for no_products pages.  Null on ok/failed
    /// pages.  Used to surface "scanned PDF" warnings when many pages
    /// are no_text_layer.
    /// </summary>
    string? SkipReason = null)
{
    public bool IsOk => Status == "ok";
    public bool IsFailure => !IsOk && Status != "no_products";
}
