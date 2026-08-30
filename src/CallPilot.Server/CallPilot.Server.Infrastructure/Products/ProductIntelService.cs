using System.Net.Http.Json;
using System.Text.RegularExpressions;
using CallPilot.Server.Domain.Products;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Products;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Products;

/// <summary>
/// The Product Intelligence read + enrichment service.
///
/// Read path: resolves a product mention to its canonical
/// <see cref="ProductIntelligence"/> row, creating the row and enqueuing
/// background research when the product has never been enriched. Cached
/// profiles (Completed) are returned without touching Tavily/LLM.
///
/// Write path: the background worker calls <see cref="ResearchAndPersistAsync"/>
/// which asks the AI engine for a researched profile (Tavily discovery + LLM
/// structured extraction), persists it with its sources, and links matching
/// meeting mentions back to the canonical product.
///
/// Everything is fail-open: a failed/partial research marks the row Failed or
/// NeedsReview and never throws into the transcript/detection pipeline.
/// </summary>
public class ProductIntelService
{
    private static readonly TimeSpan ReenrichCooldown = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan StaleEnrichingWindow = TimeSpan.FromMinutes(10);

    private readonly CallPilotDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ProductIntelQueue _queue;
    private readonly ILogger<ProductIntelService> _logger;
    private readonly CallPilot.Server.Infrastructure.AI.ProviderSvc _providerSvc;

