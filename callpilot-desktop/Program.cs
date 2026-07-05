using CallPilot.Desktop.AudioCapture;
using CallPilot.Desktop.Models;
using CallPilot.Desktop.Services;
using Microsoft.Extensions.Logging;

var baseUrl = args.Length > 0 ? args[0] : "http://localhost:5000";
var email = args.Length > 1 ? args[1] : "dev@callpilot.ai";
var password = args.Length > 2 ? args[2] : "devpassword";

using var loggerFactory = LoggerFactory.Create(builder => builder.AddConsole());
var logger = loggerFactory.CreateLogger("CallPilot.Desktop");

logger.LogInformation("CallPilot Desktop Agent v1.0.0");
logger.LogInformation("Connecting to server: {Url}", baseUrl);

var auth = new AuthService(baseUrl);
var token = await auth.LoginAsync(email, password);

if (token is null)
{
    logger.LogError("Authentication failed");
    return 1;
}

logger.LogInformation("Authenticated successfully");

var signalR = new SignalRClient($"{baseUrl}/hubs/meeting", token, loggerFactory.CreateLogger<SignalRClient>());

signalR.Disconnected += (_, _) => logger.LogWarning("Disconnected from server");
signalR.Reconnecting += (_, _) => logger.LogInformation("Reconnecting...");
signalR.Reconnected += (_, _) => logger.LogInformation("Reconnected");

await signalR.ConnectAsync();
await signalR.RegisterAgent(new AgentInfo());

var mic = new MicrophoneCapture();
var desktop = new DesktopAudioCapture();

mic.AudioDataAvailable += async (_, data) =>
{
    var frame = new AudioFrame { Audio = data };
    await signalR.SendAudioFrame(frame);
};

desktop.AudioDataAvailable += async (_, data) =>
{
    var frame = new AudioFrame { Audio = data };
    await signalR.SendAudioFrame(frame);
};

mic.Start();
desktop.Start();

logger.LogInformation("Agent running. Press Ctrl+C to stop.");

var tcs = new TaskCompletionSource();
Console.CancelKeyPress += (_, _) =>
{
    logger.LogInformation("Shutting down...");
    mic.Stop();
    desktop.Stop();
    tcs.TrySetResult();
};

await tcs.Task;
await signalR.StopAsync();
logger.LogInformation("Agent stopped");
return 0;
