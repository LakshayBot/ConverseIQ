using CallPilot.Server.Application.Providers.Create;
using CallPilot.Server.Application.Providers.Delete;
using CallPilot.Server.Application.Providers.List;
using CallPilot.Server.Domain.Users;
using CallPilot.Server.Infrastructure.Data;
using CallPilot.Server.Infrastructure.Encryption;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace CallPilot.Server.Tests.Providers;

public class ProviderTests : IAsyncLifetime
{
    private readonly CallPilotDbContext _dbContext;
    private readonly ApiKeyEncryptionService _encryptionService;
    private Guid _userId;

    public ProviderTests()
    {
        var options = new DbContextOptionsBuilder<CallPilotDbContext>()
            .UseInMemoryDatabase($"CallPilot_Provider_Test_{Guid.NewGuid()}")
            .Options;

        _dbContext = new CallPilotDbContext(options);

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "Encryption:Key", "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=" }
            })
            .Build();

        _encryptionService = new ApiKeyEncryptionService(configuration);
    }

    public async Task InitializeAsync()
    {
        var user = new User("provider-test@example.com", "hashedpassword");
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
    }

    public async Task DisposeAsync()
    {
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task Create_NewProvider_PersistsSuccessfully()
    {
        var handler = new CreateProviderHandler(_dbContext, _encryptionService);
        var command = new CreateProviderCommand(
            "DeepSeek", "deepseek-chat", "https://api.deepseek.com/v1",
            "sk-test-api-key-12345", 0.7, 4096, 30);

        var result = await handler.HandleAsync(_userId, command);

        Assert.NotNull(result);
        Assert.Equal("DeepSeek", result.ProviderType);
        Assert.Equal("deepseek-chat", result.Model);
        Assert.True(result.IsEnabled);

        var saved = await _dbContext.ProviderConfigurations
            .FirstOrDefaultAsync(p => p.UserId == _userId);
        Assert.NotNull(saved);
        Assert.NotEqual("sk-test-api-key-12345", saved.EncryptedApiKey);
    }

    [Fact]
    public async Task Create_ExistingProvider_UpdatesConfiguration()
    {
        var handler = new CreateProviderHandler(_dbContext, _encryptionService);

        var createCmd = new CreateProviderCommand(
            "DeepSeek", "deepseek-chat", "https://api.deepseek.com/v1",
            "sk-old-key", 0.5, 2048, 15);

        var first = await handler.HandleAsync(_userId, createCmd);

        var updateCmd = new CreateProviderCommand(
            "DeepSeek", "deepseek-v3", "https://new-api.deepseek.com/v1",
            "sk-new-key", 0.8, 8192, 60);

        var second = await handler.HandleAsync(_userId, updateCmd);

        Assert.Equal(first.Id, second.Id);
        Assert.Equal("deepseek-v3", second.Model);
        Assert.Equal("https://new-api.deepseek.com/v1", second.Endpoint);

        var saved = await _dbContext.ProviderConfigurations
            .FirstOrDefaultAsync(p => p.Id == first.Id);
        Assert.Equal("deepseek-v3", saved!.Model);
    }

    [Fact]
    public async Task List_ReturnsUserProviders()
    {
        var handler = new CreateProviderHandler(_dbContext, _encryptionService);
        await handler.HandleAsync(_userId, new CreateProviderCommand(
            "DeepSeek", "deepseek-chat", null, "sk-key-1", 0.7, 4096, 30));

        await handler.HandleAsync(_userId, new CreateProviderCommand(
            "Ollama", "llama3.2", "http://localhost:11434", "none", 0.3, 2048, 60));

        var listHandler = new ListProvidersHandler(_dbContext);
        var results = await listHandler.HandleAsync(_userId);

        Assert.Equal(2, results.Count);
        Assert.Contains(results, p => p.ProviderType == "DeepSeek");
        Assert.Contains(results, p => p.ProviderType == "Ollama");
    }

    [Fact]
    public async Task List_EmptyForNewUser()
    {
        var listHandler = new ListProvidersHandler(_dbContext);
        var results = await listHandler.HandleAsync(_userId);

        Assert.Empty(results);
    }

    [Fact]
    public async Task Delete_ExistingProvider_RemovesSuccessfully()
    {
        var createHandler = new CreateProviderHandler(_dbContext, _encryptionService);
        var result = await createHandler.HandleAsync(_userId, new CreateProviderCommand(
            "DeepSeek", "deepseek-chat", null, "sk-test-key", 0.7, 4096, 30));

        var deleteHandler = new DeleteProviderHandler(_dbContext);
        await deleteHandler.HandleAsync(_userId, result.Id);

        var saved = await _dbContext.ProviderConfigurations
            .FirstOrDefaultAsync(p => p.Id == result.Id);
        Assert.Null(saved);
    }

    [Fact]
    public async Task Delete_NonexistentProvider_ThrowsNotFoundException()
    {
        var deleteHandler = new DeleteProviderHandler(_dbContext);

        await Assert.ThrowsAsync<KeyNotFoundException>(
            () => deleteHandler.HandleAsync(_userId, Guid.NewGuid()));
    }

    [Fact]
    public async Task Delete_WrongUser_ThrowsNotFoundException()
    {
        var createHandler = new CreateProviderHandler(_dbContext, _encryptionService);
        var result = await createHandler.HandleAsync(_userId, new CreateProviderCommand(
            "DeepSeek", "deepseek-chat", null, "sk-key", 0.7, 4096, 30));

        var deleteHandler = new DeleteProviderHandler(_dbContext);

        await Assert.ThrowsAsync<KeyNotFoundException>(
            () => deleteHandler.HandleAsync(Guid.NewGuid(), result.Id));
    }

    [Fact]
    public async Task Encryption_RoundTrip_PreservesApiKey()
    {
        const string apiKey = "sk-proj-abc123verysecretapikey-for-testing";

        var encrypted = _encryptionService.Encrypt(apiKey);
        var decrypted = _encryptionService.Decrypt(encrypted);

        Assert.Equal(apiKey, decrypted);
        Assert.NotEqual(apiKey, encrypted);
    }
}
