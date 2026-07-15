using System.Net.Http.Json;
using CallPilot.Server.Domain.Providers;
using CallPilot.Server.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.AI;

public class LlmService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly CallPilotDbContext _dbContext;
    private readonly ILogger<LlmService> _logger;

    public LlmService(
        IHttpClientFactory httpClientFactory,
        CallPilotDbContext dbContext,
        ILogger<LlmService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<string?> GenerateResponseAsync(Guid userId, string prompt)
    {
        try
        {
            var provider = await _dbContext.ProviderConfigurations
                .FirstOrDefaultAsync(p => p.UserId == userId && p.IsEnabled);

            if (provider is null) return null;

            return provider.ProviderType.ToLowerInvariant() switch
            {
                "ollama" => await CallOllamaAsync(provider, prompt),
                "deepseek" => await CallDeepSeekAsync(provider, prompt),
                "openai" => await CallOpenAiAsync(provider, prompt),
                _ => null,
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LLM generation failed");
            return null;
        }
    }

    public async Task<string?> GenerateResponseForAnyProviderAsync(string prompt)
    {
        try
        {
            var provider = await _dbContext.ProviderConfigurations
                .FirstOrDefaultAsync(p => p.IsEnabled);

            if (provider is null) return null;

            return provider.ProviderType.ToLowerInvariant() switch
            {
                "ollama" => await CallOllamaAsync(provider, prompt),
                "deepseek" => await CallDeepSeekAsync(provider, prompt),
                "openai" => await CallOpenAiAsync(provider, prompt),
                _ => null,
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LLM generation for any provider failed");
            return null;
        }
    }

    private async Task<string?> CallOllamaAsync(ProviderConfiguration provider, string prompt)
    {
        var client = _httpClientFactory.CreateClient("LlmClient");
        var endpoint = provider.Endpoint ?? "http://localhost:11434";

        var response = await client.PostAsJsonAsync($"{endpoint}/api/generate", new
        {
            model = provider.Model,
            prompt,
            stream = false,
            options = new { temperature = provider.Temperature }
        });

        if (!response.IsSuccessStatusCode) return null;

        var result = await response.Content.ReadFromJsonAsync<OllamaResponse>();
        return result?.Response;
    }

    private async Task<string?> CallDeepSeekAsync(ProviderConfiguration provider, string prompt)
    {
        var client = _httpClientFactory.CreateClient("LlmClient");
        var endpoint = provider.Endpoint ?? "https://api.deepseek.com/v1";

        var response = await client.PostAsJsonAsync($"{endpoint}/chat/completions", new
        {
            model = provider.Model,
            messages = new[]
            {
                new { role = "user", content = prompt }
            },
            temperature = provider.Temperature,
            max_tokens = provider.MaxTokens,
        });

        if (!response.IsSuccessStatusCode) return null;

        var result = await response.Content.ReadFromJsonAsync<ChatCompletionResponse>();
        return result?.Choices?.FirstOrDefault()?.Message?.Content;
    }

    private async Task<string?> CallOpenAiAsync(ProviderConfiguration provider, string prompt)
    {
        return await CallDeepSeekAsync(provider, prompt); // Same API format
    }

    private class OllamaResponse
    {
        public string? Response { get; set; }
    }

    private class ChatCompletionResponse
    {
        public List<Choice>? Choices { get; set; }

        public class Choice
        {
            public Message? Message { get; set; }
        }

        public class Message
        {
            public string? Content { get; set; }
        }
    }
}
