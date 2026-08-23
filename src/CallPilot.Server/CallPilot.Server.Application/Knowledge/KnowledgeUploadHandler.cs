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

    /// <summary>
    /// Fire-and-forget sub-tasks spawned by <see cref="ProcessAsync"/>
    /// (entity extraction + enrichment).  Tracked so the background
    /// upload path (<see cref="ProcessStoredAsync"/>) can keep its DI
    /// scope alive until they finish - the sub-tasks resolve services
    /// from their own scopes, but the enrichment client used to stream
    /// results lives on the owning scope.
    /// </summary>
    private readonly List<Task> _backgroundTasks = [];

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
        => UploadAsync(userId, fileName, contentType, fileSize, fileStream, IngestMode.Fast, knowledgeBaseId: null);

    public async Task<KnowledgeDocument> UploadAsync(
        Guid userId,
        string fileName,
        string contentType,
        long fileSize,
        Stream fileStream,
        IngestMode mode,
        Guid? knowledgeBaseId = null)
    {
        var document = new KnowledgeDocument(userId, fileName, contentType, fileSize);
        // Persist the ingest mode so the dashboard can show the right
        // status columns (e.g. "Skipped" in the LLM column for fast-mode
        // docs).  Mode is written before ProcessAsync kicks off the
        // background enrichment so the GET /status endpoint returns it
        // immediately, even mid-pipeline.
        document.SetMode(mode.ToString().ToLowerInvariant());
        if (knowledgeBaseId is Guid kbId)
        {
            document.SetKnowledgeBase(kbId);
        }

        var uploadsDir = Path.Combine(Directory.GetCurrentDirectory(), "uploads");
        Directory.CreateDirectory(uploadsDir);

        var storagePath = Path.Combine(uploadsDir, $"{document.Id}_{fileName}");
        using (var fileWriteStream = new FileStream(storagePath, FileMode.Create))
        {
            await fileStream.CopyToAsync(fileWriteStream);
        }
        document.SetStoragePath(storagePath);

        // Seed the full stage skeleton so the first /status poll already
        // shows every row (rather than growing them as we go).  Each
        // row starts as "pending" and is flipped to "running" / "done"
        // / "failed" / "skipped" by the recorder as the pipeline moves.
        SeedStageSkeleton(document, mode);

        _dbContext.KnowledgeDocuments.Add(document);
        await _dbContext.SaveChangesAsync();

        // Don't block the upload response on the pipeline.  The clients
        // (dashboard + desktop) poll GET /status every ~1.5s, so the
        // stage stepper and enrichment progress bar update live only if
        // the HTTP response returns while the pipeline is still running.
        // Run the pipeline on a dedicated background scope that survives
        // the request (same pattern as the enrichment pass below) and let
        // failures be recorded to the stage log + top-line pill.
        var docId = document.Id;
        _ = Task.Run(async () =>
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var handler = scope.ServiceProvider.GetRequiredService<KnowledgeUploadHandler>();
                await handler.ProcessStoredAsync(docId, mode);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Background ingest failed for document {DocId}", docId);
                try
                {
                    await using var scope = _scopeFactory.CreateAsyncScope();
                    var db = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();
                    var doc = await db.KnowledgeDocuments.FirstOrDefaultAsync(d => d.Id == docId);
                    if (doc is null) return;
                    var msg = ex.Message ?? "unknown failure";
                    if (msg.Length > 180) msg = msg[..180] + "…";
                    doc.SetProcessingStatus($"Failed: {msg}");
                    var rec = new IngestStageRecorder(doc, db, _logger);
                    rec.MarkFailed("extracting", new IngestStageError(
                        Stage: "extracting", Source: "dotnet", HttpStatus: null,
                        Message: ex.Message ?? "", Model: null, At: DateTime.UtcNow));
                    await db.SaveChangesAsync();
                }
                catch (Exception persistEx)
                {
                    _logger.LogWarning(persistEx, "Failed to persist ingest failure for {DocId}", docId);
                }
            }
        });

        return document;
    }

    /// <summary>
    /// Re-runs the full extract → chunk → embed → index pipeline for an
    /// already-persisted document, reading the original file from disk.
    /// Used by the background upload path so the upload response returns
    /// immediately; mirrors <see cref="ReindexAsync"/>'s shape.  Awaits
    /// the background sub-tasks (entity extraction + enrichment) before
    /// returning so the caller's DI scope stays alive until they finish.
    /// </summary>
    public async Task ProcessStoredAsync(Guid documentId, IngestMode mode)
    {
        var document = await _dbContext.KnowledgeDocuments
            .FirstOrDefaultAsync(d => d.Id == documentId);
        if (document is null) return;

        if (string.IsNullOrEmpty(document.StoragePath) || !File.Exists(document.StoragePath))
        {
            document.SetProcessingStatus("Source file missing - re-upload required");
            await _dbContext.SaveChangesAsync();
            return;
        }

        await using var fs = new FileStream(document.StoragePath, FileMode.Open, FileAccess.Read);
        await ProcessAsync(document, fs, mode);

        if (_backgroundTasks.Count > 0)
        {
            try
            {
                await Task.WhenAll(_backgroundTasks);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Background sub-tasks finished with errors for {DocId}", documentId);
            }
        }
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
            document.SetProcessingStatus("Source file missing - re-upload required");
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
        // Wipe any prior stage log so the new run starts clean.
        SeedStageSkeleton(document, mode);
        await _dbContext.SaveChangesAsync();

        using var fs = File.OpenRead(document.StoragePath);
        await ProcessAsync(document, fs, mode);

        return document;
    }

    /// <summary>
    /// Reset the per-stage log on <paramref name="document"/> to a
    /// known-good skeleton.  Called from <see cref="UploadAsync"/> and
    /// <see cref="ReindexAsync"/> so the dashboard's first poll already
    /// has the full pipeline shape, with each stage marked
    /// <c>pending</c>.
    /// </summary>
    private void SeedStageSkeleton(KnowledgeDocument document, IngestMode mode)
    {
        // Stages are appended by RecordStagePending which is a no-op if
        // the key is already present, so this is idempotent for callers
        // that re-enter (e.g. on reindex after a partial crash).
        document.RecordStagePending("uploaded", "Uploaded");
        document.RecordStagePending("extracting", mode == IngestMode.Structured ? "Extracting (Docling)" : "Extracting");
        document.RecordStagePending("chunking", "Chunking");
        document.RecordStagePending("embedding", "Embedding");
        document.RecordStagePending("indexed", "Indexed");
        document.RecordStagePending("entityextraction", "Entity extraction");
        document.RecordStagePending("enriching", "LLM enrichment");
        document.RecordStagePending("productresearch", "Product research");
    }

    /// <summary>
    /// Shared extraction → chunking → embedding pipeline used by both upload and reindex.
    /// </summary>
    private async Task ProcessAsync(KnowledgeDocument document, Stream fileStream, IngestMode mode)
    {
        var rec = new IngestStageRecorder(document, _dbContext, _logger);
        rec.MarkRunning("uploaded", "Uploaded");
        rec.MarkDone("uploaded");

        try
        {
            // Fast mode: keep the current path so existing PDF behavior doesn't
            // change. Structured mode: forward the bytes to the Python AI Engine
            // for layout-aware extraction.
            List<TextChunk> chunks;
            string? rawTextForEntityExtraction;

            rec.MarkRunning("extracting",
                mode == IngestMode.Structured ? "Extracting (Docling)" : "Extracting");
            // P0: track per-document text yield for scanned-PDF warning
            var extractionPageCount = 0;
            var extractionPagesWithText = 0;
            string? extractionWarning = null;
            try
            {
                if (mode == IngestMode.Structured)
                {
                    var structured = await ExtractStructuredAsync(document, fileStream, rec);
                    chunks = structured.Chunks;
                    rawTextForEntityExtraction = structured.RawText;
                    // Docling page count is stashed in RawOutput; use chunk page hints as proxy
                    // for yield warning (chunks already carry PageHint).
                    if (structured.Chunks.Count > 0)
                    {
                        var distinctPages = structured.Chunks.Select(c => c.PageHint).Where(p => p > 0).Distinct().Count();
                        // If Docling extracted far fewer pages than expected, flag it.  We don't
                        // have the original PDF page count here without extra plumbing, so we
                        // defer the detailed ratio check to the enrichment path where
                        // no_text_layer is counted per page.  Structured extraction with OCR
                        // should rarely be low-yield; a warning here would be noisy.
                    }
                }
                else
                {
                    var fast = await ExtractFastAsync(document, fileStream);
                    chunks = fast.Chunks;
                    rawTextForEntityExtraction = fast.RawText;
                    extractionPageCount = fast.PageCount;
                    extractionPagesWithText = fast.PagesWithText;
                    if (extractionPageCount > 0 && extractionPagesWithText > 0)
                    {
                        var emptyPages = extractionPageCount - extractionPagesWithText;
                        var ratio = (double)emptyPages / extractionPageCount;
                        if (ratio >= 0.25 || emptyPages >= 5)
                        {
                            extractionWarning = emptyPages == extractionPageCount
                                ? $"Scanned PDF: all {extractionPageCount} pages had no extractable text"
                                : $"Low text yield: {emptyPages}/{extractionPageCount} pages had no extractable text (likely scanned/image-only)";
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Re-throw to the outer catch which marks the current
                // stage failed with the full message.
                throw;
            }

            if (chunks.Count == 0)
            {
                var detail = extractionWarning ?? "0 chunks produced";
                rec.MarkDone("extracting", detail: detail);
                rec.MarkSkipped("chunking", "No extractable text");
                rec.MarkSkipped("embedding", "No extractable text");
                rec.MarkSkipped("indexed", "No extractable text");
                rec.MarkSkipped("entityextraction", "No extractable text");
                rec.MarkSkipped("enriching", "No extractable text");
                document.SetProcessingStatus(extractionWarning is not null ? extractionWarning : "No extractable text found");
                await _dbContext.SaveChangesAsync();
                return;
            }

            if (extractionWarning is not null)
            {
                rec.MarkDone("extracting", detail: extractionWarning);
                _logger.LogWarning("extraction low yield for {FileName}: {Warning}", document.FileName, extractionWarning);
            }
            else
            {
                rec.MarkDone("extracting");
            }
            rec.MarkRunning("chunking");
            rec.MarkDone("chunking", detail: $"{chunks.Count} chunks");

            rec.MarkRunning("embedding", $"Embedding {chunks.Count} chunks");
            await EmbedChunksAsync(document, chunks);
            rec.MarkDone("embedding", detail: $"{chunks.Count} chunks embedded");

            rec.MarkRunning("indexed");
            rec.MarkDone("indexed");
            document.SetProcessingStatus("Indexed");
            await _dbContext.SaveChangesAsync();

            _logger.LogInformation(
                "Document indexed: {FileName}, {ChunkCount} chunks, mode={Mode}",
                document.FileName, chunks.Count, mode);

            // ── Async post-Indexed background pass (sequential) ──────────────
            // GLiNER entity extraction → (structured) LLM enrichment → product
            // identification + research. Run as ONE chained task: every stage
            // rewrites the shared jsonb stage log (StagesJson), and the
            // concurrent writers would last-write-wins-clobber each other's
            // final state. Sequencing guarantees the stage log settles with
            // every step done/skipped. None of this blocks the upload response.
            var docId = document.Id;
            var postText = rawTextForEntityExtraction;
            var hasKnowledgeBase = document.KnowledgeBaseId is not null;
            _backgroundTasks.Add(Task.Run(async () =>
            {
                if (postText is not null)
                {
                    try { await ExtractAndStoreEntitiesAsync(docId, postText); }
                    catch (Exception ex) { _logger.LogWarning(ex, "Entity extraction skipped for {DocId}: {Message}", docId, ex.Message); }
                }
                if (mode == IngestMode.Structured)
                {
                    try { await RunBackgroundEnrichmentAsync(docId); }
                    catch (Exception ex) { _logger.LogWarning(ex, "Background enrichment failed for {DocId}", docId); }
                }
                if (postText is not null && hasKnowledgeBase)
                {
                    try { await RunProductIdentificationAsync(docId, postText); }
                    catch (Exception ex) { _logger.LogWarning(ex, "Product identification skipped for {DocId}: {Message}", docId, ex.Message); }
                }
            }));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process document {FileName}", document.FileName);
            // The detailed error is in the Stages log (jsonb) - the
            // top-line pill is short and red so the document list
            // doesn't overflow.
            var src = "dotnet";
            int? status = null;
            var msg = ex.Message ?? "unknown failure";
            // Trim a bit so a 500-char exception doesn't bloat the
            // varchar(200) ProcessingStatus.  The full message is
            // already in the stages log.
            const int maxLen = 180;
            if (msg.Length > maxLen) msg = msg[..maxLen] + "…";
            document.SetProcessingStatus($"Failed: {msg}");
            // Mark whichever stage we were on as failed.
            var currentStage = rec.CurrentStageKey ?? "extracting";
            rec.MarkFailed(currentStage, new IngestStageError(
                Stage: currentStage, Source: src, HttpStatus: status,
                Message: (ex.Message ?? ""), Model: null, At: DateTime.UtcNow));
            try
            {
                await _dbContext.SaveChangesAsync();
            }
            catch (Exception saveEx)
            {
                _logger.LogWarning(saveEx, "Failed to persist error status for {FileName}", document.FileName);
            }
        }
    }

    /// <summary>
    /// Identifies the products a company sells from an indexed document and
    /// enqueues company-scoped web research for each. Runs on a dedicated
    /// scope so the background path's DI lifetime is respected; never throws
    /// into the ingest pipeline. Only runs for documents that belong to a
    /// company knowledge base (that's what scopes the product intelligence).
    /// </summary>
    /// <summary>
    /// Classifies the document's persisted product rows and enqueues
    /// background research for the confident ones.
    ///
    /// The engine's /internal/product-identify endpoint was removed: entity
    /// classification is now part of the merged LLM enrichment pass, and the
    /// enrichment handler already persists the LLM-confirmed products as
    /// DocumentEntity(EntityType='product', Category=PRODUCT, conf 0.95).
    /// This stage applies the same confidence thresholds locally against
    /// those rows (≥0.7 auto-enrich, 0.4-0.69 Pending, &lt;0.4 demoted) and
    /// enqueues research through EnsureScopedAsync - no engine round-trip.
    /// </summary>
    private async Task RunProductIdentificationAsync(Guid docId, string rawText)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CallPilotDbContext>();
        var productIntelService = scope.ServiceProvider.GetRequiredService<CallPilot.Server.Infrastructure.Products.ProductIntelService>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<KnowledgeUploadHandler>>();

        var document = await db.KnowledgeDocuments.FirstOrDefaultAsync(d => d.Id == docId);
        if (document is null || document.KnowledgeBaseId is null) return;

        var kb = await db.KnowledgeBases.FirstOrDefaultAsync(k => k.Id == document.KnowledgeBaseId);
        if (kb is null) return;

        var rec = new IngestStageRecorder(document, db, logger);
        rec.MarkRunning("productresearch", "Identifying products");
        await db.SaveChangesAsync();

        try
        {
            // Product rows already persisted by the enrichment handler
            // (LLM-confirmed) + any legacy pre-classification rows.
            var rows = await db.DocumentEntities
                .Where(e => e.DocumentId == docId && e.EntityType == "product"
                    && (e.EntityCategory == null || e.EntityCategory == "PRODUCT"))
                .ToListAsync();

            const double autoEnrichConfidence = 0.7;
            const double productConfidenceFloor = 0.4;

            int productCount = 0;
            int enrichedCount = 0;
            foreach (var row in rows)
            {
                var canonical = CallPilot.Server.Infrastructure.Products.ProductIntelService.NormalizeName(row.EntityText);
                if (string.IsNullOrWhiteSpace(canonical)) continue;

                var confidence = Math.Clamp(row.Confidence, 0, 1);
                if (confidence >= autoEnrichConfidence)
                {
                    // Confident product - mark Pending + enqueue research.
                    row.SetEnrichmentStatus("Pending");
                    await db.SaveChangesAsync();
                    var dto = await productIntelService.EnsureScopedAsync(
                        kb.Id, kb.CompanyName, canonical, null, docId, autoEnrich: true);
                    if (dto.EnrichmentStatus == "Completed") enrichedCount++;
                    productCount++;
                }
                else if (confidence >= productConfidenceFloor)
                {
                    // Possible product - Pending, no auto-enrich.
                    row.SetEnrichmentStatus("Pending");
                    await db.SaveChangesAsync();
                    productCount++;
                }
                else
                {
                    // Low confidence - demote so it never shows as a product.
                    row.SetEntityType("concept");
                    row.SetEntityCategory(DocumentEntity.Category.Other);
                    row.SetEnrichmentStatus(null);
                    await db.SaveChangesAsync();
                }
            }

            rec.MarkDone("productresearch", detail: $"{productCount} product(s) identified, {enrichedCount} already enriched");
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Product identification failed for document {DocId}", docId);
            rec.MarkFailed("productresearch", new IngestStageError(
                Stage: "productresearch", Source: "dotnet", HttpStatus: null,
                Message: ex.Message ?? "", Model: null, At: DateTime.UtcNow));
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Persist the <see cref="TextChunk"/> rows + their embeddings.
    /// Touches the document's <c>UpdatedAt</c> every <c>HEARTBEAT_EVERY</c>
    /// chunks so the dashboard can tell "stuck" from "still running".
    /// </summary>
    private async Task EmbedChunksAsync(KnowledgeDocument document, List<TextChunk> chunks)
    {
        const int HEARTBEAT_EVERY = 10;
        for (int i = 0; i < chunks.Count; i++)
        {
            var chunk = chunks[i];
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

            if (i % HEARTBEAT_EVERY == 0)
            {
                // Heartbeat so a long embedding loop doesn't read as
                // "stuck" in the dashboard.
                document.Touch();
                await _dbContext.SaveChangesAsync();
            }
        }
        await _dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Fast extraction: Docnet.Core + paragraph-aware chunker, both in-process.
    /// </summary>
    private async Task<(List<TextChunk> Chunks, string? RawText, int PageCount, int PagesWithText)> ExtractFastAsync(
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
            return ([], null, 0, 0);
        }

        var text = await extractor.ExtractTextAsync(fileStream);
        // P0: capture per-page yield for scanned-PDF warning (PdfTextExtractor
        // exposes LastPageCount/LastPagesWithText populated by ExtractTextAsync).
        var pageCount = 0;
        var pagesWithText = 0;
        if (extractor is CallPilot.Server.Infrastructure.Knowledge.PdfTextExtractor pdfEx)
        {
            pageCount = pdfEx.LastPageCount;
            pagesWithText = pdfEx.LastPagesWithText;
        }

        if (string.IsNullOrWhiteSpace(text))
        {
            return ([], null, pageCount, pagesWithText);
        }
        text = SanitizeText(text);

        document.SetProcessingStatus("Chunking");
        await _dbContext.SaveChangesAsync();

        return (_chunkingService.ChunkText(text, document.Id), text, pageCount, pagesWithText);
    }

    /// <summary>
    /// Structured extraction: forward the PDF to the Python AI Engine. Returns
    /// pre-chunked TextChunk records with section_heading, chunk_type, and page
    /// numbers populated. Also builds a GLiNER-friendly text blob by prepending
    /// structured context ([chunk_type] section_heading) to each chunk so entity
    /// extraction can run with higher confidence than flat fast-mode text.
    /// </summary>
    private async Task<(List<TextChunk> Chunks, string? RawText)> ExtractStructuredAsync(
        KnowledgeDocument document, Stream fileStream, IngestStageRecorder rec)
    {
        document.SetProcessingStatus("Extracting (structured)");
        await _dbContext.SaveChangesAsync();

        if (fileStream.CanSeek) fileStream.Position = 0;
        using var ms = new MemoryStream();
        await fileStream.CopyToAsync(ms);
        var bytes = ms.ToArray();

        var result = await _structuredIngest.IngestAsync(document.Id, document.FileName, bytes);
        if (result is null || result.Chunks is null || result.Chunks.Count == 0)
            return ([], null);

        // Stash the Docling metadata block for the dashboard's "View raw" tab.
        if (result.Docling is not null)
        {
            document.SetRawOutput("docling", new
            {
                page_count = result.Docling.PageCount,
                convert_ms = result.Docling.ConvertMs,
                chunk_ms = result.Docling.ChunkMs,
                model_load_ms = result.Docling.ModelLoadMs,
                warnings = result.Docling.Warnings,
            });
            await _dbContext.SaveChangesAsync();
            if (result.Docling.ModelLoadMs is int loadMs)
            {
                rec.UpdateDetail("extracting", $"Docling model load: {loadMs / 1000}s, {result.Docling.PageCount} pages");
            }
        }

        var sb = new System.Text.StringBuilder();
        foreach (var chunk in result.Chunks)
        {
            sb.Append('[').Append(chunk.ChunkType).Append("] ");
            if (!string.IsNullOrWhiteSpace(chunk.SectionHeading))
                sb.Append(chunk.SectionHeading).Append('\n');
            sb.Append(chunk.Text).Append("\n\n");
        }

        return (result.Chunks, sb.ToString().Trim());
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
        var rec = new IngestStageRecorder(await db.KnowledgeDocuments.FirstAsync(d => d.Id == documentId), db, _logger);

        // GLiNER was removed from the AI engine: the merged LLM enrichment
        // pass (/api/v1/documents/enrich) is the single entity authority and
        // its products/entities are persisted by the enrichment handler. The
        // old /api/v1/ai/extract-entities endpoint 404s, and a crashed
        // failure path left the entityextraction stage "running" forever,
        // which blocked the chained productresearch stage. This stage now
        // just settles the stage log and re-syncs the trie from whatever
        // entities exist in the DB.
        var entityCount = await db.DocumentEntities.CountAsync(e => e.DocumentId == documentId);
        rec.MarkDone("entityextraction",
            detail: entityCount > 0
                ? $"{entityCount} entities (LLM enrichment)"
                : "0 entities (LLM enrichment is the entity authority)");

        var client = factory.CreateClient("AiEngine");
        await RebuildTrieAsync(client, db, rec);
    }

    /// <summary>
    /// Background enrichment pass - fires after the upload response is already
    /// returned to the client.  Streams per-page results from the AI
    /// Engine's <c>/api/v1/documents/enrich</c> endpoint, writing each
    /// page's outcome to <c>EnrichmentProgressJson</c> as it arrives so
    /// the dashboard polls (every ~1.5s) reflect progress in real time.
    /// Replaces the original Docling chunks for any page that yielded
    /// product cards, re-embeds the new chunks, and updates
    /// <c>EnrichmentStatus</c>.
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
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<KnowledgeUploadHandler>>();

        var document = await db.KnowledgeDocuments
            .Include(d => d.Chunks)
            .FirstOrDefaultAsync(d => d.Id == documentId);
        if (document is null)
        {
            logger.LogWarning("enrich: document {DocId} not found, skipping", documentId);
            return;
        }

        // BYOK: resolve THIS user's configured provider+model for knowledge
        // processing.  When the user has NOT configured their own provider yet,
        // we do NOT silently fall back to a server-wide key (the user should be
        // prompted to connect one) - the document is marked provider_required and
        // the UI shows a "connect a provider" prompt.  The provider block is sent
        // to the engine per-request and never persisted beyond this scope.
        var providerSvc = scope.ServiceProvider.GetRequiredService<CallPilot.Server.Infrastructure.AI.ProviderSvc>();
        var resolvedProvider = (await providerSvc.ResolveFeatureAsync(
            document.UserId, CallPilot.Server.Infrastructure.AI.AiFeatures.KnowledgeProcessing));
        if (resolvedProvider is null)
        {
            logger.LogInformation(
                "enrich: document {DocId} has no user AI provider configured, marking provider_required",
                documentId);
            var preRec = new IngestStageRecorder(document, db, logger);
            preRec.MarkRunning("enriching");
            document.SetEnrichmentStatus("provider_required");
            preRec.MarkFailed("enriching", new IngestStageError(
                Stage: "enriching", Source: "dotnet", HttpStatus: null,
                Message: "No AI provider connected. Open Settings > AI & Keys and connect Groq, OpenAI, or Anthropic to enable product extraction.",
                Model: null, At: DateTime.UtcNow));
            await db.SaveChangesAsync();
            return;
        }
        logger.LogInformation(
            "enrich: document {DocId} resolved provider {Provider} model {Model}",
            documentId, resolvedProvider.ProviderType, resolvedProvider.Model);

        var rec = new IngestStageRecorder(document, db, logger);
        rec.MarkRunning("enriching");

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
            logger.LogInformation(
                "enrich: document {DocId} has no page-tagged chunks, skipping",
                documentId);
            document.SetEnrichmentStatus("enrichment_failed");
            rec.MarkSkipped("enriching", "No page-tagged chunks");
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

        var total = pageInputs.Count;
        // Pre-initialize the per-page progress column with all pages
        // "pending" so the dashboard's first poll already shows the
        // total + a list of not-yet-attempted pages.  This is the
        // "we know what we're about to do" snapshot; the in-flight
        // counts start populating as the stream emits page results.
        var pageProgress = pageInputs
            .Select(p => new EnrichmentPageStatus(
                Page: p.Page, Status: "pending",
                Model: null, DurationMs: 0, Error: null,
                FinishedAt: null))
            .ToList();
        document.SetEnrichmentProgress(new EnrichmentProgress(
            Total: total, Completed: 0, Failed: 0,
            InFlight: total, Pages: pageProgress));
        rec.UpdateDetail("enriching", $"{total} page(s) queued");
        await db.SaveChangesAsync();

        // The stream of EnrichPageResult / EnrichSummary events.  We
        // mutate the local `pageProgress` list as each page arrives
        // and write the whole list back to the jsonb column so the
        // dashboard can render it.  This is one DB write per page,
        // ~1.5s polling latency - perfectly acceptable.
        var collectedResults = new List<EnrichmentClient.EnrichPageResult>();
        EnrichmentClient.EnrichSummary? summary = null;
        int completed = 0, failed = 0, inFlight = total;
        EnrichmentPageStatus? firstFailed = null;
        Exception? streamException = null;
        try
        {
            await foreach (var evt in _enrichmentClient.EnrichStreamingAsync(documentId, pageInputs, provider: resolvedProvider))
            {
                if (evt is EnrichmentClient.EnrichPageResult page)
                {
                    collectedResults.Add(page);
                    var status = page.Outcome?.Status ?? "unknown";
                    var ps = new EnrichmentPageStatus(
                        Page: page.Page,
                        Status: status,
                        Model: page.Outcome?.Model,
                        DurationMs: page.Outcome?.DurationMs ?? 0,
                        Error: page.Outcome?.Error,
                        FinishedAt: DateTime.UtcNow,
                        RetryCount: page.Outcome?.RetryCount ?? 0,
                        SkipReason: page.Outcome?.SkipReason);

                    // Update the per-page slot.
                    var idx = pageProgress.FindIndex(p => p.Page == page.Page);
                    if (idx >= 0) pageProgress[idx] = ps;
                    else pageProgress.Add(ps);

                    // If a page needed retries, surface that in the
                    // enriching stage detail so the user sees the
                    // backoff in real time on the stepper row.
                    var retries = page.Outcome?.RetryCount ?? 0;
                    if (retries > 0)
                    {
                        rec.UpdateDetail("enriching",
                            $"{completed}/{total} pages enriched, {failed} failed, {retries} retry on page {page.Page}");
                    }

                    if (status == "ok" || status == "no_products")
                        completed++;
                    else
                    {
                        failed++;
                        firstFailed ??= ps;
                    }
                    inFlight = Math.Max(0, inFlight - 1);

                    // Local usage tracking: record what CallPilot consumed through
                    // the user key for this page (success/failure + tokens when
                    // the provider reported them).  Best-effort - never blocks the
                    // page loop, never includes document content.
                    if (resolvedProvider is not null)
                    {
                        try
                        {
                            var usage = page.Outcome?.Usage;
                            var estimated = CallPilot.Server.Infrastructure.AI.CostEstimator.EstimateUsd(
                                resolvedProvider.ProviderType, resolvedProvider.Model,
                                usage?.InputTokens, usage?.OutputTokens);
                            await providerSvc.RecordUsageAsync(document.UserId,
                                new CallPilot.Server.Infrastructure.AI.RecordUsageRequest(
                                    ProviderConfigurationId: resolvedProvider.ProviderConfigurationId,
                                    ProviderType: resolvedProvider.ProviderType,
                                    Model: resolvedProvider.Model,
                                    Feature: CallPilot.Server.Infrastructure.AI.AiFeatures.KnowledgeProcessing,
                                    InputTokens: usage?.InputTokens,
                                    OutputTokens: usage?.OutputTokens,
                                    TotalTokens: usage?.TotalTokens,
                                    Success: status == "ok" || status == "no_products",
                                    DurationMs: page.Outcome?.DurationMs ?? 0,
                                    EstimatedCostUsd: estimated,
                                    ErrorCode: page.Outcome is null ? null : (status == "ok" ? "ok" : status),
                                    DocumentId: documentId,
                                    PageNumber: page.Page));
                        }
                        catch (Exception usageEx)
                        {
                            logger.LogWarning(usageEx, "enrich: usage recording failed for {DocId} page {Page}", documentId, page.Page);
                        }
                    }                    // Write the live progress + update the stage detail
                    // so the dashboard's next poll (≤1.5s away) sees it.
                    document.SetEnrichmentProgress(new EnrichmentProgress(
                        Total: total, Completed: completed, Failed: failed,
                        InFlight: inFlight,
                        Pages: pageProgress.ToList()));
                    rec.UpdateDetail("enriching",
                        $"{completed}/{total} pages enriched, {failed} failed");
                    await db.SaveChangesAsync();
                }
                else if (evt is EnrichmentClient.EnrichSummary s)
                {
                    summary = s;
                }
            }
        }
        catch (Exception ex)
        {
            streamException = ex;
            logger.LogWarning(ex, "enrich: streaming call failed for {DocId}", documentId);
        }

        if (streamException is not null || (collectedResults.Count == 0 && summary is null))
        {
            document.SetEnrichmentStatus("enrichment_failed");
            rec.MarkFailed("enriching", new IngestStageError(
                Stage: "enriching", Source: "ai-engine", HttpStatus: null,
                Message: streamException?.Message ?? "AI Engine /enrich returned no results (network/timeout/HTTP error)",
                Model: null, At: DateTime.UtcNow));
            await db.SaveChangesAsync();
            return;
        }

        // Stash the raw LLM response for the dashboard's "View raw" tab.
        document.SetRawOutput("enrichment", new
        {
            document_id = documentId.ToString(),
            page_count = total,
            enrichment_ms = summary?.EnrichmentMs ?? 0,
            products_total = summary?.ProductsTotal ?? collectedResults.Sum(p => p.Products.Count),
            failure_count = summary?.FailureCount ?? failed,
            model = pageProgress.FirstOrDefault(p => p.Model is not null)?.Model,
            pages = collectedResults.Select(p => new
            {
                page = p.Page,
                page_type = p.PageType,
                products = p.Products.Select(prod => new
                {
                    name = prod.Name, category = prod.Category, headline = prod.Headline,
                    key_features = prod.KeyFeatures, pricing = prod.Pricing,
                    best_for = prod.BestFor, differentiators = prod.Differentiators,
                    raw_claims = prod.RawClaims, chunk_text = prod.ChunkText,
                }),
                outcome = p.Outcome is null ? null : new
                {
                    status = p.Outcome.Status,
                    model = p.Outcome.Model,
                    duration_ms = p.Outcome.DurationMs,
                    error = p.Outcome.Error,
                    retry_count = p.Outcome.RetryCount,
                    skip_reason = p.Outcome.SkipReason,
                    duplicate_of = p.Outcome.DuplicateOf,
                },
            }),
        });

        // P0: Surface low text yield warning when many pages had no extractable text.
        var noTextLayerCount = pageProgress.Count(p =>
            string.Equals(p.SkipReason, "no_text_layer", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(p.SkipReason, "empty", StringComparison.OrdinalIgnoreCase));
        if (noTextLayerCount > 0)
        {
            var ratio = (double)noTextLayerCount / total;
            if (ratio >= 0.25 || noTextLayerCount >= 5)
            {
                var detail = noTextLayerCount == total
                    ? $"Scanned PDF: all {total} pages had no extractable text — likely image-only, try structured mode with OCR"
                    : $"Low text yield: {noTextLayerCount}/{total} pages had no extractable text (likely scanned/image-only)";
                rec.UpdateDetail("enriching", detail);
                logger.LogWarning("enrich: low text yield for {DocId}: {Detail}", documentId, detail);
                await db.SaveChangesAsync();
            }
        }

        // Apply per-page replacements: for each page that returned product
        // cards, delete the original Docling chunks and insert one product
        // card chunk per product.  Pages with no products keep their
        // original chunks untouched.
        var newChunksAdded = 0;
        var chunksDeleted = 0;
        var allNewProductNames = new List<string>();

        // Apply per-page replacements: for each page that returned
        // product cards, delete the original Docling chunks and
        // insert one product card chunk per product.  Pages with
        // no products keep their original chunks untouched.
        //
        // We use a single SaveChanges per phase (deletes, then
        // inserts) rather than interleaving, because PostgreSQL
        // checks unique constraints per-row - an INSERT for an
        // index that's still in a queued DELETE can collide.
        var existingByPage = (await db.KnowledgeChunks
            .Where(c => c.DocumentId == documentId && c.PageHint > 0)
            .ToListAsync())
            .GroupBy(c => c.PageHint)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Phase 1: deletes for pages that yielded products.
        var pageResultsWithProducts = collectedResults
            .Where(p => p.Products.Count > 0)
            .ToList();
        var chunksToDelete = pageResultsWithProducts
            .Where(p => existingByPage.ContainsKey(p.Page))
            .SelectMany(p => existingByPage[p.Page])
            .ToList();
        if (chunksToDelete.Count > 0)
        {
            // Cascade-delete the embeddings first.  No cascade at the
            // DB level (Embeddings.ChunkId is a plain FK), so we
            // have to do it manually.
            var deleteIds = chunksToDelete.Select(c => c.Id).ToList();
            var orphanEmbeddings = await db.Embeddings
                .Where(e => deleteIds.Contains(e.ChunkId))
                .ToListAsync();
            db.Embeddings.RemoveRange(orphanEmbeddings);
            db.KnowledgeChunks.RemoveRange(chunksToDelete);
            chunksDeleted = chunksToDelete.Count;
            await db.SaveChangesAsync();
        }

        // Phase 2: inserts.  Compute baseIndex from the live DB
        // (just flushed) so the unique constraint can't be violated
        // by a still-pending change.  Add a 10,000-point offset so
        // the new product cards never share an index with the
        // no-product-page Docling chunks that survived the deletes.
        var postDeleteMax = await db.KnowledgeChunks
            .Where(c => c.DocumentId == documentId)
            .Select(c => (int?)c.ChunkIndex)
            .MaxAsync();
        const int INDEX_OFFSET = 10_000;
        var baseIndex = (postDeleteMax ?? -1) + 1 + INDEX_OFFSET;

        foreach (var pageResult in pageResultsWithProducts)
        {
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
                    metadataJson: SerializeProductMetadata(product, pageResult.PageType),
                    source: "enriched");
                db.KnowledgeChunks.Add(newChunk);
                newChunksAdded++;
                allNewProductNames.Add(product.Name);
            }
        }
        await db.SaveChangesAsync();
        logger.LogInformation(
            "enrich: document {DocId} - added {Added} product card chunks, removed {Removed} Docling chunks",
            documentId, newChunksAdded, chunksDeleted);

        // Now embed + persist the embedding rows for each new chunk.
        // UpdatedAt is the timestamp we set right before the inserts, so
        // any product_card created after that is one of ours.
        var updatedAt = document.UpdatedAt ?? DateTime.UtcNow;
        var newChunks = await db.KnowledgeChunks
            .Where(c => c.DocumentId == documentId && c.ChunkType == "product_card"
                && c.CreatedAt > updatedAt.AddSeconds(-1))
            .ToListAsync();
        foreach (var chunk in newChunks)
        {
            var embedding = await embeddingService.GenerateEmbeddingAsync(chunk.Text)
                ?? embeddingService.GenerateLocalEmbedding(chunk.Text);
            db.Embeddings.Add(new Embedding(chunk.Id, embedding, "all-MiniLM-L6-v2"));
        }
        await db.SaveChangesAsync();

        // Register each LLM-confirmed product name as a DocumentEntity row
        // so the live-call trie picks up brand products even when the
        // post-enrichment GLiNER pass below misses them.  GLiNER's recall
        // on brand-product spans (e.g. "Prodigy", "Apex 100") is a known
        // cliff, but the LLM enrichment prompt *names* the product as part
        // of each `EnrichedProductDto` - treat that as authoritative for
        // entity-extraction purposes.  Idempotent: we check existing rows
        // for the same document + entity_type and only insert names that
        // are missing.  Confidence 0.95 outweighs GLiNER's 0.3 floor, so a
        // brand product is never demoted by a low-confidence GLiNER hit
        // when both paths find it.
        if (allNewProductNames.Count > 0)
        {
            var normalizedNames = allNewProductNames
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Select(n => n.Trim().ToLowerInvariant())
                .Distinct()
                .ToList();

            var existingNames = await db.DocumentEntities
                .Where(e => e.DocumentId == documentId
                            && e.EntityType == "product"
                            && normalizedNames.Contains(e.EntityText))
                .Select(e => e.EntityText)
                .ToListAsync();

            var existingSet = existingNames.ToHashSet();
            var missingNames = normalizedNames
                .Where(n => !existingSet.Contains(n))
                .ToList();

            if (missingNames.Count > 0)
            {
                foreach (var name in missingNames)
                {
                    db.DocumentEntities.Add(new DocumentEntity(
                        documentId, null, name, "product", 0.95, DocumentEntity.Category.Product));
                }
                await db.SaveChangesAsync();
                logger.LogInformation(
                    "enrich: registered {Count} LLM-confirmed product entities for {DocId} ({Sample})",
                    missingNames.Count, documentId,
                    string.Join(", ", missingNames.Take(5)));
            }
        }

        // Re-run GLiNER on the new product card chunks so the live trie picks
        // up the brand product names.  This intentionally re-extracts over
        // the full document text - most product names appear in the cards
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
            // The post-enrichment GLiNER pass is best-effort: the
            // document already has its product cards and entities
            // from the main pipeline.  Don't let a re-extract
            // failure mask a successful enrichment.
            logger.LogWarning(ex, "enrich: post-enrichment GLiNER pass failed for {DocId}", documentId);
            try
            {
                var entityRec = new IngestStageRecorder(document, db, logger);
                entityRec.MarkFailed("entityextraction", new IngestStageError(
                    Stage: "entityextraction", Source: "gliner", HttpStatus: null,
                    Message: $"post-enrichment GLiNER re-extract failed: {Truncate(ex.Message, 500)}",
                    Model: null, At: DateTime.UtcNow));
            }
            catch (Exception innerEx)
            {
                logger.LogWarning(innerEx, "enrich: failed to mark entityextraction as failed");
            }
        }

        // Record which provider+model actually processed this document so a
        // later switch of the user default never retroactively relabels it.
        if (resolvedProvider is not null)
        {
            var usedModel = pageProgress.FirstOrDefault(p => p.Model is not null)?.Model
                ?? resolvedProvider.Model;
            document.SetEnrichmentProvider(resolvedProvider.ProviderType, usedModel);
        }

        // Final stage transition.  If even one page had a real failure
        // (status not in {ok, no_products}) we mark the stage failed so
        // the dashboard renders a red row + surfaces the error body.
        if (failed > 0 && firstFailed is not null)
        {
            rec.MarkFailed("enriching", new IngestStageError(
                Stage: "enriching", Source: "groq",
                HttpStatus: firstFailed.Status switch
                {
                    "http_4xx" => 400, "http_5xx" => 500, _ => null,
                },
                Message: firstFailed.Error ?? "one or more pages failed",
                Model: firstFailed.Model, At: DateTime.UtcNow));
            document.SetEnrichmentStatus("enrichment_failed");
        }
        else
        {
            rec.MarkDone("enriching",
                detail: $"{total} pages, {summary?.ProductsTotal ?? completed} products, {failed} failed");
            document.SetEnrichmentStatus("enriched");
        }
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

    private static async Task RebuildTrieAsync(HttpClient client, CallPilotDbContext db, IngestStageRecorder rec)
    {
        try
        {
            var entities = await db.DocumentEntities
                .Select(e => new { entity_text = e.EntityText, entity_type = e.EntityType, document_id = e.DocumentId.ToString() })
                .ToListAsync();
            var response = await client.PostAsJsonAsync("/api/v1/ai/trie/rebuild", new { entities });
            if (!response.IsSuccessStatusCode)
            {
                rec.UpdateDetail("entityextraction",
                    $"trie rebuild failed: {response.StatusCode}");
                var logger = rec.GetType()
                    .GetField("_logger", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)?
                    .GetValue(rec) as ILogger;
                logger?.LogWarning("trie rebuild returned {Status} for {Count} entities",
                    response.StatusCode, entities.Count);
            }
        }
        catch (Exception ex)
        {
            // Trie rebuild is best-effort - log and surface the failure
            // in the entityextraction stage row but don't fail the ingest.
            rec.UpdateDetail("entityextraction", $"trie rebuild error: {ex.Message}");
            var logger = rec.GetType()
                .GetField("_logger", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)?
                .GetValue(rec) as ILogger;
            logger?.LogWarning(ex, "trie rebuild failed");
        }
    }

    /// Safe truncation for error messages persisted to the stage log.
    private static string Truncate(string text, int max)
        => string.IsNullOrEmpty(text) ? text : text.Length <= max ? text : text[..max];

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

    /// <summary>
    /// Thin wrapper around <see cref="KnowledgeDocument"/>'s stage
    /// mutators that handles SaveChanges + tracks the most recent
    /// transition for error reporting.  Lives here as a nested type
    /// because it has no callers outside this handler.
    /// </summary>
    private sealed class IngestStageRecorder
    {
        private readonly KnowledgeDocument _doc;
        private readonly CallPilotDbContext _db;
        private readonly ILogger _logger;

        public IngestStageRecorder(KnowledgeDocument doc, CallPilotDbContext db, ILogger logger)
        {
            _doc = doc;
            _db = db;
            _logger = logger;
        }

        public string? CurrentStageKey { get; private set; }

        public void MarkRunning(string key, string? label = null, string? detail = null)
        {
            _doc.RecordStageRunning(key, label ?? key, detail);
            CurrentStageKey = key;
            _db.SaveChanges();
        }

        public void MarkDone(string key, string? detail = null)
        {
            _doc.RecordStageDone(key, detail);
            _db.SaveChanges();
        }

        public void MarkFailed(string key, IngestStageError err)
        {
            _doc.RecordStageFailed(key, err);
            _logger.LogWarning(
                "ingest stage failed: doc={DocId} stage={Key} source={Source} status={Http} msg={Msg}",
                _doc.Id, key, err.Source, err.HttpStatus, err.Message);
            _db.SaveChanges();
        }

        public void MarkSkipped(string key, string reason)
        {
            _doc.RecordStageSkipped(key, reason);
            _db.SaveChanges();
        }

        public void UpdateDetail(string key, string detail)
        {
            // UpdateDetail doesn't transition the stage - just adds a note
            // to the current entry.  Used for the Docling model-load
            // timing and the trie-rebuild error note.
            _doc.SetStageDetail(key, detail);
            _db.SaveChanges();
        }
    }
}
