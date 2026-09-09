using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Integrations;

/// <summary>Carries Slack's ok:false error string (e.g. "name_taken",
/// "channel_not_found", "invalid_auth").</summary>
public class SlackApiException : Exception
{
    public string SlackError { get; }
    public bool IsRateLimited => SlackError == "rate_limited";

    public SlackApiException(string slackError)
        : base($"Slack API error: {slackError}")
    {
        SlackError = slackError;
    }
}

/// <summary>
/// Slack channel naming: #deal-{product}-{buyer-company}, falling back to
/// #deal-{product}-general when no buyer company is known. Slack channel
/// names must be lowercase, ≤ 80 chars, letters/numbers/hyphens only.
/// </summary>
public static class SlackChannelName
{
    public const int MaxLength = 80;

    public static string From(string product, string? buyerCompany)
    {
        var productSlug = Slugify(product);
        var companySlug = string.IsNullOrWhiteSpace(buyerCompany) ? null : Slugify(buyerCompany);

        var name = string.IsNullOrEmpty(companySlug)
            ? $"deal-{productSlug}-general"
            : $"deal-{productSlug}-{companySlug}";

        // Truncate before stripping so the result never ends on a hyphen.
        if (name.Length > MaxLength) name = name[..MaxLength];
        return name.Trim('-');
    }

    private static string Slugify(string value)
    {
        var slug = new string((value ?? string.Empty).ToLowerInvariant()
            .Select(c => char.IsAsciiLetterOrDigit(c) ? c : '-')
            .ToArray());

        var sb = new System.Text.StringBuilder(slug.Length);
        foreach (var c in slug)
        {
            if (c != '-' || sb.Length == 0 || sb[^1] != '-') sb.Append(c);
        }
        return sb.ToString().Trim('-');
    }
}

/// <summary>
/// Thin typed client over the Slack Web API. Every method resolves the
/// caller's bot token via SlackTokenService — callers never touch the raw
/// token. Non-ok responses raise SlackApiException so the worker can decide
/// (log + skip; rate_limited → re-enqueue once).
/// </summary>
public class SlackApiClient
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);
    private const int MaxChannelsToList = 200;

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SlackTokenService _tokenService;
    private readonly IMemoryCache _channelCache;
    private readonly ILogger<SlackApiClient> _logger;

    public SlackApiClient(
        IHttpClientFactory httpClientFactory,
        SlackTokenService tokenService,
        IMemoryCache channelCache,
        ILogger<SlackApiClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _tokenService = tokenService;
        _channelCache = channelCache;
        _logger = logger;
    }

    /// <summary>POST chat.postMessage. Returns the message ts, or throws.</summary>
    public virtual async Task<string?> PostMessageAsync(Guid userId, string channelId, object[] blocks, string? text = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["channel"] = channelId,
            ["blocks"] = blocks,
            // Fallback notification text (Block Kit requires a text fallback
            // for clients that cannot render blocks).
            ["text"] = text ?? "Reppify deal signal",
        };
        var response = await CallAsync(userId, "chat.postMessage", body);
        return response.TryGetValue("ts", out var ts) && ts.ValueKind == JsonValueKind.String
            ? ts.GetString()
            : null;
    }

    /// <summary>
    /// Resolves (or creates) a channel by name. Lookup results are cached
    /// 30 min — channel names are stable per deal and list/create are not free.
    /// </summary>
    public virtual async Task<string> FindOrCreateChannelAsync(Guid userId, string channelName)
    {
        var cacheKey = $"slack-channel-{channelName.ToLowerInvariant()}";
        if (_channelCache.TryGetValue(cacheKey, out string? cached) && cached is not null)
        {
            return cached;
        }

        var existing = await FindChannelAsync(userId, channelName);
        if (existing is not null)
        {
            _channelCache.Set(cacheKey, existing, CacheTtl);
            return existing;
        }

        try
        {
            var created = await CallAsync(userId, "conversations.create",
                new Dictionary<string, object?> { ["name"] = channelName, ["is_private"] = false });
            var id = created.TryGetValue("channel", out var channel)
                     && channel.ValueKind == JsonValueKind.Object
                     && channel.TryGetProperty("id", out var cid)
                     && cid.ValueKind == JsonValueKind.String
                ? cid.GetString()
                : throw new SlackApiException("create_returned_no_channel_id");
            _logger.LogInformation("Created Slack channel #{Channel} ({Id})", channelName, id);
            _channelCache.Set(cacheKey, id!, CacheTtl);
            return id!;
        }
        catch (SlackApiException ex) when (ex.SlackError == "name_taken")
        {
            // Race: another process created the channel between our list and
            // create. Re-lookup once.
            var raced = await FindChannelAsync(userId, channelName)
                ?? throw new SlackApiException("name_taken_but_not_listed");
            _channelCache.Set(cacheKey, raced, CacheTtl);
            return raced;
        }
    }

    private async Task<string?> FindChannelAsync(Guid userId, string channelName)
    {
        string? cursor = null;
        do
        {
            var query = $"conversations.list?types=public_channel,private_channel&limit={MaxChannelsToList}"
                        + (cursor is null ? "" : $"&cursor={Uri.EscapeDataString(cursor)}");
            var page = await CallAsync(userId, query, body: null, httpMethod: HttpMethod.Get);

            if (page.TryGetValue("channels", out var channels) && channels.ValueKind == JsonValueKind.Array)
            {
                foreach (var channel in channels.EnumerateArray())
                {
                    var name = channel.TryGetProperty("name", out var n) ? n.GetString() : null;
                    var id = channel.TryGetProperty("id", out var i) ? i.GetString() : null;
                    if (name is not null && id is not null &&
                        name.Equals(channelName, StringComparison.OrdinalIgnoreCase))
                    {
                        return id;
                    }
                }
            }

            cursor = page.TryGetValue("response_metadata", out var rm)
                     && rm.ValueKind == JsonValueKind.Object
                     && rm.TryGetProperty("next_cursor", out var nc)
                     && nc.ValueKind == JsonValueKind.String
                ? nc.GetString()
                : null;
        } while (!string.IsNullOrEmpty(cursor));

        return null;
    }

    private async Task<Dictionary<string, JsonElement>> CallAsync(
        Guid userId, string method, Dictionary<string, object?>? body, HttpMethod? httpMethod = null)
    {
        var token = await _tokenService.GetDecryptedTokenAsync(userId)
            ?? throw new SlackApiException("not_connected");

        var client = _httpClientFactory.CreateClient("SlackApi");
        using var request = new HttpRequestMessage(httpMethod ?? HttpMethod.Post, method);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        using var response = await client.SendAsync(request);
        if ((int)response.StatusCode == 429)
        {
            throw new SlackApiException("rate_limited");
        }
        if (!response.IsSuccessStatusCode)
        {
            throw new SlackApiException($"http_{(int)response.StatusCode}");
        }

        var payload = await response.Content
            .ReadFromJsonAsync<Dictionary<string, JsonElement>>() ?? new();
        if (payload.TryGetValue("ok", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            var error = payload.TryGetValue("error", out var e) && e.ValueKind == JsonValueKind.String
                ? e.GetString() ?? "unknown"
                : "unknown";
            throw new SlackApiException(error);
        }
        return payload;
    }
}
