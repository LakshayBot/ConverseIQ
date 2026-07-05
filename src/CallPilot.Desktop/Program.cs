using System.CommandLine;
using CallPilot.Desktop.Audio;
using CallPilot.Desktop.Models;
using CallPilot.Desktop.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Serilog;

var agentConfig = new AgentConfiguration();

var serverUrlOption = new Option<string>("--server-url", () => "http://localhost:5000", "CallPilot Server URL");
var emailOption = new Option<string>("--email", "Account email address");
var passwordOption = new Option<string>("--password", "Account password");
var micOption = new Option<bool>("--enable-mic", () => true, "Enable microphone capture");
var desktopAudioOption = new Option<bool>("--enable-desktop-audio", () => true, "Enable desktop audio capture");

var rootCommand = new RootCommand("CallPilot Desktop Agent - Real-time audio streaming client");

var startCommand = new Command("start", "Start audio streaming session")
{
    serverUrlOption,
    emailOption,
    passwordOption,
    micOption,
    desktopAudioOption
};

startCommand.SetHandler(async (serverUrl, email, password, enableMic, enableDesktopAudio) =>
{
    Log.Logger = new LoggerConfiguration()
        .MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/callpilot-desktop-.log", rollingInterval: RollingInterval.Day)
        .CreateLogger();

    try
    {
        agentConfig.ServerUrl = serverUrl;
        agentConfig.EnableMicrophone = enableMic;
        agentConfig.EnableDesktopAudio = enableDesktopAudio;

        var services = new ServiceCollection();

        ConfigureServices(services, agentConfig);

        var provider = services.BuildServiceProvider();
        var logger = provider.GetRequiredService<ILogger<Program>>();

        logger.LogInformation("CallPilot Desktop Agent v0.1.0");
        logger.LogInformation("Server: {ServerUrl}", serverUrl);
        logger.LogInformation("Microphone: {Mic}, Desktop Audio: {DesktopAudio}", enableMic, enableDesktopAudio);

        var sessionManager = provider.GetRequiredService<SessionManager>();

        Console.CancelKeyPress += async (_, args) =>
        {
            args.Cancel = true;
            logger.LogInformation("Shutdown requested...");
            await sessionManager.StopAsync();
        };

        var cts = new CancellationTokenSource();

        logger.LogInformation("Logging in as {Email}...", email);
        await sessionManager.StartAsync(email, password, cts.Token);

        logger.LogInformation("Press Ctrl+C to stop streaming.");

        await Task.Delay(Timeout.Infinite, cts.Token);
    }
    catch (OperationCanceledException)
    {
        Log.Information("Shutdown complete");
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Fatal error");
    }
    finally
    {
        Log.CloseAndFlush();
    }
}, serverUrlOption, emailOption, passwordOption, micOption, desktopAudioOption);

rootCommand.AddCommand(startCommand);

return await rootCommand.InvokeAsync(args);

static void ConfigureServices(ServiceCollection services, AgentConfiguration config)
{
    services.AddSingleton(config);

    services.AddHttpClient<AuthenticationService>(client =>
    {
        client.BaseAddress = new Uri(config.ServerUrl);
        client.Timeout = TimeSpan.FromSeconds(30);
    });

    services.AddSingleton<SignalRConnectionService>();
    services.AddSingleton<SessionManager>();
    services.AddSingleton<IAudioCaptureService, FfmpegAudioCaptureService>();

    services.AddLogging(builder =>
    {
        builder.ClearProviders();
        builder.AddSerilog();
    });
}

public partial class Program { }
