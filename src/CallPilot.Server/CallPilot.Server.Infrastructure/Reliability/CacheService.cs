using Microsoft.Extensions.Caching.Memory;

namespace CallPilot.Server.Infrastructure.Reliability;

public class CacheService
{
    private readonly IMemoryCache _cache;
    private static readonly MemoryCacheEntryOptions DefaultOptions = new()
    {
        SlidingExpiration = TimeSpan.FromMinutes(30),
        AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(2),
    };

    public CacheService(IMemoryCache cache)
    {
        _cache = cache;
    }

    public T? GetOrCreate<T>(string key, Func<T> factory)
    {
        if (_cache.TryGetValue(key, out T? value) && value is not null)
            return value;

        value = factory();
        _cache.Set(key, value, DefaultOptions);
        return value;
    }

    public async Task<T?> GetOrCreateAsync<T>(string key, Func<Task<T>> factory)
    {
        if (_cache.TryGetValue(key, out T? value) && value is not null)
            return value;

        value = await factory();
        _cache.Set(key, value, DefaultOptions);
        return value;
    }

    public void Invalidate(string key)
    {
        _cache.Remove(key);
    }

    public void InvalidateByPrefix(string prefix)
    {
        // Simple invalidation — only works with keys that are directly stored
        _cache.Remove(prefix);
    }
}
