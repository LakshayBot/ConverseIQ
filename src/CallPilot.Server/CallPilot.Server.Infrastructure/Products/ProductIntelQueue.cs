using System.Threading.Channels;

namespace CallPilot.Server.Infrastructure.Products;

/// <summary>An enrichment request for a canonical product, scoped to a
/// company knowledge base and (when applicable) the source document.</summary>
public readonly record struct ProductIntelRequest(
    string CanonicalName,
    string? Context,
    bool Force = false,
    Guid? KnowledgeBaseId = null,
    string? CompanyName = null,
    Guid? DocumentId = null);

/// <summary>
/// Singleton background queue for product enrichment. Enrichment must never
/// block the transcript/detection/ingest pipeline, and the same product must
/// never be researched twice concurrently. The in-flight guard + unbounded
/// channel provide both: Enqueue() is a no-op when the product is already
/// queued or being processed. The guard is keyed by (company, canonical name)
/// so two companies' identically-named products enrich independently, and a
/// document-scoped request only ever updates that document's per-product
/// status.
/// </summary>
public class ProductIntelQueue
{
    private readonly Channel<ProductIntelRequest> _channel = Channel.CreateUnbounded<ProductIntelRequest>();
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte> _inFlight =
        new(StringComparer.OrdinalIgnoreCase);

    public void Enqueue(
        string canonicalName,
        string? context = null,
        bool force = false,
        Guid? knowledgeBaseId = null,
        string? companyName = null,
        Guid? documentId = null)
    {
        if (string.IsNullOrWhiteSpace(canonicalName)) return;
        var key = ScopeKey(canonicalName, companyName);
        if (!_inFlight.TryAdd(key, 0)) return; // already queued / processing
        if (!_channel.Writer.TryWrite(new ProductIntelRequest(canonicalName, context, force, knowledgeBaseId, companyName, documentId)))
        {
            _inFlight.TryRemove(key, out _);
        }
    }

    public async ValueTask<ProductIntelRequest?> DequeueAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await _channel.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (ChannelClosedException)
        {
            return null;
        }
    }

    public void Release(string canonicalName, string? companyName)
    {
        _inFlight.TryRemove(ScopeKey(canonicalName, companyName), out _);
    }

    private static string ScopeKey(string canonicalName, string? companyName)
        => string.IsNullOrWhiteSpace(companyName)
            ? canonicalName
            : $"{companyName.Trim().ToLowerInvariant()}\u0000{canonicalName.Trim().ToLowerInvariant()}";
}