    public ProductIntelService(
        CallPilotDbContext db,
        IHttpClientFactory httpClientFactory,
        ProductIntelQueue queue,
        ILogger<ProductIntelService> logger,
        CallPilot.Server.Infrastructure.AI.ProviderSvc providerSvc)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _queue = queue;
        _logger = logger;
        _providerSvc = providerSvc;
    }

    /// <summary>Resolve a user configured provider+model for product research.</summary>
    private async Task<CallPilot.Server.Infrastructure.AI.ResolvedProvider?> ResolveUserProviderAsync(Guid userId)
        => await _providerSvc.ResolveFeatureAsync(userId, CallPilot.Server.Infrastructure.AI.AiFeatures.KnowledgeProcessing);

    /// <summary>Lowercase, trimmed, whitespace-collapsed canonical identity.</summary>
    public static string NormalizeName(string name)
    {
        return Regex.Replace((name ?? "").Trim().ToLowerInvariant(), @"\s+", " ");
    }

    public async Task<ProductIntelligence?> FindByCanonicalAsync(string canonicalName)
    {
        return await _db.ProductIntelligences
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.CanonicalName == canonicalName);
    }

    /// <summary>Scoped lookup: resolve a product to the row that belongs to
    /// this user's knowledge base company (or a legacy/global row). Company
    /// identity comes from the user's KnowledgeBase, so two companies'
    /// identically-named products never collide. Company-scoped rows are
    /// preferred over legacy/global ones so the live call reads the user's
    /// own prepared intelligence rather than a stale global profile.</summary>
    private IQueryable<ProductIntelligence> ScopedQuery(Guid userId)
    {
        var userKbIds = _db.KnowledgeBases
            .Where(k => k.UserId == userId)
            .Select(k => k.Id);
        // Prefer the user's company-scoped row, then any legacy/global row.
        return _db.ProductIntelligences
            .Where(p => (p.KnowledgeBaseId != null && userKbIds.Contains(p.KnowledgeBaseId.Value))
                        || p.KnowledgeBaseId == null)
            .OrderByDescending(p => p.KnowledgeBaseId != null);
    }

    /// <summary>
    /// GET-path entry point: READ-ONLY. Returns the existing company-scoped
    /// profile, or a synthetic Pending placeholder when the product has never
    /// been researched. NEVER creates rows, NEVER enqueues research - opening
    /// a product must not have side effects. Enrichment is only started by the
    /// background ingest pipeline or an explicit Reprocess/Retry/Start action.
    /// </summary>
    public async Task<ProductIntelligenceDto> GetAsync(string name, Guid userId)
    {
        var canonical = NormalizeName(name);
        var row = await ScopedQuery(userId).FirstOrDefaultAsync(p => p.CanonicalName == canonical);
        if (row is null)
        {
            // Fallback via DocumentEntities: the user's own document may already be
            // linked to a PI owned by a different user (legacy cross-user bug via
            // global EnsureScopedAsync). Return that linked PI so the drawer shows
            // real Completed data instead of a synthetic Pending placeholder.
            var linkedPiId = await _db.DocumentEntities
                .Where(e => e.EntityType == "product"
                            && e.ProductIntelligenceId != null
                            && e.EntityText.ToLower() == canonical)
                .Where(e => _db.KnowledgeDocuments.Any(d => d.Id == e.DocumentId && d.UserId == userId))
                .Select(e => e.ProductIntelligenceId!.Value)
                .FirstOrDefaultAsync();
            if (linkedPiId != Guid.Empty)
            {
                row = await _db.ProductIntelligences.FirstOrDefaultAsync(p => p.Id == linkedPiId);
            }
        }
        if (row is null)
        {
            return new ProductIntelligenceDto(
                Name: string.IsNullOrWhiteSpace(name) ? canonical : name.Trim(),
                CanonicalName: canonical,
                Manufacturer: null, Category: null, Description: null, WhatItDoes: null,
                UseCases: [], TargetIndustries: [], KeyFeatures: [], KeySpecifications: [],
                StandoutPoints: [], Variants: [], Limitations: [],
                SearchQuery: null, SearchStatus: "Pending", EnrichmentStatus: "Pending",
                ConfidenceScore: 0, SourceCount: 0, LastEnrichedAt: null, LastError: null);
        }
        var sourceCount = await SourceCountAsync(row.Id);
        return ToDto(row, sourceCount);
    }

    /// <summary>
    /// Explicit enrichment action (Reprocess / Retry / Start enrichment).
    /// Marks the shared profile Enriching and, when a document is known, the
    /// document's own product entity Enriching too, then queues research.
    /// Duplicate-trigger protection: if the profile is already Enriching (and
    /// not stale) or the same request is already in flight, this is a no-op.
    /// When <paramref name="documentId"/> is given the shared row is scoped to
    /// that document's knowledge base company.
    /// </summary>
    public async Task<ProductIntelligenceDto> ForceReenrichAsync(string name, Guid userId, Guid? documentId = null)
    {
        var canonical = NormalizeName(name);
        Guid? kbId = null;
        string? companyName = null;
        if (documentId is Guid docId)
        {
            var docScope = await _db.KnowledgeDocuments
                .Where(d => d.Id == docId && d.UserId == userId)
                .Select(d => new { d.KnowledgeBaseId, CompanyName = d.KnowledgeBase != null ? d.KnowledgeBase.CompanyName : null })
                .FirstOrDefaultAsync();
            if (docScope?.KnowledgeBaseId is Guid kbOfDoc)
            {
                kbId = kbOfDoc;
                companyName = docScope.CompanyName;
            }
        }

        // Company-scoped, user-scoped lookup: ProductIntelligence is deduped by
        // (CompanyName, CanonicalName) but must not cross user boundaries.
        // The previous global lookup reused a PI owned by a different user,
        // causing dev's documents to link to e2e-owned PIs (blank drawer via
        // ScopedQuery). Now we only reuse PIs whose KnowledgeBase is owned by
        // the same user; otherwise we create a new per-user PI.
        // Fallback to synthetic/document link is handled below if still null.
        ProductIntelligence? row = null;
        if (!string.IsNullOrWhiteSpace(companyName))
        {
            var userKbIdsForForce = _db.KnowledgeBases.Where(k => k.UserId == userId).Select(k => k.Id);
            row = await _db.ProductIntelligences.FirstOrDefaultAsync(p =>
                p.CompanyName == companyName && p.CanonicalName == canonical
                && p.KnowledgeBaseId != null && userKbIdsForForce.Contains(p.KnowledgeBaseId.Value));
        }
        if (row is null)
        {
            row = await ScopedQuery(userId).FirstOrDefaultAsync(p => p.CanonicalName == canonical);
        }
        if (row is null)
        {
            // Cross-user link fallback: a DocumentEntity for this user already
            // points to a PI (legacy bug). Reuse that PI so ForceReenrich
            // operates on the linked row instead of creating a duplicate.
            var linkedPiId = await _db.DocumentEntities
                .Where(e => e.EntityType == "product"
                            && e.ProductIntelligenceId != null
                            && e.EntityText.ToLower() == canonical)
                .Where(e => _db.KnowledgeDocuments.Any(d => d.Id == e.DocumentId && d.UserId == userId))
                .Select(e => e.ProductIntelligenceId!.Value)
                .FirstOrDefaultAsync();
            if (linkedPiId != Guid.Empty)
            {
                row = await _db.ProductIntelligences.FirstOrDefaultAsync(p => p.Id == linkedPiId);
            }
        }

        if (row is null)
        {
            row = new ProductIntelligence(canonical,
                string.IsNullOrWhiteSpace(name) ? canonical : name.Trim(),
                kbId, companyName);
            _db.ProductIntelligences.Add(row);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Race: another document created the same company+canonical row
                // concurrently. Reload the winner (user-scoped).
                await _db.Entry(row).ReloadAsync();
                if (!string.IsNullOrWhiteSpace(companyName))
                {
                    var userKbIdsRace = _db.KnowledgeBases.Where(k => k.UserId == userId).Select(k => k.Id);
                    row = await _db.ProductIntelligences.FirstOrDefaultAsync(p =>
                        p.CompanyName == companyName && p.CanonicalName == canonical
                        && p.KnowledgeBaseId != null && userKbIdsRace.Contains(p.KnowledgeBaseId.Value))
                        ?? row;
                }
                else
                {
                    row = await ScopedQuery(userId).FirstOrDefaultAsync(p => p.CanonicalName == canonical)
                        ?? row;
                }
            }
        }

        if (row.EnrichmentStatus == ProductIntelligence.EnrichmentState.Enriching && !IsStaleEnriching(row))
        {
            // Already processing - do not create a duplicate job.
            var already = await SourceCountAsync(row.Id);
            return ToDto(row, already);
        }

        row.MarkEnriching(null);
        await _db.SaveChangesAsync();
        if (documentId is Guid targetDoc)
        {
            await MarkDocumentEntityEnrichingAsync(canonical, targetDoc, row.Id);
        }
        _queue.Enqueue(canonical, force: true, knowledgeBaseId: row.KnowledgeBaseId, companyName: row.CompanyName, documentId: documentId);

        var sourceCount = await SourceCountAsync(row.Id);
        return ToDto(row, sourceCount);
    }

    /// <summary>
    /// Ingest-time entry point: get-or-create the company-scoped product row
    /// for a product identified in an uploaded document, link + mark the
    /// document's own product entity, and queue research for that document.
    /// Used by the Knowledge Bank pipeline so product intelligence is prepared
    /// once at ingestion and never re-researched on a live-call mention.
    /// Duplicate-trigger safe: Completed/active-Enriching profiles are not
    /// re-queued.
    /// </summary>
    public async Task<ProductIntelligenceDto> EnsureScopedAsync(
        Guid knowledgeBaseId,
        string companyName,
        string name,
        string? context,
        Guid? documentId = null,
        bool autoEnrich = true)
    {
        var canonical = NormalizeName(name);
        // User-scoped lookup: resolve owning user from knowledgeBaseId so we never
        // link a document's entities to a PI owned by a different user (global
        // CompanyName+Canonical index caused cross-user linking, e.g. dev@dev.com
        // entities pointing at e2e user's PI for Secure Meters Brochure).
        var ownerUserId = await _db.KnowledgeBases
            .Where(k => k.Id == knowledgeBaseId)
            .Select(k => (Guid?)k.UserId)
            .FirstOrDefaultAsync();
        ProductIntelligence? row = null;
        if (ownerUserId != null)
        {
            var userKbIds = _db.KnowledgeBases.Where(k => k.UserId == ownerUserId.Value).Select(k => k.Id);
            row = await _db.ProductIntelligences.FirstOrDefaultAsync(p =>
                p.CompanyName == companyName && p.CanonicalName == canonical
                && p.KnowledgeBaseId != null && userKbIds.Contains(p.KnowledgeBaseId.Value));
        }
        else
        {
            row = await _db.ProductIntelligences.FirstOrDefaultAsync(p =>
                p.CompanyName == companyName && p.CanonicalName == canonical);
        }

        if (row is null)
        {
            row = new ProductIntelligence(
                canonical,
                string.IsNullOrWhiteSpace(name) ? canonical : name.Trim(),
                knowledgeBaseId,
                companyName);
            _db.ProductIntelligences.Add(row);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                await _db.Entry(row).ReloadAsync();
                if (ownerUserId != null)
                {
                    var userKbIdsRace = _db.KnowledgeBases.Where(k => k.UserId == ownerUserId.Value).Select(k => k.Id);
                    row = await _db.ProductIntelligences.AsNoTracking().FirstOrDefaultAsync(p =>
                        p.CompanyName == companyName && p.CanonicalName == canonical
                        && p.KnowledgeBaseId != null && userKbIdsRace.Contains(p.KnowledgeBaseId.Value))
                        ?? row;
                }
                else
                {
                    row = await _db.ProductIntelligences.AsNoTracking().FirstOrDefaultAsync(p =>
                        p.CompanyName == companyName && p.CanonicalName == canonical)
                        ?? row;
                }
            }
        }

        // Link + mark the document's own product entity.
        // NOTE: For Completed/Failed reuse we must NOT leave the entity as
        // Enriching — it should immediately reflect the shared profile's
        // settled status so the doc's chip list shows Ready/Failed instead
        // of stuck Processing. The previous code left it as Enriching when
        // the PI was already Completed, causing 5 of 17 to show Processing
        // forever.
        string? documentStatusToSync = null;
        Guid? documentStatusLinkId = row.Id;
        if (documentId is Guid docId)
        {
            await MarkDocumentEntityEnrichingAsync(canonical, docId, row.Id);
            // Decide the correct per-document status before deciding to enqueue.
            // We will sync it after the switch so a Completed reuse instantly
            // marks the entity Completed.
            documentStatusToSync = row.EnrichmentStatus switch
            {
                ProductIntelligence.EnrichmentState.Completed => "Completed",
                ProductIntelligence.EnrichmentState.Failed => "Failed",
                ProductIntelligence.EnrichmentState.NeedsReview => "NeedsReview",
                _ => null,
            };
        }

        // Background enrichment: enqueue unless already settled/processing.
        var shouldEnqueue = false;
        if (autoEnrich)
        {
            switch (row.EnrichmentStatus)
            {
                case ProductIntelligence.EnrichmentState.Completed:
                    shouldEnqueue = false;
                    break;
                case ProductIntelligence.EnrichmentState.Enriching:
                    if (!IsStaleEnriching(row))
                    {
                        shouldEnqueue = false;
                    }
                    else
                    {
                        shouldEnqueue = true;
                    }
                    break;
                case ProductIntelligence.EnrichmentState.Failed:
                case ProductIntelligence.EnrichmentState.NeedsReview:
                    if (row.LastEnrichedAt is null || DateTime.UtcNow - row.LastEnrichedAt.Value > ReenrichCooldown)
                    {
                        shouldEnqueue = true;
                    }
                    else
                    {
                        shouldEnqueue = false;
                    }
                    break;
                default: // Pending
                    shouldEnqueue = true;
                    break;
            }
            if (shouldEnqueue)
            {
                _queue.Enqueue(canonical, context, knowledgeBaseId: row.KnowledgeBaseId, companyName: row.CompanyName, documentId: documentId);
                documentStatusToSync = null; // keep Enriching, job is now in flight
            }
        }

        // Sync the per-document entity to the shared profile's settled status
        // when we are reusing it and not re-enqueueing. This is the fix for
        // "1/17 enriched, 5 processing forever" — those 5 had a Completed PI
        // from an earlier E2E run but their entity stayed Enriching.
        if (documentStatusToSync is not null && documentId is Guid syncDocId)
        {
            await UpdateDocumentEntitiesAsync(canonical, syncDocId, documentStatusToSync, documentStatusLinkId);
        }

        var sourceCount = await SourceCountAsync(row.Id);
        return ToDto(row, sourceCount);
    }

    private static bool IsStaleEnriching(ProductIntelligence row)
        => row.UpdatedAt is null || DateTime.UtcNow - row.UpdatedAt.Value > StaleEnrichingWindow;

    /// <summary>Marks the document's own product entity (if it exists) as
    /// Enriching and links it to the shared profile.</summary>
    private async Task MarkDocumentEntityEnrichingAsync(string canonical, Guid documentId, Guid productIntelligenceId)
    {
        var entities = await _db.DocumentEntities
            .Where(e => e.DocumentId == documentId
                        && e.EntityType == "product"
                        && e.EntityText.ToLower() == canonical)
            .ToListAsync();
        foreach (var entity in entities)
        {
            entity.SetEnrichmentStatus("Enriching", productIntelligenceId: productIntelligenceId);
        }
        if (entities.Count > 0)
        {
            await _db.SaveChangesAsync();
        }
    }

    private async Task<int> SourceCountAsync(Guid productIntelligenceId)
    {
        return await _db.ProductSources.CountAsync(s => s.ProductIntelligenceId == productIntelligenceId);
    }

    /// <summary>
    /// Bulk enrichment for a document's selected products. Reuses the exact
    /// individual enrich path (<see cref="ForceReenrichAsync"/>) per product -
    /// no separate pipeline. Products already Processing are left untouched
    /// (no duplicate jobs); Pending/Failed/Ready are queued (Ready re-researches
    /// exactly like the individual Reprocess action). Operates ONLY on
    /// product records belonging to <paramref name="documentId"/>.
    /// </summary>
    public async Task<BulkProductResult> BulkEnrichAsync(Guid documentId, Guid userId, IReadOnlyList<Guid> productIds)
    {
        var doc = await _db.KnowledgeDocuments.FirstOrDefaultAsync(d => d.Id == documentId && d.UserId == userId);
        if (doc is null) return new BulkProductResult();

        var ids = (productIds ?? []).Distinct().ToList();
        var entities = await _db.DocumentEntities
            .Where(e => e.DocumentId == documentId && ids.Contains(e.Id) && e.EntityType == "product")
            .ToListAsync();

        var result = new BulkProductResult();
        foreach (var entity in entities)
        {
            var canonical = NormalizeName(entity.EntityText);
            if (string.IsNullOrWhiteSpace(canonical)) { result.Skipped++; continue; }
            try
            {
                // Already Processing (healthy) - never create a duplicate job.
                // Use company-scoped lookup: PI is deduped by (Company, Canonical)
                // so a KB-scoped lookup would miss the company's existing row
                // and incorrectly queue a duplicate (which then hits the unique
                // index and is counted as Skipped — 10 of 11 failed earlier).
                if (entity.EnrichmentStatus == "Enriching")
                {
                    string? companyForCheck = null;
                    if (doc.KnowledgeBaseId is Guid checkKbId)
                    {
                        companyForCheck = await _db.KnowledgeBases.Where(k => k.Id == checkKbId).Select(k => k.CompanyName).FirstOrDefaultAsync();
                    }
                    var row = !string.IsNullOrWhiteSpace(companyForCheck)
                        ? await _db.ProductIntelligences.FirstOrDefaultAsync(p => p.CompanyName == companyForCheck && p.CanonicalName == canonical)
                        : await _db.ProductIntelligences.FirstOrDefaultAsync(p => p.CanonicalName == canonical);
                    if (row is not null && row.EnrichmentStatus == ProductIntelligence.EnrichmentState.Enriching && !IsStaleEnriching(row))
                    {
                        result.Processing++;
                        continue;
                    }
                }
                await ForceReenrichAsync(canonical, userId, documentId);
                result.Queued++;
            }
            catch
            {
                result.Skipped++;
            }
        }
        return result;
    }

    /// <summary>
    /// Bulk delete for a document's selected products. Reuses the individual
    /// <see cref="RemoveDocumentProductAsync"/> rules (per-document entity is
    /// removed; the shared KB intelligence is removed only when no other
    /// document still references it). Never touches the source document.
    /// </summary>
    public async Task<BulkProductResult> BulkDeleteAsync(Guid documentId, Guid userId, IReadOnlyList<Guid> productIds)
    {
        var doc = await _db.KnowledgeDocuments.FirstOrDefaultAsync(d => d.Id == documentId && d.UserId == userId);
        if (doc is null) return new BulkProductResult();

        var ids = (productIds ?? []).Distinct().ToList();
        var texts = await _db.DocumentEntities
            .Where(e => e.DocumentId == documentId && ids.Contains(e.Id) && e.EntityType == "product")
            .Select(e => e.EntityText)
            .ToListAsync();

        var result = new BulkProductResult();
        await using var tx = await _db.Database.BeginTransactionAsync();
        foreach (var text in texts)
        {
            var canonical = NormalizeName(text);
            if (string.IsNullOrWhiteSpace(canonical)) continue;
            try
            {
                if (await RemoveDocumentProductAsync(documentId, userId, canonical)) result.Deleted++;
            }
            catch
            {
                // one failure should not abort the rest
            }
        }
        await tx.CommitAsync();
        return result;
    }

    /// <summary>
    /// Removes an extracted product from a document's product intelligence.
    /// Deletes the document's product entity record (so it disappears from the
    /// list) and, only when NO other document in the same knowledge base still
    /// references the product, the shared company-scoped intelligence row too.
    /// The source document itself is never touched.
    /// </summary>
    public async Task<bool> RemoveDocumentProductAsync(Guid documentId, Guid userId, string name)
    {
        var doc = await _db.KnowledgeDocuments.FirstOrDefaultAsync(d => d.Id == documentId && d.UserId == userId);
        if (doc is null) return false;

        var canonical = NormalizeName(name);

        var entities = await _db.DocumentEntities
            .Where(e => e.DocumentId == documentId
                        && (e.EntityType == "product")
                        && e.EntityText.ToLower() == canonical)
            .ToListAsync();
        _db.DocumentEntities.RemoveRange(entities);
        await _db.SaveChangesAsync();

        if (doc.KnowledgeBaseId is Guid kbId)
        {
            var otherDocIdsInKb = _db.KnowledgeDocuments
                .Where(d => d.KnowledgeBaseId == kbId && d.Id != documentId)
                .Select(d => d.Id);
            var stillReferenced = await _db.DocumentEntities.AnyAsync(e =>
                otherDocIdsInKb.Contains(e.DocumentId)
                && e.EntityType == "product"
                && e.EntityText.ToLower() == canonical);
            if (!stillReferenced)
            {
                var intelligence = await _db.ProductIntelligences
                    .FirstOrDefaultAsync(p => p.KnowledgeBaseId == kbId && p.CanonicalName == canonical);
                if (intelligence is not null)
                {
                    _db.ProductIntelligences.Remove(intelligence);
                }
            }
        }

        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<IReadOnlyList<ProductSourceDto>> GetSourcesAsync(string name, Guid userId)
    {
        var canonical = NormalizeName(name);
        var id = await ScopedQuery(userId)
            .Where(p => p.CanonicalName == canonical)
            .Select(p => p.Id)
            .FirstOrDefaultAsync();
        if (id == Guid.Empty)
        {
            // Fallback via DocumentEntities link (same cross-user legacy fix as GetAsync)
            var linkedPiId = await _db.DocumentEntities
                .Where(e => e.EntityType == "product"
                            && e.ProductIntelligenceId != null
                            && e.EntityText.ToLower() == canonical)
                .Where(e => _db.KnowledgeDocuments.Any(d => d.Id == e.DocumentId && d.UserId == userId))
                .Select(e => e.ProductIntelligenceId!.Value)
                .FirstOrDefaultAsync();
            if (linkedPiId != Guid.Empty) id = linkedPiId;
        }
        if (id == Guid.Empty) return [];

        return await _db.ProductSources
            .Where(s => s.ProductIntelligenceId == id)
            .OrderByDescending(s => s.SourceType == "official")
            .ThenByDescending(s => s.RelevanceScore)
            .Select(s => new ProductSourceDto(s.Title, s.Url, s.Domain, s.SourceType, s.Snippet, s.RelevanceScore))
            .ToListAsync();
    }

    /// <summary>Background-worker entry point: research + persist + link mentions.</summary>
    public async Task ResearchAndPersistAsync(ProductIntelRequest request)
    {
        try
        {
            // Resolve the scoped row - the ingest pipeline pre-creates it with
            // (company, canonical), so this lookup keys on the request scope.
            var row = await _db.ProductIntelligences.FirstOrDefaultAsync(p =>
                p.CanonicalName == request.CanonicalName
                && p.CompanyName == request.CompanyName);
            if (row is null) return;

            // Cache hit - skip unless explicitly forced.
            if (row.EnrichmentStatus == ProductIntelligence.EnrichmentState.Completed && !request.Force) return;

            row.MarkEnriching(null);
            await _db.SaveChangesAsync();

            var response = await CallEngineAsync(row, request.Context);
            if (response is null)
            {
                row.MarkFailed("AI engine research unavailable");
                await _db.SaveChangesAsync();
                await UpdateDocumentEntitiesAsync(request.CanonicalName, request.DocumentId, "Failed", row.Id);
                return;
            }

            if (response.Product is null || response.Product.IsEmpty)
            {
                row.MarkFailed(string.IsNullOrWhiteSpace(response.Error) ? "research produced no usable data" : response.Error);
                await _db.SaveChangesAsync();
                await UpdateDocumentEntitiesAsync(request.CanonicalName, request.DocumentId, "Failed", row.Id);
                return;
            }

            var result = ToResult(response, row);
            row.MarkCompleted(result);

            foreach (var source in result.Sources)
            {
                _db.ProductSources.Add(new ProductSource(
                    row.Id, source.Title, source.Url, source.Domain, source.SourceType, source.Snippet, source.RelevanceScore));
            }

            await _db.SaveChangesAsync();
            await LinkMentionsAsync(request.CanonicalName, row.Id);
            await UpdateDocumentEntitiesAsync(request.CanonicalName, request.DocumentId,
                result.NeedsReview ? "NeedsReview" : "Completed", row.Id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Product enrichment failed for {Product} ({Company})", request.CanonicalName, request.CompanyName);
            try
            {
                var row = await _db.ProductIntelligences.FirstOrDefaultAsync(p =>
                    p.CanonicalName == request.CanonicalName && p.CompanyName == request.CompanyName);
                if (row is not null)
                {
                    row.MarkFailed(ex.Message);
                    await _db.SaveChangesAsync();
                }
                await UpdateDocumentEntitiesAsync(request.CanonicalName, request.DocumentId, "Failed", row?.Id);
            }
            catch (Exception inner)
            {
                _logger.LogError(inner, "Failed to record product enrichment error for {Product}", request.CanonicalName);
            }
        }
    }

    /// <summary>Propagates the enrichment outcome to the source document's own
    /// product entity so each document's status stays independent.</summary>
    private async Task UpdateDocumentEntitiesAsync(string canonical, Guid? documentId, string status, Guid? productIntelligenceId)
    {
        if (documentId is not Guid docId) return;
        var entities = await _db.DocumentEntities
            .Where(e => e.DocumentId == docId
                        && e.EntityType == "product"
                        && e.EntityText.ToLower() == canonical)
            .ToListAsync();
        foreach (var entity in entities)
        {
            entity.SetEnrichmentStatus(status, DateTime.UtcNow, productIntelligenceId);
        }
        if (entities.Count > 0)
        {
            await _db.SaveChangesAsync();
        }
    }

    /// <summary>Links every unlinked ProductMentioned mention to the canonical product.</summary>
    private async Task LinkMentionsAsync(string canonicalName, Guid productIntelligenceId)
    {
        var linked = await _db.ConversationEvents
            .Where(e => e.EventType == "ProductMentioned"
                        && e.EntityName != null
                        && e.EntityName.ToLower() == canonicalName
                        && e.ProductIntelligenceId == null)
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.ProductIntelligenceId, productIntelligenceId));
        if (linked > 0)
        {
            _logger.LogDebug("Linked {Count} mentions of {Product} to product profile", linked, canonicalName);
        }
    }

    private async Task<EngineProductResearchResponse?> CallEngineAsync(ProductIntelligence row, string? context)
    {
        using var client = _httpClientFactory.CreateClient("AiEngine");

        // The owning knowledge base provides the company + website used to
        // disambiguate the web research ("Secure Meters Sprint 210"), and the
        // owner user for BYOK provider resolution.
        string? website = null;
        Guid? ownerUserId = null;
        if (row.KnowledgeBaseId is Guid kbId)
        {
            var kb = await _db.KnowledgeBases
                .Where(k => k.Id == kbId)
                .Select(k => new { k.Website, k.UserId })
                .FirstOrDefaultAsync();
            website = kb?.Website;
            ownerUserId = kb?.UserId;
        }

        // BYOK: forward the user resolved provider config so the engine
        // research extraction uses the user key (falls back to the engine
        // operator default when unset).
        object? providerBlock = null;
        if (ownerUserId is Guid uid)
        {
            try
            {
                var resolved = await ResolveUserProviderAsync(uid);
                if (resolved is not null)
                {
                    providerBlock = new
                    {
                        provider_type = resolved.ProviderType,
                        model = resolved.Model,
                        api_key = resolved.ApiKey,
                        endpoint = resolved.Endpoint,
                    };
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Product research provider resolution failed for user {User}", uid);
            }
        }

        var response = await client.PostAsJsonAsync("/internal/product-intel", new
        {
            name = row.DisplayName,
            manufacturer = row.Manufacturer,
            category = row.Category,
            company = row.CompanyName,
            website = website ?? "",
            context = context ?? "",
            meeting_id = "",
            provider = providerBlock,
        });
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Product research returned {StatusCode} for {Product}", response.StatusCode, row.CanonicalName);
            return null;
        }
        return await response.Content.ReadFromJsonAsync<EngineProductResearchResponse>();
    }

    private static ProductEnrichmentResult ToResult(EngineProductResearchResponse response, ProductIntelligence row)
    {
        var product = response.Product!;
        return new ProductEnrichmentResult(
            DisplayName: string.IsNullOrWhiteSpace(product.CanonicalName) ? row.DisplayName : product.CanonicalName,
            Manufacturer: product.Manufacturer,
            Category: product.Category,
            Description: product.Description,
            WhatItDoes: product.WhatItDoes,
            UseCases: product.UseCases,
            TargetIndustries: product.TargetIndustries,
            KeyFeatures: product.KeyFeatures,
            KeySpecifications: product.KeySpecifications,
            StandoutPoints: product.StandoutPoints,
            Variants: product.Variants,
            Limitations: product.Limitations,
            ConfidenceScore: product.ConfidenceScore,
            Sources: response.Sources
                .Select(s => new ProductSourceDraft(s.Title, s.Url, s.Domain, s.SourceType, s.Snippet, s.RelevanceScore))
                .ToList(),
            NeedsReview: response.Status == "partial",
            SearchQuery: response.SearchQuery);
    }

    private static ProductIntelligenceDto ToDto(ProductIntelligence p, int sourceCount)
    {
        return new ProductIntelligenceDto(
            Name: p.DisplayName,
            CanonicalName: p.CanonicalName,
            Manufacturer: p.Manufacturer,
            Category: p.Category,
            Description: p.Description,
            WhatItDoes: p.WhatItDoes,
            UseCases: p.UseCases,
            TargetIndustries: p.TargetIndustries,
            KeyFeatures: p.KeyFeatures,
            KeySpecifications: p.KeySpecifications,
            StandoutPoints: p.StandoutPoints,
            Variants: p.Variants,
            Limitations: p.Limitations,
            SearchQuery: p.SearchQuery,
            SearchStatus: StatusText(p.SearchStatus),
            EnrichmentStatus: StatusText(p.EnrichmentStatus),
            ConfidenceScore: p.ConfidenceScore,
            SourceCount: sourceCount,
            LastEnrichedAt: p.LastEnrichedAt,
            LastError: p.LastError,
            CompanyName: p.CompanyName,
            KnowledgeBaseId: p.KnowledgeBaseId);
    }

    private static string StatusText(ProductIntelligence.EnrichmentState state) => state switch
    {
        ProductIntelligence.EnrichmentState.Pending => "Pending",
        ProductIntelligence.EnrichmentState.Enriching => "Enriching",
        ProductIntelligence.EnrichmentState.Completed => "Completed",
        ProductIntelligence.EnrichmentState.Failed => "Failed",
        ProductIntelligence.EnrichmentState.NeedsReview => "NeedsReview",
        _ => "Pending",
    };
}

