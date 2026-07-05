# 03_Desktop_Agent.md

**Document Status**

Version: 1.0

Status: Approved

---

# 1. Purpose

The Desktop Agent is a lightweight native application responsible for capturing live audio from the user's computer and securely streaming it to the CallPilot AI Backend.

The Desktop Agent is intentionally designed as a **headless CLI application**.

It contains **no AI logic**, **no business logic**, and **no meeting intelligence**.

Its only responsibility is reliable, low-latency audio acquisition and streaming.

The Desktop Agent is the only component of the platform that has direct access to the operating system's audio devices.

---

# 2. Design Philosophy

The Desktop Agent follows the Unix philosophy:

> **Do one thing and do it exceptionally well.**

It should:

- Start instantly.
- Consume minimal CPU.
- Consume minimal memory.
- Recover automatically from failures.
- Operate silently.
- Require minimal user interaction.

It should never become another desktop application with complex UI.

---

# 3. Technology Stack

Framework

- .NET 9

Language

- C#

Operating System (Phase 1)

- Windows 11
- Windows 10

Future Support

- Linux
- macOS

Audio APIs

- Windows WASAPI
- WASAPI Loopback

Networking

- Secure WebSockets

Authentication

- JWT

Configuration

- Local encrypted configuration file

Logging

- Serilog

Packaging

- Self-contained executable

---

# 4. Responsibilities

The Desktop Agent is responsible for:

- Capturing microphone audio.
- Capturing desktop/system audio.
- Detecting available audio devices.
- Managing authentication.
- Streaming audio.
- Monitoring connection health.
- Automatic reconnection.
- Local buffering.
- Session lifecycle management.
- Diagnostics.

It is **not** responsible for:

- Speech recognition.
- AI reasoning.
- RAG.
- Event detection.
- Business logic.
- Dashboard rendering.
- Database access.

---

# 5. High-Level Architecture

```
                 Desktop Agent

         ┌────────────────────────┐
         │                        │
         │ Device Manager         │
         │                        │
         ├────────────────────────┤
         │ Audio Capture          │
         ├────────────────────────┤
         │ Stream Manager         │
         ├────────────────────────┤
         │ Authentication         │
         ├────────────────────────┤
         │ Buffer Manager         │
         ├────────────────────────┤
         │ Health Monitor         │
         ├────────────────────────┤
         │ Diagnostics            │
         └────────────────────────┘
```

Every module must remain independent.

---

# 6. Internal Modules

## Device Manager

Responsibilities

- Detect microphone devices.
- Detect playback devices.
- Detect default device changes.
- Validate device availability.
- Handle hot plugging.

Future versions may support manual device selection.

---

## Audio Capture

Responsible for capturing:

### Microphone

Input from the user's microphone.

Purpose

Salesperson speech.

---

### Desktop Audio

Captured using Windows WASAPI Loopback.

Purpose

Customer audio from:

- Microsoft Teams
- Zoom
- Google Meet
- Slack
- Discord
- Browser meetings
- Any desktop application

Desktop audio should never require browser extensions.

---

## Stream Manager

Responsible for:

- Encoding audio.
- Chunking audio.
- Streaming audio.
- Retry logic.
- Packet ordering.
- Connection monitoring.

---

## Authentication Manager

Responsible for:

- Login.
- Token refresh.
- Token validation.
- Secure storage.

The Desktop Agent never stores plaintext credentials.

---

## Buffer Manager

Purpose

Prevent data loss during temporary network interruptions.

Responsibilities

- Temporary in-memory buffering.
- Packet ordering.
- Retry transmission.

Audio should be discarded if buffering exceeds configurable limits.

The Desktop Agent is not intended to become a recording application.

---

## Health Monitor

Continuously monitors:

- Audio devices.
- Network connection.
- Backend availability.
- Authentication state.
- Stream health.

Failures should trigger automatic recovery whenever possible.

---

## Diagnostics

Collect runtime metrics.

Examples

- Audio bitrate.
- Packet loss.
- Latency.
- Reconnect count.
- Session uptime.

No customer audio should ever appear in diagnostic logs.

---

# 7. Audio Pipeline

