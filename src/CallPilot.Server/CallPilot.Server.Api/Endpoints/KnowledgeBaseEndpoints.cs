using System.Security.Claims;
using CallPilot.Server.Domain.Knowledge;
using CallPilot.Server.Domain.Products;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Api.Endpoints;

public static class KnowledgeBaseEndpoints
{
    public static void MapKnowledgeBaseEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/knowledge-bases").RequireAuthorization();

        // ── Create ────────────────────────────────────────────────────────
        group.MapPost("/", async (
            ClaimsPrincipal user,
            CallPilotDbContext db,
            KnowledgeBaseUpsertRequest body) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Unauthorized();

            var name = body.Name?.Trim();
            var companyName = body.CompanyName?.Trim();
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(companyName))
                return Results.BadRequest(new { error = "Name and company name are required." });

            var kb = new KnowledgeBase(userId.Value, name, companyName, body.Website?.Trim(), body.Description?.Trim());
            db.KnowledgeBases.Add(kb);
            await db.SaveChangesAsync();

            return Results.Created($"/api/v1/knowledge-bases/{kb.Id}", ToDto(kb, productsTotal: 0, productsEnriched: 0));
        });

        // ── List (with product enrichment aggregate) ──────────────────────
        group.MapGet("/", async (
            ClaimsPrincipal user,
            CallPilotDbContext db) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Unauthorized();

            var kbIds = db.KnowledgeBases.Where(k => k.UserId == userId).Select(k => k.Id);
            var productCounts = await db.ProductIntelligences
                .Where(p => p.KnowledgeBaseId != null && kbIds.Contains(p.KnowledgeBaseId.Value))
                .GroupBy(p => p.KnowledgeBaseId!.Value)
                .Select(g => new { KbId = g.Key, Total = g.Count(), Enriched = g.Count(p => p.EnrichmentStatus == ProductIntelligence.EnrichmentState.Completed) })
                .ToDictionaryAsync(x => x.KbId);

            var kbs = await db.KnowledgeBases.Where(k => k.UserId == userId).OrderByDescending(k => k.CreatedAt).ToListAsync();
            var result = kbs.Select(k =>
            {
                productCounts.TryGetValue(k.Id, out var counts);
                return ToDto(k, counts?.Total ?? 0, counts?.Enriched ?? 0);
            }).ToList();

            return Results.Ok(new { knowledgeBases = result, count = result.Count });
        });

        // ── Detail ────────────────────────────────────────────────────────
        group.MapGet("/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            CallPilotDbContext db) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Unauthorized();

            var kb = await db.KnowledgeBases.FirstOrDefaultAsync(k => k.Id == id && k.UserId == userId);
            if (kb is null) return Results.NotFound();

            var products = await db.ProductIntelligences
                .Where(p => p.KnowledgeBaseId == id)
                .OrderBy(p => p.CanonicalName)
                .Select(p => new { p.CanonicalName, p.DisplayName, EnrichmentStatus = p.EnrichmentStatus.ToString(), p.LastEnrichedAt })
                .ToListAsync();
            var docCount = await db.KnowledgeDocuments.CountAsync(d => d.KnowledgeBaseId == id);

            return Results.Ok(new
            {
                knowledgeBase = ToDto(kb, products.Count, products.Count(p => p.EnrichmentStatus == "Completed")),
                documentCount = docCount,
                products,
            });
        });

        // ── Update ────────────────────────────────────────────────────────
        group.MapPatch("/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            CallPilotDbContext db,
            KnowledgeBaseUpsertRequest body) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Unauthorized();

            var kb = await db.KnowledgeBases.FirstOrDefaultAsync(k => k.Id == id && k.UserId == userId);
            if (kb is null) return Results.NotFound();

            var name = body.Name?.Trim();
            var companyName = body.CompanyName?.Trim();
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(companyName))
                return Results.BadRequest(new { error = "Name and company name are required." });

            kb.Update(name, companyName, body.Website?.Trim(), body.Description?.Trim());
            await db.SaveChangesAsync();

            var total = await db.ProductIntelligences.CountAsync(p => p.KnowledgeBaseId == id);
            var enriched = await db.ProductIntelligences.CountAsync(p => p.KnowledgeBaseId == id && p.EnrichmentStatus == ProductIntelligence.EnrichmentState.Completed);
            return Results.Ok(ToDto(kb, total, enriched));
        });

        // ── Delete ────────────────────────────────────────────────────────
        group.MapDelete("/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            CallPilotDbContext db) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Unauthorized();

            var kb = await db.KnowledgeBases.FirstOrDefaultAsync(k => k.Id == id && k.UserId == userId);
            if (kb is null) return Results.NotFound();

            db.KnowledgeBases.Remove(kb);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static Guid? GetUserId(ClaimsPrincipal user)
    {
        var claim = user.FindFirst("userId")?.Value;
        return claim is not null && Guid.TryParse(claim, out var id) ? id : null;
    }

    private static object ToDto(KnowledgeBase k, int productsTotal, int productsEnriched) => new
    {
        k.Id,
        k.Name,
        k.CompanyName,
        k.Website,
        k.Description,
        k.CreatedAt,
        k.UpdatedAt,
        productsTotal,
        productsEnriched,
    };
}

public record KnowledgeBaseUpsertRequest(string? Name, string? CompanyName, string? Website, string? Description);
