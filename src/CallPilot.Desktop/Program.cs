using System.CommandLine;
using System.CommandLine.Invocation;
using CallPilot.Desktop.Audio;
using CallPilot.Desktop.Models;
using CallPilot.Desktop.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Serilog;

var agentConfig = new AgentConfiguration();

var serverUrlOption = new Option<string>("--server-url", () => "http://localhost:5001", "CallPilot Server URL");
var emailOption = new Option<string>("--email", "Account email address");
var passwordOption = new Option<string>("--password", "Account password");
var meetingIdOption = new Option<string?>("--meeting-id", "Existing meeting ID (creates new if not provided)");
var micOption = new Option<bool>("--enable-mic", () => true, "Enable microphone capture");
var desktopAudioOption = new Option<bool>("--enable-desktop-audio", () => true, "Enable desktop audio capture");

var rootCommand = new RootCommand("CallPilot Desktop Agent - Real-time audio streaming client");

var micDeviceOption = new Option<string?>("--mic-device", () => null, "avfoundation audio device index (e.g. ':1' for MacBook mic). Run with --list-devices to see options");
var fileInputOption = new Option<string?>("--file-input", () => null, "Play audio file through the pipeline (MP3/WAV/etc.) - no physical device needed");
var sourceOption = new Option<string>("--source", () => "microphone", "Audio source type: 'microphone' (your voice → 'Salesperson') or 'desktop' (speaker audio → 'Customer-1')");
var listDevicesOption = new Option<bool>("--list-devices", () => false, "List available audio capture devices and exit");

rootCommand.AddOption(listDevicesOption);
rootCommand.SetHandler((listDevices) =>
{
    if (listDevices)
    {
        FfmpegAudioCaptureService.ListDevices();
        Environment.Exit(0);
    }
}, listDevicesOption);

var startCommand = new Command("start", "Start audio streaming session")
{
    serverUrlOption,
    emailOption,
    passwordOption,
    meetingIdOption,
    micOption,
    desktopAudioOption,
    micDeviceOption,
    fileInputOption,
    sourceOption,
};

startCommand.SetHandler(async (context) =>
{
    var serverUrl = context.ParseResult.GetValueForOption(serverUrlOption);
    var email = context.ParseResult.GetValueForOption(emailOption);
    var password = context.ParseResult.GetValueForOption(passwordOption);
    var meetingId = context.ParseResult.GetValueForOption(meetingIdOption);
    var enableMic = context.ParseResult.GetValueForOption(micOption);
    var enableDesktopAudio = context.ParseResult.GetValueForOption(desktopAudioOption);
    var micDevice = context.ParseResult.GetValueForOption(micDeviceOption);
    var fileInput = context.ParseResult.GetValueForOption(fileInputOption);
    var source = context.ParseResult.GetValueForOption(sourceOption);

    Log.Logger = new LoggerConfiguration()
        .MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/callpilot-desktop-.log", rollingInterval: RollingInterval.Day)
        .CreateLogger();

    SessionManager? sessionManager = null;

    try
    {
        agentConfig.ServerUrl = serverUrl;
        agentConfig.EnableMicrophone = enableMic;
        agentConfig.EnableDesktopAudio = enableDesktopAudio;
        agentConfig.AudioSource = source;
        if (!string.IsNullOrEmpty(fileInput)) agentConfig.FileInput = fileInput;
        if (!string.IsNullOrEmpty(meetingId)) agentConfig.MeetingId = meetingId;
        if (!string.IsNullOrEmpty(micDevice))
        {
            agentConfig.MicrophoneDevice = micDevice;
        }

        var services = new ServiceCollection();
        ConfigureServices(services, agentConfig);
        var provider = services.BuildServiceProvider();
        var logger = provider.GetRequiredService<ILogger<Program>>();

        logger.LogInformation("CallPilot Desktop Agent v0.1.0");
        logger.LogInformation("Server: {ServerUrl}", serverUrl);
        logger.LogInformation("Microphone: {Mic}, Desktop Audio: {DesktopAudio}, Source: {Source}", enableMic, enableDesktopAudio, source);

        sessionManager = provider.GetRequiredService<SessionManager>();

        using var shutdownCts = new CancellationTokenSource();

        Console.CancelKeyPress += (_, args) =>
        {
            args.Cancel = true;
            logger.LogInformation("Shutdown requested...");
            shutdownCts.Cancel();
        };

        logger.LogInformation("Logging in as {Email}...", email);
        await sessionManager.StartAsync(email, password, shutdownCts.Token);

        logger.LogInformation("Press Ctrl+C to stop streaming.");

        try
        {
            await Task.Delay(Timeout.Infinite, shutdownCts.Token);
        }
        catch (OperationCanceledException) { }
    }
    catch (OperationCanceledException) { }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Fatal error");
    }
    finally
    {
        if (sessionManager is not null)
        {
            try { await sessionManager.StopAsync(); } catch { }
        }
        Log.Information("Shutdown complete");
        Log.CloseAndFlush();
    }
});

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
