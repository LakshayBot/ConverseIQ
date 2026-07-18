using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Domain.Meetings;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Embedding;
using CallPilot.Server.Infrastructure.Knowledge;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Net.Http.Json;

namespace CallPilot.Server.Application.Knowledge;

public enum IngestMode
{
    /// <summary>Docnet.Core + paragraph chunker in-process. Sub-second, no network hop. Default.</summary>
    Fast,
    /// <summary>Forwards PDF to Python AI Engine (Docling). Preserves layout, headings, page numbers. 5-60s.</summary>
    Structured,
}

public class KnowledgeUploadHandler
{
    private readonly CallPilotDbContext _dbContext;
    private readonly TextExtractorFactory _extractorFactory;
    private readonly ChunkingService _chunkingService;
    private readonly EmbeddingService _embeddingService;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly StructuredIngestClient _structuredIngest;
    private readonly EnrichmentClient _enrichmentClient;
    private readonly ILogger<KnowledgeUploadHandler> _logger;

    public KnowledgeUploadHandler(
        CallPilotDbContext dbContext,
        TextExtractorFactory extractorFactory,
        ChunkingService chunkingService,
        EmbeddingService embeddingService,
        IHttpClientFactory httpClientFactory,
        IServiceScopeFactory scopeFactory,
        StructuredIngestClient structuredIngest,
        EnrichmentClient enrichmentClient,
        ILogger<KnowledgeUploadHandler> logger)
    {
        _dbContext = dbContext;
        _extractorFactory = extractorFactory;
        _chunkingService = chunkingService;
        _embeddingService = embeddingService;
        _httpClientFactory = httpClientFactory;
        _scopeFactory = scopeFactory;
        _structuredIngest = structuredIngest;
        _enrichmentClient = enrichmentClient;
        _logger = logger;
    }

    public Task<KnowledgeDocument> UploadAsync(
        Guid userId,
        string fileName,
        string contentType,
        long fileSize,
        Stream fileStream)
        => UploadAsync(userId, fileName, contentType, fileSize, fileStream, IngestMode.Fast);

    public async Task<KnowledgeDocument> UploadAsync(
        Guid userId,
        string fileName,
        string contentType,
        long fileSize,
        Stream fileStream,
        IngestMode mode)
    {
        var document = new KnowledgeDocument(userId, fileName, contentType, fileSize);
        // Persist the ingest mode so the dashboard can show the right
        // status columns (e.g. "Skipped" in the LLM column for fast-mode
        // docs).  Mode is written before ProcessAsync kicks off the
        // background enrichment so the GET /status endpoint returns it
        // immediately, even mid-pipeline.
        document.SetMode(mode.ToString().ToLowerInvariant());

        var uploadsDir = Path.Combine(Directory.GetCurrentDirectory(), "uploads");
        Directory.CreateDirectory(uploadsDir);

        var storagePath = Path.Combine(uploadsDir, $"{document.Id}_{fileName}");
        using (var fileWriteStream = new FileStream(storagePath, FileMode.Create))
        {
            await fileStream.CopyToAsync(fileWriteStream);
        }
        document.SetStoragePath(storagePath);

        _dbContext.KnowledgeDocuments.Add(document);
        await _dbContext.SaveChangesAsync();

        await ProcessAsync(document, fileStream, mode);

        return document;
    }

    public Task<KnowledgeDocument?> ReindexAsync(Guid userId, Guid documentId)
        => ReindexAsync(userId, documentId, IngestMode.Fast);

    /// <summary>
    /// Wipes existing chunks/embeddings/entities for an already-stored document and
    /// re-runs extraction → chunking → embedding against the original file. Used to
    /// recover documents ingested with a broken extractor, or to switch an existing
    /// document between fast and structured modes.
    /// </summary>
    public async Task<KnowledgeDocument?> ReindexAsync(Guid userId, Guid documentId, IngestMode mode)
    {
        var document = await _dbContext.KnowledgeDocuments
            .FirstOrDefaultAsync(d => d.Id == documentId && d.UserId == userId);

        if (document is null) return null;
        if (string.IsNullOrEmpty(document.StoragePath) || !File.Exists(document.StoragePath))
        {
            document.SetProcessingStatus("Source file missing — re-upload required");
            await _dbContext.SaveChangesAsync();
            return document;
        }

        // Wipe children so the document is re-processable from a clean slate.
        var existingChunks = await _dbContext.KnowledgeChunks
            .Where(c => c.DocumentId == documentId)
            .ToListAsync();
        var existingEntities = await _dbContext.DocumentEntities
            .Where(e => e.DocumentId == documentId)
            .ToListAsync();

        _dbContext.KnowledgeChunks.RemoveRange(existingChunks);
        _dbContext.DocumentEntities.RemoveRange(existingEntities);
        await _dbContext.SaveChangesAsync();

        // Update the mode in case the user is switching fast↔structured on
        // a reindex.  Write it before ProcessAsync so /status reflects the
        // new mode immediately.
        document.SetMode(mode.ToString().ToLowerInvariant());
        await _dbContext.SaveChangesAsync();

        using var fs = File.OpenRead(document.StoragePath);
        await ProcessAsync(document, fs, mode);

        return document;
    }