```
Microphone

↓

Capture

↓

Chunk

↓

Encode

↓

Buffer

↓

Secure WebSocket

↓

Backend API
```

Desktop audio follows the identical pipeline.

---

# 8. Audio Channels

Microphone audio and desktop audio must remain separate.

```
Microphone

↓

Channel A

-----------------------

Desktop Audio

↓

Channel B
```

Channels should never be mixed locally.

Maintaining separate channels simplifies:

- Speaker attribution.
- Debugging.
- Future enhancements.

---

# 9. Audio Format

The agent should standardize audio before transmission.

Target format

- PCM
- Mono
- 16-bit
- 16 kHz (configurable)

The format should match the requirements of the Speech-to-Text engine.

---

# 10. Streaming Strategy

Audio should be streamed continuously.

The Desktop Agent should never wait for the meeting to finish.

Recommended chunk duration

- 20–100 milliseconds

Chunk size must be configurable.

Smaller chunks reduce latency but increase network overhead.

---

# 11. Session Lifecycle

### Start

1. User authenticates.
2. Agent validates configuration.
3. Devices are initialized.
4. WebSocket connection established.
5. Audio capture begins.

---

### Running

- Capture audio.
- Stream continuously.
- Monitor health.
- Recover automatically.

---

### Stop

- Flush pending packets.
- Close WebSocket.
- Release devices.
- End session cleanly.

---

# 12. Authentication Flow

```
Desktop Agent

↓

Login

↓

Backend API

↓

JWT

↓

Encrypted Local Storage

↓

Authenticated Streaming
```

The Desktop Agent should automatically refresh expired tokens.

---

# 13. Connection Recovery

If the Backend becomes unavailable:

1. Continue buffering temporarily.
2. Attempt reconnect using exponential backoff.
3. Resume streaming when connected.
4. Discard expired buffered audio.

Users should not be required to restart the agent.

---

# 14. Configuration

Configuration should include:

- Backend URL
- User authentication
- Selected microphone
- Selected playback device
- Audio quality
- Chunk duration
- Log level

Sensitive values must be encrypted locally.

No API keys should be stored inside the Desktop Agent.

---

# 15. Logging

Logs must be structured.

Include

- Timestamp
- Session ID
- Connection State
- Device Status
- Errors
- Performance Metrics

Never log:

- Audio
- JWT tokens
- User passwords
- API keys

---

# 16. Security

The Desktop Agent must:

- Validate server certificates.
- Use secure WebSockets (WSS).
- Encrypt stored tokens.
- Validate JWT expiration.
- Prevent unauthorized streaming.

All outbound communication must use TLS.

---

# 17. Performance Targets

Startup time

< 2 seconds

Memory usage

< 100 MB (target)

CPU usage

As low as reasonably possible during idle streaming.

End-to-end capture overhead

Negligible compared to AI processing.

The Desktop Agent should never become the performance bottleneck.

---

# 18. Error Handling

Expected failures include:

- Microphone disconnected.
- Playback device changed.
- Backend unavailable.
- Network interruption.
- Token expiration.

Each failure should produce:

- Clear logs.
- Automatic recovery where possible.
- Meaningful user feedback through CLI output.

Unhandled exceptions should be considered bugs.

---

# 19. Future Enhancements

The architecture should allow future support for:

- macOS CoreAudio
- Linux PulseAudio/PipeWire
- Automatic updates
- Windows Service mode
- System tray application
- Push-to-talk mode
- Local Voice Activity Detection (VAD)
- Noise suppression
- Acoustic echo cancellation
- Offline buffering

These enhancements must not require redesign of the core streaming architecture.

---

# 20. Guiding Principles

Every contribution to the Desktop Agent must follow these principles:

- Keep it lightweight.
- Keep it headless.
- Keep it platform-native.
- Never embed AI logic.
- Never embed business logic.
- Stream continuously.
- Recover automatically.
- Be secure by default.
- Minimize resource consumption.

The Desktop Agent exists solely to deliver reliable, low-latency audio streams to the backend. Any functionality that does not directly support that goal should be implemented elsewhere in the platform.

---

**End of Document — 03_Desktop_Agent.md**