using System.Net.Http.Json;
using System.Text.Json;
using CallPilot.Server.Domain.AI;
using CallPilot.Server.Domain.Providers;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Shared.Abstractions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

/// <summary>A feature that can be served by a user-connected provider.</summary>
public static class AiFeatures
{
    /// <summary>The merged knowledge-bank pipeline: product extraction, vision
    /// captioning and product research from uploaded documents.  This is the
    /// feature the upload handler actually resolves and uses.</summary>
    public const string KnowledgeProcessing = "knowledge_processing";

    /// <summary>Document extraction (parsing/structuring with an LLM) - exposed
    /// as a user-facing selector; currently resolved through KnowledgeProcessing
    /// (the single-LLM-pass pipeline), kept as its own id for future split.</summary>
    public const string DocumentExtraction = "document_extraction";

    /// <summary>Product extraction (the enrichment card pass) - exposed as a
    /// user-facing selector; currently resolved through KnowledgeProcessing,
    /// kept as its own id for future split.</summary>
    public const string ProductExtraction = "product_extraction";

    /// <summary>All supported feature ids (the UI offers these for provider selection).</summary>
    public static readonly string[] All = [KnowledgeProcessing, DocumentExtraction, ProductExtraction];
}

/// <summary>
/// BYOK provider service: manages user-connected AI providers, resolves a
/// feature to the user chosen provider+model, tests keys, lists models,
/// records CallPilot usage and captures provider rate-limit snapshots.
///
/// Credential rules enforced here:
///   * Keys are stored encrypted (ApiKeyEncryptionService) and only
///     decrypted in-memory when actually needed for a provider call.
///   * The plaintext key never leaves this process except to the
///     internal AI-engine call over the docker network.
///   * The UI receives only masked keys + connection status.
/// </summary>
public class ProviderSvc
{
    private readonly CallPilotDbContext _db;
    private readonly IApiKeyEncryptionService _encryption;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<ProviderSvc> _logger;