    /// <summary>
    /// Shared extraction → chunking → embedding pipeline used by both upload and reindex.
    /// </summary>
    private async Task ProcessAsync(KnowledgeDocument document, Stream fileStream, IngestMode mode)
    {
        try
        {
            // Fast mode: keep the current path so existing PDF behavior doesn't
            // change. Structured mode: forward the bytes to the Python AI Engine
            // for layout-aware extraction.
            List<TextChunk> chunks;
            string? rawTextForEntityExtraction;

            if (mode == IngestMode.Structured)
            {
                (chunks, rawTextForEntityExtraction) = await ExtractStructuredAsync(document, fileStream);
            }
            else
            {
                (chunks, rawTextForEntityExtraction) = await ExtractFastAsync(document, fileStream);
            }

            if (chunks.Count == 0)
            {
                document.SetProcessingStatus("No extractable text found");
                await _dbContext.SaveChangesAsync();
                return;
            }

            document.SetProcessingStatus("Embedding");
            await _dbContext.SaveChangesAsync();

            foreach (var chunk in chunks)
            {
                var knowledgeChunk = new KnowledgeChunk(
                    chunk.DocumentId,
                    chunk.ChunkIndex,
                    chunk.Text,
                    chunk.TokenCount,
                    chunk.CharOffset,
                    chunk.CharLength,
                    sectionHeading: chunk.SectionHeading,
                    chunkType: chunk.ChunkType,
                    pageHint: chunk.PageHint,
                    metadataJson: chunk.MetadataJson);

                _dbContext.KnowledgeChunks.Add(knowledgeChunk);
                await _dbContext.SaveChangesAsync();

                var embedding = await _embeddingService.GenerateEmbeddingAsync(chunk.Text)
                    ?? _embeddingService.GenerateLocalEmbedding(chunk.Text);

                var embeddingEntity = new Embedding(
                    knowledgeChunk.Id,
                    embedding,
                    "all-MiniLM-L6-v2");

                _dbContext.Embeddings.Add(embeddingEntity);
            }

            await _dbContext.SaveChangesAsync();
            document.SetProcessingStatus("Indexed");
            await _dbContext.SaveChangesAsync();

            _logger.LogInformation(
                "Document indexed: {FileName}, {ChunkCount} chunks, mode={Mode}",
                document.FileName, chunks.Count, mode);

            // ── Dynamic Entity Extraction (GLiNER, runs async — does not block) ──
            if (rawTextForEntityExtraction is not null)
            {
                var textForEntities = rawTextForEntityExtraction;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await ExtractAndStoreEntitiesAsync(document.Id, textForEntities);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Entity extraction skipped for {FileName}: {Message}", document.FileName, ex.Message);
                    }
                });
            }

            // ── Async LLM enrichment pass (structured mode only) ─────────────
            // Replaces thin Docling chunks with rich product cards for any
            // page the LLM could parse.  Never blocks the upload response:
            // the original Docling chunks + embeddings are already persisted
            // and queryable, so a slow Ollama or network blip just leaves
            // them in place.  Fast mode is intentionally not enriched.
            if (mode == IngestMode.Structured)
            {
                var docId = document.Id;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await RunBackgroundEnrichmentAsync(docId);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Background enrichment failed for {DocId}", docId);
                    }
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process document {FileName}", document.FileName);
            document.SetProcessingStatus($"Error: {ex.Message}");
            await _dbContext.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Fast extraction: Docnet.Core + paragraph-aware chunker, both in-process.
    /// </summary>
    private async Task<(List<TextChunk> chunks, string? rawText)> ExtractFastAsync(
        KnowledgeDocument document, Stream fileStream)
    {
        document.SetProcessingStatus("Extracting");
        await _dbContext.SaveChangesAsync();

        if (fileStream.CanSeek) fileStream.Position = 0;
        var extractor = _extractorFactory.GetExtractor(document.ContentType);
        if (extractor is null)
        {
            document.SetProcessingStatus($"Unsupported format: {document.ContentType}");
            await _dbContext.SaveChangesAsync();
            return ([], null);
        }

        var text = await extractor.ExtractTextAsync(fileStream);
        if (string.IsNullOrWhiteSpace(text))
        {
            return ([], null);
        }
        text = SanitizeText(text);

        document.SetProcessingStatus("Chunking");
        await _dbContext.SaveChangesAsync();

        return (_chunkingService.ChunkText(text, document.Id), text);
    }

    /// <summary>
    /// Structured extraction: forward the PDF to the Python AI Engine. Returns
    /// pre-chunked TextChunk records with section_heading, chunk_type, and page
    /// numbers populated. Also builds a GLiNER-friendly text blob by prepending
    /// structured context ([chunk_type] section_heading) to each chunk so entity
    /// extraction can run with higher confidence than flat fast-mode text.
    /// </summary>
    private async Task<(List<TextChunk> chunks, string? rawText)> ExtractStructuredAsync(
        KnowledgeDocument document, Stream fileStream)
    {
        document.SetProcessingStatus("Extracting (structured)");
        await _dbContext.SaveChangesAsync();

        if (fileStream.CanSeek) fileStream.Position = 0;
        using var ms = new MemoryStream();
        await fileStream.CopyToAsync(ms);
        var bytes = ms.ToArray();

        var chunks = await _structuredIngest.IngestAsync(document.Id, document.FileName, bytes);
        if (chunks is null || chunks.Count == 0)
            return ([], null);

        var sb = new System.Text.StringBuilder();
        foreach (var chunk in chunks)
        {
            sb.Append('[').Append(chunk.ChunkType).Append("] ");
            if (!string.IsNullOrWhiteSpace(chunk.SectionHeading))
                sb.Append(chunk.SectionHeading).Append('\n');
            sb.Append(chunk.Text).Append("\n\n");
        }

        return (chunks, sb.ToString().Trim());
    }

    public async Task<IReadOnlyList<KnowledgeDocument>> ListDocumentsAsync(Guid userId)
    {
        return await _dbContext.KnowledgeDocuments
            .Include(d => d.Chunks)
            .Where(d => d.UserId == userId)
            .OrderByDescending(d => d.CreatedAt)
            .ToListAsync();
    }

    public async Task DeleteDocumentAsync(Guid userId, Guid documentId)
    {
        var document = await _dbContext.KnowledgeDocuments
            .FirstOrDefaultAsync(d => d.Id == documentId && d.UserId == userId);

        if (document is null)
            throw new KeyNotFoundException("Document not found");

        if (document.StoragePath is not null && File.Exists(document.StoragePath))
        {
            File.Delete(document.StoragePath);
        }

        _dbContext.KnowledgeDocuments.Remove(document);
        await _dbContext.SaveChangesAsync();
    }

    private async Task ExtractAndStoreEntitiesAsync(Guid documentId, string text)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();
        var factory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();

        var client = factory.CreateClient("AiEngine");
        // 0.3 captures brand product names ("Apex 100", "Prodigy", "Liberty 500"…)
        // that GLiNER's "product name" label scores in the 0.4-0.5 range — the
        // stricter 0.4 default missed almost all of them and left the live trie
        // with only generic terms like "transformer-operated smart meter".
        var response = await client.PostAsJsonAsync(
            "/api/v1/ai/extract-entities",
            new { text, confidence_threshold = 0.3 });

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("GLiNER extraction returned {StatusCode}", response.StatusCode);
            return;
        }

        var result = await response.Content.ReadFromJsonAsync<ExtractEntitiesResponse>();
        var entities = result?.Entities ?? [];
        if (entities.Count == 0) return;

        foreach (var ent in entities)
        {
            var entity = new DocumentEntity(
                documentId, null, ent.EntityText, ent.EntityType, ent.Confidence);
            db.DocumentEntities.Add(entity);
        }
        await db.SaveChangesAsync();
        _logger.LogInformation("GLiNER extracted {Count} entities from document {DocId}", entities.Count, documentId);

        await RebuildTrieAsync(client, db);
    }

    /// <summary>
    /// Background enrichment pass — fires after the upload response is already
    /// returned to the client.  Calls the Python AI Engine
    /// <c>/api/v1/documents/enrich</c> endpoint, replaces the original Docling
    /// chunks for any page that yielded product cards, re-embeds the new
    /// chunks, and updates <c>EnrichmentStatus</c>.
    ///
    /// Failures are non-fatal: if the LLM is unreachable, slow, or returns
    /// no products, the document keeps the original Docling chunks and
    /// <c>EnrichmentStatus</c> is set to <c>enrichment_failed</c>.
    /// </summary>
    private async Task RunBackgroundEnrichmentAsync(Guid documentId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();
        var factory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();
        var embeddingService = scope.ServiceProvider.GetRequiredService<EmbeddingService>();

        var document = await db.KnowledgeDocuments
            .Include(d => d.Chunks)
            .FirstOrDefaultAsync(d => d.Id == documentId);
        if (document is null)
        {
            _logger.LogWarning("enrich: document {DocId} not found, skipping", documentId);
            return;
        }

        document.SetEnrichmentStatus("enriching");
        await db.SaveChangesAsync();

        // Group existing chunks by page so we can replace the whole page's
        // chunks in one shot when enrichment succeeds.  Chunks with no
        // page hint (page_hint == 0) are kept regardless of enrichment.
        var pageGroups = document.Chunks
            .Where(c => c.PageHint > 0)
            .GroupBy(c => c.PageHint)
            .ToDictionary(g => g.Key, g => g.ToList());

        if (pageGroups.Count == 0)
        {
            _logger.LogInformation(
                "enrich: document {DocId} has no page-tagged chunks, skipping",
                documentId);
            document.SetEnrichmentStatus("enrichment_failed");
            await db.SaveChangesAsync();
            return;
        }

        // Build the page text input by concatenating chunks per page.
        var pageInputs = pageGroups
            .OrderBy(kv => kv.Key)
            .Select(kv => new EnrichmentClient.EnrichPageInput
            {
                Page = kv.Key,
                Text = string.Join("\n\n", kv.Value.Select(c => c.Text)),
            })
            .ToList();

        EnrichmentClient.EnrichResponse? result = null;
        try
        {
            result = await _enrichmentClient.EnrichAsync(documentId, pageInputs);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "enrich: AI Engine call failed for {DocId}", documentId);
        }

        if (result is null)
        {
            document.SetEnrichmentStatus("enrichment_failed");
            await db.SaveChangesAsync();
            return;
        }

        // Apply per-page replacements: for each page that returned product
        // cards, delete the original Docling chunks and insert one product
        // card chunk per product.  Pages with no products keep their
        // original chunks untouched.
        var client = factory.CreateClient("AiEngine");
        var newChunksAdded = 0;
        var chunksDeleted = 0;
        var allNewProductNames = new List<string>();

        // Index existing chunks by id for cheap lookup + delete.
        var existingChunks = await db.KnowledgeChunks
            .Where(c => c.DocumentId == documentId)
            .ToListAsync();

        var existingByPage = existingChunks
            .Where(c => c.PageHint > 0)
            .GroupBy(c => c.PageHint)
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var pageResult in result.Pages)
        {
            if (pageResult.Products.Count == 0) continue;
            if (!existingByPage.TryGetValue(pageResult.Page, out var pageChunks)) continue;

            // Delete the original Docling chunks for this page (and their
            // embeddings via cascade).
            foreach (var chunk in pageChunks)
            {
                var embeddings = await db.Embeddings
                    .Where(e => e.ChunkId == chunk.Id)
                    .ToListAsync();
                db.Embeddings.RemoveRange(embeddings);
                db.KnowledgeChunks.Remove(chunk);
                chunksDeleted++;
            }
            existingChunks.RemoveAll(c => c.PageHint == pageResult.Page);

            // Insert one chunk per product, with the pre-rendered chunk text
            // and the original EnrichedProduct JSON in MetadataJson.
            var baseIndex = existingChunks.Count;
            for (int i = 0; i < pageResult.Products.Count; i++)
            {
                var product = pageResult.Products[i];
                var newChunk = new KnowledgeChunk(
                    documentId,
                    baseIndex + i,
                    product.ChunkText,
                    EstimateTokenCount(product.ChunkText),
                    0,
                    product.ChunkText.Length,
                    sectionHeading: product.Name,
                    chunkType: "product_card",
                    pageHint: pageResult.Page,
                    metadataJson: SerializeProductMetadata(product, pageResult.PageType));
                db.KnowledgeChunks.Add(newChunk);
                await db.SaveChangesAsync();

                var embedding = await embeddingService.GenerateEmbeddingAsync(product.ChunkText)
                    ?? embeddingService.GenerateLocalEmbedding(product.ChunkText);
                db.Embeddings.Add(new Embedding(newChunk.Id, embedding, "all-MiniLM-L6-v2"));
                newChunksAdded++;
                allNewProductNames.Add(product.Name);
            }
        }

        await db.SaveChangesAsync();
        _logger.LogInformation(
            "enrich: document {DocId} — added {Added} product card chunks, removed {Removed} Docling chunks",
            documentId, newChunksAdded, chunksDeleted);

        // Re-run GLiNER on the new product card chunks so the live trie picks
        // up the brand product names.  This intentionally re-extracts over
        // the full document text — most product names appear in the cards
        // AND the surrounding context.
        var allText = string.Join("\n\n",
            await db.KnowledgeChunks
                .Where(c => c.DocumentId == documentId)
                .Select(c => c.Text)
                .ToListAsync());
        try
        {
            await ExtractAndStoreEntitiesAsync(documentId, allText);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "enrich: post-enrichment GLiNER pass failed for {DocId}", documentId);
        }

        document.SetEnrichmentStatus("enriched");
        await db.SaveChangesAsync();
    }

    private static int EstimateTokenCount(string text) =>
        string.IsNullOrEmpty(text) ? 0 :
        (int)Math.Ceiling(text.Split([' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries).Length * 1.3);

    private static string SerializeProductMetadata(
        EnrichmentClient.EnrichedProductDto product, string pageType)
    {
        var dict = new Dictionary<string, object?>
        {
            ["source_mode"] = "enriched",
            ["chunk_type"] = "product_card",
            ["enrichment"] = new Dictionary<string, object?>
            {
                ["name"] = product.Name,
                ["category"] = product.Category,
                ["headline"] = product.Headline,
                ["key_features"] = product.KeyFeatures,
                ["pricing"] = product.Pricing,
                ["best_for"] = product.BestFor,
                ["differentiators"] = product.Differentiators,
                ["raw_claims"] = product.RawClaims,
                ["page_type"] = string.IsNullOrEmpty(product.PageType) ? pageType : product.PageType,
            },
        };
        return System.Text.Json.JsonSerializer.Serialize(dict);
    }

    private static async Task RebuildTrieAsync(HttpClient client, CallPilotDbContext db)
    {
        try
        {
            var entities = await db.DocumentEntities
                .Select(e => new { entity_text = e.EntityText, entity_type = e.EntityType, document_id = e.DocumentId.ToString() })
                .ToListAsync();
            var response = await client.PostAsJsonAsync("/api/v1/ai/trie/rebuild", new { entities });
            if (!response.IsSuccessStatusCode)
            {
                // Best-effort; log is handled by caller
            }
        }
        catch
        {
            // Trie rebuild is best-effort; don't fail the ingest
        }
    }

    private static string SanitizeText(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        // Remove null bytes and other control chars that PostgreSQL rejects
        var sb = new System.Text.StringBuilder(text.Length);
        foreach (char c in text)
        {
            if (c == '\0') continue;       // null byte
            if (c == '�') continue;   // unicode replacement char
            if (char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.OtherNotAssigned)
                continue;
            sb.Append(c);
        }
        return sb.ToString().Trim();
    }

    private class ExtractEntitiesResponse
    {
        [System.Text.Json.Serialization.JsonPropertyName("entities")]
        public List<ExtractedEntity> Entities { get; set; } = [];
    }

    private class ExtractedEntity
    {
        [System.Text.Json.Serialization.JsonPropertyName("entity_text")]
        public string EntityText { get; set; } = "";
        [System.Text.Json.Serialization.JsonPropertyName("entity_type")]
        public string EntityType { get; set; } = "";
        [System.Text.Json.Serialization.JsonPropertyName("confidence")]
        public double Confidence { get; set; }
    }
}
