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
    private readonly ILogger<KnowledgeUploadHandler> _logger;

    public KnowledgeUploadHandler(
        CallPilotDbContext dbContext,
        TextExtractorFactory extractorFactory,
        ChunkingService chunkingService,
        EmbeddingService embeddingService,
        IHttpClientFactory httpClientFactory,
        IServiceScopeFactory scopeFactory,
        StructuredIngestClient structuredIngest,
        ILogger<KnowledgeUploadHandler> logger)
    {
        _dbContext = dbContext;
        _extractorFactory = extractorFactory;
        _chunkingService = chunkingService;
        _embeddingService = embeddingService;
        _httpClientFactory = httpClientFactory;
        _scopeFactory = scopeFactory;
        _structuredIngest = structuredIngest;
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
        var response = await client.PostAsJsonAsync(
            "/api/v1/ai/extract-entities",
            new { text, confidence_threshold = 0.4 });

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