    public ProviderSvc(
        CallPilotDbContext db,
        IApiKeyEncryptionService encryption,
        IHttpClientFactory httpClientFactory,
        ILogger<ProviderSvc> logger)
    {
        _db = db;
        _encryption = encryption;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    // ── Feature resolution (the knowledge pipeline calls this) ─────────────

    /// <summary>
    /// Resolve the user configured provider+model for a feature.
    /// Returns a fully-decrypted config ready to hand to the AI engine
    /// (internal call), or null when the user has no provider connected.
    /// </summary>
    public async Task<ResolvedProvider?> ResolveFeatureAsync(Guid userId, string feature, CancellationToken ct = default)
    {
        var pref = await _db.UserFeaturePreferences
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.Feature == feature, ct);
        if (pref is not null && pref.ProviderConfigurationId is Guid prefProviderId && pref.Model is not null)
        {
            var configured = await _db.ProviderConfigurations
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == prefProviderId && p.UserId == userId, ct);
            if (configured is not null)
                return Decrypt(configured, pref.Model);
        }
        // No explicit feature preference (or it references a deleted provider) -
        // fall back to the user first connected provider.
        var fallback = await _db.ProviderConfigurations
            .AsNoTracking()
            .Where(p => p.UserId == userId && p.IsEnabled)
            .OrderBy(p => p.CreatedAt)
            .FirstOrDefaultAsync(ct);
        return fallback is null ? null : Decrypt(fallback, fallback.Model);
    }

    private ResolvedProvider Decrypt(ProviderConfiguration p, string? model)
    {
        return new ResolvedProvider(
            p.Id,
            p.ProviderType.ToLowerInvariant(),
            string.IsNullOrWhiteSpace(model) ? p.Model : model,
            _encryption.Decrypt(p.EncryptedApiKey),
            p.Endpoint,
            true);
    }

    // ── Provider CRUD + test + models ──────────────────────────────────

    public async Task<IReadOnlyList<ProviderStatusDto>> ListAsync(Guid userId, CancellationToken ct = default)
    {
        var providers = await _db.ProviderConfigurations
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.CreatedAt)
            .ToListAsync(ct);
        var prefFeatures = await _db.UserFeaturePreferences
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => new { p.ProviderConfigurationId, p.Feature })
            .ToListAsync(ct);
        var featuresByProvider = prefFeatures
            .Where(x => x.ProviderConfigurationId.HasValue)
            .GroupBy(x => x.ProviderConfigurationId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Feature).ToList());
        var outList = new List<ProviderStatusDto>();
        foreach (var p in providers)
        {
            outList.Add(new ProviderStatusDto(
                p.Id,
                p.ProviderType.ToLowerInvariant(),
                p.Model,
                p.Endpoint,
                !string.IsNullOrWhiteSpace(p.EncryptedApiKey),
                MaskDecrypted(p.EncryptedApiKey),
                p.IsEnabled,
                p.CreatedAt,
                featuresByProvider.TryGetValue(p.Id, out var fs) ? fs : new List<string>()));
        }
        return outList;
    }

    public async Task<ProviderStatusDto> UpsertAsync(Guid userId, UpsertProviderRequest req, CancellationToken ct = default)
    {
        var providerType = req.ProviderType.Trim().ToLowerInvariant();
        var existing = await _db.ProviderConfigurations
            .FirstOrDefaultAsync(p => p.UserId == userId && p.ProviderType == providerType, ct);

        if (existing is not null)
        {
            var key = string.IsNullOrWhiteSpace(req.ApiKey)
                ? existing.EncryptedApiKey
                : _encryption.Encrypt(req.ApiKey);
            existing.Update(
                string.IsNullOrWhiteSpace(req.Model) ? existing.Model : req.Model,
                req.Endpoint ?? existing.Endpoint,
                key,
                req.Temperature ?? existing.Temperature,
                req.MaxTokens ?? existing.MaxTokens,
                req.TimeoutSeconds ?? existing.TimeoutSeconds);
        }
        else
        {
            var encrypted = _encryption.Encrypt(req.ApiKey ?? string.Empty);
            existing = new ProviderConfiguration(
                userId, providerType, req.Model ?? providerType, req.Endpoint,
                encrypted, req.Temperature ?? 0.1, req.MaxTokens ?? 6144, req.TimeoutSeconds ?? 120);
            _db.ProviderConfigurations.Add(existing);
        }
        await _db.SaveChangesAsync(ct);

        var hasKey = !string.IsNullOrWhiteSpace(existing.EncryptedApiKey);
        return new ProviderStatusDto(
            existing.Id,
            existing.ProviderType.ToLowerInvariant(),
            existing.Model,
            existing.Endpoint,
            hasKey,
            MaskDecrypted(existing.EncryptedApiKey),
            existing.IsEnabled,
            existing.CreatedAt,
            new List<string>());
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid providerId, CancellationToken ct = default)
    {
        var provider = await _db.ProviderConfigurations
            .FirstOrDefaultAsync(p => p.Id == providerId && p.UserId == userId, ct);
        if (provider is null) return false;
        provider.MarkDeleted();
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<KeyTestResult> TestKeyAsync(
        Guid userId,
        string providerType,
        string apiKey,
        string? endpoint = null,
        CancellationToken ct = default)
    {
        try
        {
            var client = _httpClientFactory.CreateClient("AiEngine");
            var resp = await client.PostAsJsonAsync("/internal/ai/test-key", new
            {
                provider_type = providerType,
                api_key = apiKey,
                endpoint,
            }, ct);
            if (!resp.IsSuccessStatusCode)
            {
                return new KeyTestResult(false, "provider_unavailable", "AI engine unavailable while testing key");
            }
            var body = await resp.Content.ReadFromJsonAsync<KeyTestResultDto>(ct);
            return body is null
                ? new KeyTestResult(false, "unknown", "empty test response")
                : new KeyTestResult(body.Valid, body.ErrorCode ?? "unknown", body.Error);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Provider key test failed for {Provider}", providerType);
            return new KeyTestResult(false, "provider_unavailable", "could not reach AI engine to test key");
        }
    }

    /// <summary>Test a provider the user has ALREADY connected, using the
    /// stored (encrypted) key - decrypted server-side only.</summary>
    public async Task<KeyTestResult> TestStoredProviderAsync(Guid userId, Guid providerId, CancellationToken ct = default)
    {
        var provider = await _db.ProviderConfigurations
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == providerId && p.UserId == userId && p.DeletedAt == null, ct);
        if (provider is null) return new KeyTestResult(false, "unknown", "Provider not found");
        if (string.IsNullOrWhiteSpace(provider.EncryptedApiKey))
            return new KeyTestResult(false, "missing_key", "No API key stored for this provider");
        var plaintext = _encryption.Decrypt(provider.EncryptedApiKey);
        if (string.IsNullOrWhiteSpace(plaintext))
            return new KeyTestResult(false, "missing_key", "No API key stored for this provider");
        return await TestKeyAsync(userId, provider.ProviderType, plaintext, provider.Endpoint, ct);
    }
    public async Task<IReadOnlyList<ProviderModelDto>> ListModelsAsync(
        Guid userId,
        string providerType,
        string apiKey,
        string? endpoint = null,
        CancellationToken ct = default)
    {
        try
        {
            var client = _httpClientFactory.CreateClient("AiEngine");
            var resp = await client.PostAsJsonAsync("/internal/ai/models", new
            {
                provider_type = providerType,
                api_key = apiKey,
                endpoint,
            }, ct);
            if (!resp.IsSuccessStatusCode) return new List<ProviderModelDto>();
            var body = await resp.Content.ReadFromJsonAsync<ModelListDto>(ct);
            if (body?.Models is null) return new List<ProviderModelDto>();
            var result = new List<ProviderModelDto>();
            foreach (var m in body.Models)
            {
                result.Add(new ProviderModelDto(
                    m.Id ?? "",
                    m.Name ?? m.Id ?? "",
                    m.Capabilities ?? new List<string>(),
                    m.SupportsJsonOutput ?? false,
                    m.FromFallback ?? false));
            }
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Model listing failed for {Provider}", providerType);
            return new List<ProviderModelDto>();
        }
    }

    // ── Feature preferences ─────────────────────────────────────────────

    /// <summary>List models for a provider the user has ALREADY connected, using the
    /// stored (encrypted) key - decrypted server-side only.  The plaintext key
    /// never travels to the client; the engine does the live discovery (with
    /// curated fallback when discovery is unavailable).</summary>
    public async Task<IReadOnlyList<ProviderModelDto>> ListModelsForProviderAsync(
        Guid userId,
        Guid providerId,
        CancellationToken ct = default)
    {
        var provider = await _db.ProviderConfigurations
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == providerId && p.UserId == userId && p.DeletedAt == null, ct);
        if (provider is null) return new List<ProviderModelDto>();
        if (string.IsNullOrWhiteSpace(provider.EncryptedApiKey)) return new List<ProviderModelDto>();

        var plaintext = _encryption.Decrypt(provider.EncryptedApiKey);
        if (string.IsNullOrWhiteSpace(plaintext)) return new List<ProviderModelDto>();
        return await ListModelsAsync(userId, provider.ProviderType, plaintext, provider.Endpoint, ct);
    }
    public async Task<FeaturePreferenceDto> SetFeaturePreferenceAsync(
        Guid userId,
        string feature,
        Guid? providerConfigurationId,
        string? model,
        CancellationToken ct = default)
    {
        if (!AiFeatures.All.Contains(feature))
            throw new ArgumentException($"Unknown feature: {feature}", nameof(feature));
        if (providerConfigurationId is Guid pid)
        {
            var owns = await _db.ProviderConfigurations.AnyAsync(
                p => p.Id == pid && p.UserId == userId && p.DeletedAt == null, ct);
            if (!owns) throw new KeyNotFoundException("Provider not found for user");
        }
        var pref = await _db.UserFeaturePreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.Feature == feature, ct);
        if (pref is null)
        {
            pref = new UserFeaturePreference(userId, feature);
            _db.UserFeaturePreferences.Add(pref);
        }
        pref.Select(providerConfigurationId, string.IsNullOrWhiteSpace(model) ? null : model);
        await _db.SaveChangesAsync(ct);
        return new FeaturePreferenceDto(feature, pref.ProviderConfigurationId, pref.Model);
    }

    public async Task<FeaturePreferenceDto?> GetFeaturePreferenceAsync(Guid userId, string feature, CancellationToken ct = default)
    {
        var pref = await _db.UserFeaturePreferences
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.Feature == feature, ct);
        return pref is null ? null : new FeaturePreferenceDto(feature, pref.ProviderConfigurationId, pref.Model);
    }

    // ── Usage + limits ──────────────────────────────────────────────────

    public async Task RecordUsageAsync(Guid userId, RecordUsageRequest req, CancellationToken ct = default)
    {
        var row = new AiUsageLog(
            userId,
            req.ProviderConfigurationId,
            req.ProviderType,
            req.Model,
            req.Feature);
        row.Record(
            req.InputTokens, req.OutputTokens, req.TotalTokens,
            req.Success, req.DurationMs,
            req.EstimatedCostUsd, req.ErrorCode,
            req.DocumentId, req.PageNumber);
        _db.AiUsageLogs.Add(row);
        await _db.SaveChangesAsync(ct);
    }

    public async Task<UsageSummaryDto> GetUsageAsync(Guid userId, Guid? providerId = null, CancellationToken ct = default)
    {
        IQueryable<AiUsageLog> q = _db.AiUsageLogs.Where(u => u.UserId == userId);
        if (providerId is Guid pid) q = q.Where(u => u.ProviderConfigurationId == pid);

        var rows = await q.AsNoTracking().ToListAsync(ct);
        var byProvider = new List<ProviderUsageDto>();
        foreach (var group in rows.GroupBy(u => u.ProviderType))
        {
            byProvider.Add(new ProviderUsageDto(
                group.Key,
                group.Count(),
                group.Count(u => u.Success),
                group.Count(u => !u.Success),
                group.Sum(u => u.TotalTokens ?? 0),
                group.Sum(u => u.InputTokens ?? 0),
                group.Sum(u => u.OutputTokens ?? 0),
                group.Where(u => u.EstimatedCostUsd.HasValue).Sum(u => u.EstimatedCostUsd.Value)));
        }

        return new UsageSummaryDto(
            rows.Count,
            rows.Count(u => u.Success),
            rows.Count(u => !u.Success),
            rows.Sum(u => u.TotalTokens ?? 0),
            rows.Sum(u => u.InputTokens ?? 0),
            rows.Sum(u => u.OutputTokens ?? 0),
            rows.Where(u => u.EstimatedCostUsd.HasValue).Sum(u => u.EstimatedCostUsd.Value),
            byProvider);
    }

    public async Task CaptureLimitsAsync(
        Guid userId,
        Guid providerConfigurationId,
        IReadOnlyDictionary<string, string> headers,
        CancellationToken ct = default)
    {
        if (headers is null || headers.Count == 0) return;
        var json = JsonSerializer.Serialize(new
        {
            snapshot_at = DateTime.UtcNow,
            values = headers,
        });
        _db.ProviderLimitSnapshots.Add(new ProviderLimitSnapshot(
            userId, providerConfigurationId, json));
        await _db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<LimitSnapshotDto>> GetLimitsAsync(
        Guid userId,
        Guid providerId,
        CancellationToken ct = default)
    {
        return await _db.ProviderLimitSnapshots
            .AsNoTracking()
            .Where(s => s.UserId == userId && s.ProviderConfigurationId == providerId)
            .OrderByDescending(s => s.CapturedAt)
            .Take(10)
            .Select(s => new LimitSnapshotDto(s.CapturedAt, s.SnapshotJson))
            .ToListAsync(ct);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /// <summary>Mask a stored (encrypted) key for display: gsk_****abcd. Null when no key.</summary>
    /// Decrypts ONLY to derive the display mask (the full key never leaves the
    /// process); returns null when there is no key or decryption fails.
    public static string? MaskKey(string? encryptedKey)
    {
        if (string.IsNullOrWhiteSpace(encryptedKey)) return null;
        return SafeMask(encryptedKey.Trim());
    }

    /// <summary>Instance helper: decrypt then mask so the UI shows gsk_****abcd derived from the real key.</summary>
    public string? MaskDecrypted(string? encryptedKey)
    {
        if (string.IsNullOrWhiteSpace(encryptedKey)) return null;
        try
        {
            return SafeMask(_encryption.Decrypt(encryptedKey));
        }
        catch
        {
            return "****";
        }
    }

    /// <summary>Mask any string to first4 + **** + last4 (or **** when too short).</summary>
    public static string SafeMask(string value)
    {
        var s = (value ?? "").Trim();
        if (s.Length <= 8) return "****";
        return s[..4] + "****" + s[^4..];
    }
}

// ── DTOs ─────────────────────────────────────────────────────────────────

public record ResolvedProvider(
    Guid ProviderConfigurationId,
    string ProviderType,
    string Model,
    string ApiKey,
    string? Endpoint,
    bool HasKey);

public record ProviderStatusDto(
    Guid Id,
    string ProviderType,
    string Model,
    string? Endpoint,
    bool HasKey,
    string? MaskedKey,
    bool IsEnabled,
    DateTime CreatedAt,
    IReadOnlyList<string> UsedForFeatures);

public record UpsertProviderRequest(
    string ProviderType,
    string? Model,
    string? Endpoint,
    string? ApiKey,
    double? Temperature,
    int? MaxTokens,
    int? TimeoutSeconds);

public record KeyTestResult(bool Valid, string ErrorCode, string? Error);

public record ProviderModelDto(
    string Id,
    string Name,
    IReadOnlyList<string> Capabilities,
    bool SupportsJsonOutput,
    bool FromFallback);

public record FeaturePreferenceDto(string Feature, Guid? ProviderConfigurationId, string? Model);

public record RecordUsageRequest(
    Guid? ProviderConfigurationId,
    string ProviderType,
    string? Model,
    string? Feature,
    int? InputTokens,
    int? OutputTokens,
    int? TotalTokens,
    bool Success,
    int DurationMs,
    decimal? EstimatedCostUsd,
    string? ErrorCode,
    Guid? DocumentId,
    int? PageNumber);

public record ProviderUsageDto(
    string ProviderType,
    int RequestCount,
    int SuccessCount,
    int FailedCount,
    int TotalTokens,
    int InputTokens,
    int OutputTokens,
    decimal EstimatedCostUsd);

public record UsageSummaryDto(
    int TotalRequests,
    int Successful,
    int Failed,
    int TotalTokens,
    int InputTokens,
    int OutputTokens,
    decimal EstimatedCostUsd,
    IReadOnlyList<ProviderUsageDto> ByProvider);

public record LimitSnapshotDto(DateTime CapturedAt, string SnapshotJson);

// ── Engine response DTOs (camelCase from /internal/ai/*) ───────────────

public class KeyTestResultDto
{
    public bool Valid { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("error_code")]
    public string? ErrorCode { get; set; }
    public string? Error { get; set; }
}

public class ModelListDto
{
    public List<ModelItemDto>? Models { get; set; }
}

public class ModelItemDto
{
    public string? Id { get; set; }
    public string? Name { get; set; }
    public List<string>? Capabilities { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("supports_json_output")]
    public bool? SupportsJsonOutput { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("from_fallback")]
    public bool? FromFallback { get; set; }
}
