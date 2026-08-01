using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using CallPilot.Server.Infrastructure.Knowledge;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Application.Knowledge;

/// <summary>
/// Client for the Python AI Engine's <c>POST /api/v1/documents/ingest-structured</c>
/// endpoint. Returns structure-aware chunks (heading + page + chunk_type) for
/// the .NET upload handler to embed and persist.
///
/// Used only when the upload (or reindex) is marked <c>mode=structured</c>.
/// Fast mode stays in-process with Docnet.Core.
/// </summary>
public class StructuredIngestClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<StructuredIngestClient> _logger;

    public StructuredIngestClient(IHttpClientFactory httpClientFactory, ILogger<StructuredIngestClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<StructuredIngestResult?> IngestAsync(Guid documentId, string fileName, byte[] pdfBytes, CancellationToken ct = default)
    {
        var client = _httpClientFactory.CreateClient("AiEngine");
        client.Timeout = TimeSpan.FromMinutes(5); // Docling can take 1-3 min on a 20-page PDF

        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(pdfBytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(fileContent, "file", fileName);

        _logger.LogInformation("Calling AI Engine structured ingest for {FileName} ({Bytes} bytes)", fileName, pdfBytes.Length);

        var sw = System.Diagnostics.Stopwatch.StartNew();
        HttpResponseMessage response;
        try
        {
            response = await client.PostAsync("/api/v1/documents/ingest-structured", form, ct);
        }
        catch (TaskCanceledException tex) when (ct.IsCancellationRequested is false)
        {
            _logger.LogError(tex, "AI Engine structured ingest timed out after {Elapsed}", sw.Elapsed);
            throw new TimeoutException($"AI Engine structured ingest timed out after {sw.Elapsed} for {fileName}", tex);
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogError("AI Engine structured ingest failed: {Status} {Body}", response.StatusCode, body);
            throw new HttpRequestException(
                $"AI Engine structured ingest returned {response.StatusCode} for {fileName}: {body}");
        }

        var payload = await response.Content.ReadFromJsonAsync<IngestResponse>(cancellationToken: ct);
        if (payload is null || payload.Chunks is null)
        {
            _logger.LogWarning("AI Engine returned empty ingest response for {FileName}", fileName);
            return null;
        }

        _logger.LogInformation(
            "AI Engine structured ingest returned {Count} chunks in {ExtractionMs}ms ({TotalMs}ms round-trip)",
            payload.Chunks.Count, payload.ExtractionMs, sw.ElapsedMilliseconds);

        var chunks = new List<TextChunk>(payload.Chunks.Count);
        var runningOffset = 0;
        for (var i = 0; i < payload.Chunks.Count; i++)
        {
            var c = payload.Chunks[i];
            var page = c.Page > 0 ? c.Page : 0;
            chunks.Add(new TextChunk(
                documentId,
                i,
                c.Text,
                EstimateTokenCount(c.Text),
                runningOffset,
                c.Text.Length,
                c.SectionHeading,
                c.ChunkType ?? "paragraph",
                page,
                BuildMetadataJson(c)));
            runningOffset += c.Text.Length + 1;
        }

        // Surface the AI engine's "docling" block (page count, convert
        // timings, model-load time) so the upload handler can stash it
        // for the dashboard's "View raw" tab.
        var doclingMeta = payload.Docling is { } d
            ? new DoclingMetadata
            {
                PageCount = d.GetValueOrDefault("page_count") is System.Text.Json.JsonElement pcEl
                            && pcEl.ValueKind == System.Text.Json.JsonValueKind.Number
                            && pcEl.TryGetInt32(out var pc) ? pc : 0,
                ConvertMs = d.GetValueOrDefault("convert_ms") is System.Text.Json.JsonElement cvEl
                            && cvEl.ValueKind == System.Text.Json.JsonValueKind.Number
                            && cvEl.TryGetInt32(out var cv) ? cv : 0,
                ChunkMs = d.GetValueOrDefault("chunk_ms") is System.Text.Json.JsonElement ckEl
                          && ckEl.ValueKind == System.Text.Json.JsonValueKind.Number
                          && ckEl.TryGetInt32(out var ck) ? ck : 0,
                ModelLoadMs = d.GetValueOrDefault("model_load_ms") is System.Text.Json.JsonElement mlEl
                              && mlEl.ValueKind == System.Text.Json.JsonValueKind.Number
                              && mlEl.TryGetInt32(out var ml) ? ml : null,
                Warnings = d.GetValueOrDefault("warnings") is System.Text.Json.JsonElement wEl
                           && wEl.ValueKind == System.Text.Json.JsonValueKind.Array
                    ? wEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                    : new List<string>(),
            }
            : null;

        return new StructuredIngestResult
        {
            Chunks = chunks,
            Docling = doclingMeta,
        };
    }

    private static int EstimateTokenCount(string text) =>
        (int)Math.Ceiling(text.Split([' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries).Length * 1.3);

    private static string BuildMetadataJson(IngestChunk c)
    {
        // Use the Python service's metadata blob if present, otherwise build a
        // minimal one. Always stamp source_mode="structured" so retrieval-time
        // filters can distinguish Docling chunks from Docnet chunks.
        if (c.Metadata is { ValueKind: JsonValueKind.Object } meta)
        {
            using var doc = JsonDocument.Parse(meta.GetRawText());
            var dict = new Dictionary<string, object?>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                dict[prop.Name] = JsonSerializer.Deserialize<object?>(prop.Value.GetRawText());
            }
            dict["source_mode"] = "structured";
            return JsonSerializer.Serialize(dict);
        }

        return JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["source_mode"] = "structured",
            ["chunk_type"] = c.ChunkType ?? "paragraph",
            ["section_heading"] = c.SectionHeading,
            ["pages"] = c.Pages,
        });
    }

    // ── Public result type ──────────────────────────────────────────────

    /// <summary>
    /// Output of <see cref="IngestAsync"/>.  Carries the chunks the
    /// upload handler persists plus a small metadata block the
    /// dashboard uses to show "Docling: N pages, Mms model load,
    /// Kms convert" - surfaced via the
    /// <c>KnowledgeDocument.RawOutputJson</c> jsonb column.
    /// </summary>
    public class StructuredIngestResult
    {
        public List<TextChunk> Chunks { get; set; } = new();
        public DoclingMetadata? Docling { get; set; }
    }

    public class DoclingMetadata
    {
        public int PageCount { get; set; }
        public int ConvertMs { get; set; }
        public int ChunkMs { get; set; }
        public int? ModelLoadMs { get; set; }   // null on warm calls
        public List<string> Warnings { get; set; } = new();
    }

    // ── Response DTOs (mirror engine/routers/ingest_router.py) ─────────────

    private sealed class IngestResponse
    {
        [JsonPropertyName("filename")] public string? Filename { get; set; }
        [JsonPropertyName("size_bytes")] public long SizeBytes { get; set; }
        [JsonPropertyName("chunk_count")] public int ChunkCount { get; set; }
        [JsonPropertyName("extraction_ms")] public int ExtractionMs { get; set; }
        [JsonPropertyName("docling")] public Dictionary<string, object>? Docling { get; set; }
        [JsonPropertyName("chunks")] public List<IngestChunk> Chunks { get; set; } = new();
    }

    private sealed class IngestChunk
    {
        [JsonPropertyName("text")] public string Text { get; set; } = "";
        [JsonPropertyName("section_heading")] public string? SectionHeading { get; set; }
        [JsonPropertyName("chunk_type")] public string? ChunkType { get; set; }
        [JsonPropertyName("page")] public int Page { get; set; }
        [JsonPropertyName("pages")] public List<int>? Pages { get; set; }
        [JsonPropertyName("metadata")] public JsonElement? Metadata { get; set; }
    }
}