// ────────────────────────────────────────────────────────────────────────────
// DTOs + engine response contracts (camelCase via System.Text.Json defaults)
// ────────────────────────────────────────────────────────────────────────────

public record ProductIntelligenceDto(
    string Name,
    string CanonicalName,
    string? Manufacturer,
    string? Category,
    string? Description,
    string? WhatItDoes,
    List<string> UseCases,
    List<string> TargetIndustries,
    List<string> KeyFeatures,
    List<string> KeySpecifications,
    List<string> StandoutPoints,
    List<string> Variants,
    List<string> Limitations,
    string? SearchQuery,
    string SearchStatus,
    string EnrichmentStatus,
    double ConfidenceScore,
    int SourceCount,
    DateTime? LastEnrichedAt,
    string? LastError,
    string? CompanyName = null,
    Guid? KnowledgeBaseId = null);

public record ProductSourceDto(string Title, string Url, string? Domain, string SourceType, string? Snippet, double RelevanceScore);

/// <summary>Outcome of a bulk product operation (enrich or delete).</summary>
public record BulkProductResult
{
    public int Queued { get; set; }
    public int Processing { get; set; }
    public int Skipped { get; set; }
    public int Deleted { get; set; }
}

public class EngineProductResearchResponse
{
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = "failed";
    public string? SearchQuery { get; set; }
    public EngineProduct? Product { get; set; }
    public List<EngineSource> Sources { get; set; } = [];
    public string? Error { get; set; }
}

public class EngineProduct
{
    public string? CanonicalName { get; set; }
    public string? Manufacturer { get; set; }
    public string? Category { get; set; }
    public string? Description { get; set; }
    public string? WhatItDoes { get; set; }
    public List<string> UseCases { get; set; } = [];
    public List<string> TargetIndustries { get; set; } = [];
    public List<string> KeyFeatures { get; set; } = [];
    public List<string> KeySpecifications { get; set; } = [];
    public List<string> StandoutPoints { get; set; } = [];
    public List<string> Variants { get; set; } = [];
    public List<string> Limitations { get; set; } = [];
    public double ConfidenceScore { get; set; }

    public bool IsEmpty =>
        string.IsNullOrWhiteSpace(Description) &&
        string.IsNullOrWhiteSpace(WhatItDoes) &&
        KeyFeatures.Count == 0 &&
        KeySpecifications.Count == 0 &&
        UseCases.Count == 0 &&
        string.IsNullOrWhiteSpace(Manufacturer);
}

public class EngineSource
{
    public string Title { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string? Domain { get; set; }
    public string SourceType { get; set; } = "search";
    public string? Snippet { get; set; }
    public double RelevanceScore { get; set; }
}
