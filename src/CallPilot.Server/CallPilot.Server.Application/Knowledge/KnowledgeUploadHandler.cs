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

public class KnowledgeUploadHandler
{
    private readonly CallPilotDbContext _dbContext;
    private readonly TextExtractorFactory _extractorFactory;
    private readonly ChunkingService _chunkingService;
    private readonly EmbeddingService _embeddingService;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<KnowledgeUploadHandler> _logger;

    public KnowledgeUploadHandler(
        CallPilotDbContext dbContext,
        TextExtractorFactory extractorFactory,
        ChunkingService chunkingService,
        EmbeddingService embeddingService,
        IHttpClientFactory httpClientFactory,
        IServiceScopeFactory scopeFactory,
        ILogger<KnowledgeUploadHandler> logger)
    {
        _dbContext = dbContext;
        _extractorFactory = extractorFactory;
        _chunkingService = chunkingService;
        _embeddingService = embeddingService;
        _httpClientFactory = httpClientFactory;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task<KnowledgeDocument> UploadAsync(
        Guid userId,
        string fileName,
        string contentType,
        long fileSize,
        Stream fileStream)
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

        try
        {
            document.SetProcessingStatus("Extracting");
            await _dbContext.SaveChangesAsync();

            fileStream.Position = 0;
            var extractor = _extractorFactory.GetExtractor(contentType);
            if (extractor is null)
            {
                document.SetProcessingStatus($"Unsupported format: {contentType}");
                await _dbContext.SaveChangesAsync();
                return document;
            }

            var text = await extractor.ExtractTextAsync(fileStream);
            if (string.IsNullOrWhiteSpace(text))
            {
                document.SetProcessingStatus("No extractable text found");
                await _dbContext.SaveChangesAsync();
                return document;
            }

            document.SetProcessingStatus("Chunking");
            await _dbContext.SaveChangesAsync();

            var chunks = _chunkingService.ChunkText(text, document.Id);

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
                    chunk.CharLength);

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

            _logger.LogInformation("Document indexed: {FileName}, {ChunkCount} chunks", fileName, chunks.Count);

            // ── Dynamic Entity Extraction (GLiNER, runs async — does not block) ──
            _ = Task.Run(async () =>
            {
                try
                {
                    await ExtractAndStoreEntitiesAsync(document.Id, text);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Entity extraction skipped for {FileName}: {Message}", fileName, ex.Message);
                }
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process document {FileName}", fileName);
            document.SetProcessingStatus($"Error: {ex.Message}");
            await _dbContext.SaveChangesAsync();
        }

        return document;
    }

    public async Task<IReadOnlyList<KnowledgeDocument>> ListDocumentsAsync(Guid userId)
    {
        return await _dbContext.KnowledgeDocuments
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
