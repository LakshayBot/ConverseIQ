using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Application.Knowledge;

/// <summary>
/// Calls the Python AI Engine's <c>POST /api/v1/documents/enrich</c> endpoint
/// to run the LLM enrichment pass on a structured-mode document.  One HTTP
/// call per document — the Python side loops over pages internally and is
/// fail-open on individual page failures.
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

    public async Task<EnrichResponse?> EnrichAsync(
        Guid documentId,
        IReadOnlyList<EnrichPageInput> pages,
        CancellationToken ct = default)
    {
        if (pages.Count == 0)
        {
            _logger.LogInformation("enrich: document_id={DocId} has no pages to enrich", documentId);
            return new EnrichResponse { Pages = new List<EnrichPageOutput>() };
        }

        var client = _httpClientFactory.CreateClient("AiEngine");
        // Long timeout — qwen2.5:3b on CPU takes ~3-10s per page.  20 pages
        // × 10s = 200s.  Give 10 minutes of headroom.
        client.Timeout = TimeSpan.FromMinutes(10);

        var payload = new EnrichRequest
        {
            DocumentId = documentId.ToString(),
            Pages = pages.ToList(),
        };

        _logger.LogInformation(
            "enrich: calling AI Engine for document_id={DocId}, {PageCount} page(s)",
            documentId, pages.Count);

        try
        {
            var response = await client.PostAsJsonAsync("/api/v1/documents/enrich", payload, ct);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                _logger.LogWarning(
                    "enrich: AI Engine returned {Status} for document_id={DocId}: {Body}",
                    response.StatusCode, documentId, body);
                return null;
            }
            var result = await response.Content.ReadFromJsonAsync<EnrichResponse>(cancellationToken: ct);
            return result;
        }
        catch (TaskCanceledException tex) when (ct.IsCancellationRequested is false)
        {
            _logger.LogWarning(tex, "enrich: timed out for document_id={DocId}", documentId);
            return null;
        }
        catch (HttpRequestException hrex)
        {
            _logger.LogWarning(hrex, "enrich: HTTP error for document_id={DocId}", documentId);
            return null;
        }
    }

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

    public class EnrichResponse
    {
        [JsonPropertyName("document_id")] public string? DocumentId { get; set; }
        [JsonPropertyName("page_count")] public int PageCount { get; set; }
        [JsonPropertyName("enrichment_ms")] public int EnrichmentMs { get; set; }
        [JsonPropertyName("pages")] public List<EnrichPageOutput> Pages { get; set; } = new();
    }

    public class EnrichPageOutput
    {
        [JsonPropertyName("page")] public int Page { get; set; }
        [JsonPropertyName("page_type")] public string PageType { get; set; } = "other";
        [JsonPropertyName("products")] public List<EnrichedProductDto> Products { get; set; } = new();
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
