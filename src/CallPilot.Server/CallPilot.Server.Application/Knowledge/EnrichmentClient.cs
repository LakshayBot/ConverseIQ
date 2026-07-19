using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Application.Knowledge;

/// <summary>
/// Calls the Python AI Engine's <c>POST /api/v1/documents/enrich</c> endpoint
/// to run the LLM enrichment pass on a structured-mode document.  The
/// AI engine streams per-page results as NDJSON so the caller sees
/// each page the moment its LLM call returns — the .NET handler
/// writes each one to the database immediately so the dashboard
/// polls (every ~1.5s) reflect progress.
///
/// Used only by the background enrichment task in <see cref="KnowledgeUploadHandler"/>;
/// the upload path itself never blocks on this.
/// </summary>
public class EnrichmentClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<EnrichmentClient> _logger;

    public EnrichmentClient(IHttpClientFactory httpClientFactory, ILogger<EnrichmentClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// Stream-enrich a list of brochure pages.  Yields one
    /// <see cref="EnrichPageResult"/> per page as the LLM call
    /// returns, and a final <see cref="EnrichSummary"/> line at the
    /// end of the stream.
    /// </summary>
    /// <remarks>
    /// Uses <c>HttpCompletionOption.ResponseHeadersRead</c> so the
    /// caller can read NDJSON lines as they arrive rather than waiting
    /// for the full response body.  A 4-minute overall budget matches
    /// the original batched call: 30 pages × 3 concurrent × ~30s
    /// each = 5 minutes worst case, but most documents complete in
    /// well under a minute on Groq's free tier.
    /// </remarks>
    public async IAsyncEnumerable<EnrichEvent> EnrichStreamingAsync(
        Guid documentId,
        IReadOnlyList<EnrichPageInput> pages,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (pages.Count == 0)
        {
            yield return new EnrichSummary(
                PageCount: 0, ProductsTotal: 0, FailureCount: 0, EnrichmentMs: 0);
            yield break;
        }

        var client = _httpClientFactory.CreateClient("AiEngine");
        client.Timeout = TimeSpan.FromMinutes(4);

        var payload = new EnrichRequest
        {
            DocumentId = documentId.ToString(),
            Pages = pages.ToList(),
        };

        _logger.LogInformation(
            "enrich: streaming from AI Engine for document_id={DocId}, {PageCount} page(s)",
            documentId, pages.Count);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/documents/enrich")
        {
            Content = JsonContent.Create(payload),
        };
        using var response = await client.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "enrich: AI Engine returned {Status} for document_id={DocId}: {Body}",
                response.StatusCode, documentId, body);
            yield break;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream)
        {
            if (ct.IsCancellationRequested) yield break;
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrEmpty(line)) continue;

            EnrichEventDto? dto;
            try
            {
                dto = JsonSerializer.Deserialize<EnrichEventDto>(line, JsonOpts);
            }
            catch (JsonException jex)
            {
                _logger.LogWarning(jex, "enrich: malformed NDJSON line: {Line}", line);
                continue;
            }
            if (dto is null) continue;

            // Route by the `kind` discriminator the AI engine emits.
            // The "page" / "summary" values match the FastAPI router.
            if (string.Equals(dto.Kind, "page", StringComparison.OrdinalIgnoreCase))
            {
                yield return new EnrichPageResult(
                    Page: dto.Page,
                    PageType: dto.PageType ?? "other",
                    Products: dto.Products ?? new List<EnrichedProductDto>(),
                    Outcome: dto.Outcome);
            }
            else if (string.Equals(dto.Kind, "summary", StringComparison.OrdinalIgnoreCase))
            {
                yield return new EnrichSummary(
                    PageCount: dto.PageCount,
                    ProductsTotal: dto.ProductsTotal,
                    FailureCount: dto.FailureCount,
                    EnrichmentMs: dto.EnrichmentMs);
            }
            else
            {
                _logger.LogWarning("enrich: unknown event kind {Kind} on line: {Line}",
                    dto.Kind, line);
            }
        }
    }

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    // ── Stream events ───────────────────────────────────────────────────

    /// <summary>
    /// Base record for events on the enrichment stream.  Discriminate
    /// via <see cref="Kind"/>; the concrete types are
    /// <see cref="EnrichPageResult"/> and <see cref="EnrichSummary"/>.
    /// </summary>
    public abstract record EnrichEvent;

    /// <summary>
    /// One enriched page.  The AI engine emits one of these per
    /// page as soon as its LLM call returns.
    /// </summary>
    public record EnrichPageResult(
        int Page,
        string PageType,
        List<EnrichedProductDto> Products,
        PageOutcome? Outcome) : EnrichEvent;

    /// <summary>
    /// Final line of the enrichment stream with aggregate counts.
    /// </summary>
    public record EnrichSummary(
        int PageCount,
        int ProductsTotal,
        int FailureCount,
        int EnrichmentMs) : EnrichEvent;

    // ── DTOs (mirror engine/services/enrichment_service.py) ─────────────

    public class EnrichRequest
    {
        [JsonPropertyName("document_id")] public string DocumentId { get; set; } = "";
        [JsonPropertyName("pages")] public List<EnrichPageInput> Pages { get; set; } = new();
    }

    public class EnrichPageInput
    {
        [JsonPropertyName("page")] public int Page { get; set; }
        [JsonPropertyName("text")] public string Text { get; set; } = "";
    }

    /// <summary>
    /// Internal type for the polymorphic stream.  Uses a <c>kind</c>
    /// discriminator to route to <see cref="EnrichPageResult"/> or
    /// <see cref="EnrichSummary"/>.  Only the field the discriminator
    /// names gets populated.
    /// </summary>
    private class EnrichEventDto
    {
        [JsonPropertyName("kind")] public string? Kind { get; set; }
        // page-result fields
        [JsonPropertyName("page")] public int Page { get; set; }
        [JsonPropertyName("page_type")] public string PageType { get; set; } = "other";
        [JsonPropertyName("products")] public List<EnrichedProductDto> Products { get; set; } = new();
        [JsonPropertyName("outcome")] public PageOutcome? Outcome { get; set; }
        // summary fields
        [JsonPropertyName("page_count")] public int PageCount { get; set; }
        [JsonPropertyName("products_total")] public int ProductsTotal { get; set; }
        [JsonPropertyName("failure_count")] public int FailureCount { get; set; }
        [JsonPropertyName("enrichment_ms")] public int EnrichmentMs { get; set; }
    }

    public class PageOutcome
    {
        // One of: "ok" | "no_products" | "missing_key" | "http_4xx" |
        // "http_5xx" | "timeout" | "connection_error" | "parse_error" | "unknown"
        [JsonPropertyName("status")] public string Status { get; set; } = "unknown";
        [JsonPropertyName("model")] public string? Model { get; set; }
        [JsonPropertyName("duration_ms")] public int DurationMs { get; set; }
        [JsonPropertyName("error")] public string? Error { get; set; }
        // 0 = succeeded or failed on first try. 1+ = at least one
        // rate-limit retry (the AI engine waited the suggested
        // "Please try again in Xs" before re-trying).  The dashboard
        // surfaces this so the user can see which pages were slowed
        // by Groq throttling.
        [JsonPropertyName("retry_count")] public int RetryCount { get; set; } = 0;
    }

    public class EnrichedProductDto
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("category")] public string? Category { get; set; }
        [JsonPropertyName("headline")] public string? Headline { get; set; }
        [JsonPropertyName("key_features")] public List<string> KeyFeatures { get; set; } = new();
        [JsonPropertyName("pricing")] public string? Pricing { get; set; }
        [JsonPropertyName("best_for")] public string? BestFor { get; set; }
        [JsonPropertyName("differentiators")] public List<string> Differentiators { get; set; } = new();
        [JsonPropertyName("raw_claims")] public List<string> RawClaims { get; set; } = new();
        [JsonPropertyName("page_type")] public string PageType { get; set; } = "other";
        // Pre-rendered chunk text from the Python service — the .NET handler
        // persists this verbatim into KnowledgeChunk.Text.
        [JsonPropertyName("chunk_text")] public string ChunkText { get; set; } = "";
    }
}
