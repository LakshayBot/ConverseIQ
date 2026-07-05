# 08_API_Contracts.md

Version: 1.0

Status: Approved

---

# Purpose

This document defines every public contract exposed by CallPilot AI.

The goal is to ensure that every component communicates through stable, versioned contracts.

Components should never depend on implementation details of another component.

Instead, they communicate through documented APIs, WebSocket messages, and shared contract schemas.

---

# System Communication Overview

```
                 Next.js Dashboard
                       │
                REST + SignalR
                       │
                       ▼
              CallPilot Server (.NET)
                  │            │
           HTTP/gRPC      SignalR
                  │            │
                  ▼            ▼
        Python AI Engine    Desktop CLI
```

The server is the only component that communicates directly with all others.

The Dashboard never communicates directly with the AI Engine.

The Desktop Agent never communicates directly with PostgreSQL.

The AI Engine never communicates directly with the Dashboard.

---

# API Versioning

All HTTP APIs must be versioned.

Example

```
/api/v1/auth
/api/v1/providers
/api/v1/meetings
/api/v1/knowledge
/api/v1/settings
```

Breaking changes require a new API version.

---

# Authentication APIs

## POST /api/v1/auth/login

Purpose

Authenticate a user.

Request

```json
{
  "email": "user@example.com",
  "password": "********"
}
```

Response

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "..."
}
```

---

## POST /api/v1/auth/refresh

Refresh JWT.

---

## POST /api/v1/auth/logout

Invalidate the current session.

---

# Provider APIs

## GET /api/v1/providers

Return configured providers.

---

## POST /api/v1/providers

Create or update a BYOK provider.

Example

```json
{
  "provider": "DeepSeek",
  "model": "deepseek-chat",
  "endpoint": "...",
  "apiKey": "...",
  "temperature": 0.2
}
```

---

## DELETE /api/v1/providers/{id}

Remove a provider configuration.

---

# Meeting APIs

## POST /api/v1/meetings

Create a meeting.

Response

```json
{
  "meetingId": "...",
  "state": "Created"
}
```

---

## POST /api/v1/meetings/{id}/start

Start meeting.

---

## POST /api/v1/meetings/{id}/end

End meeting.

---

## GET /api/v1/meetings/{id}

Return meeting details.

---

## GET /api/v1/meetings

List meetings.

---

# Knowledge APIs

## POST /api/v1/knowledge/upload

Upload documents.

Supported formats

- PDF
- DOCX
- TXT
- Markdown

Multipart upload.

---

## GET /api/v1/knowledge

List indexed documents.

---

## DELETE /api/v1/knowledge/{id}

Delete document.

---

# Dashboard APIs

Dashboard uses REST only for:

- Initial data
- Configuration
- Authentication

Everything else uses SignalR.

---

# SignalR Hubs

The platform exposes multiple logical hubs.

## Meeting Hub

Messages

```
MeetingCreated

MeetingStarted

MeetingCompleted

MeetingArchived
```

---

## Transcript Hub

Messages

```
TranscriptStarted

TranscriptUpdated

TranscriptFinalized
```

---

## Recommendation Hub

Messages

```
RecommendationGenerated

RecommendationDismissed
```

---

## Diagnostics Hub

Messages

```
LatencyUpdated

HealthUpdated

WorkerStatusUpdated
```

---

# Desktop Agent Protocol

Desktop Agent authenticates using JWT.

Connection

```
Desktop Agent

↓

SignalR

↓

CallPilot Server
```

---

## RegisterAgent

Payload

```json
{
  "agentVersion": "...",
  "platform": "Windows",
  "capabilities": [
    "DesktopAudio",
    "MicrophoneAudio"
  ]
}
```

---

## AudioFrame

Payload

```json
{
  "meetingId": "...",
  "sequence": 145,
  "timestamp": "...",
  "sampleRate": 16000,
  "channels": 1,
  "audio": "<binary>"
}
```

Frames must arrive in order.

---

## Heartbeat

Payload

```json
{
  "meetingId": "...",
  "timestamp": "..."
}
```

---

# AI Engine Contract

Every AI request follows the same structure.

```json
{
  "taskId": "...",
  "taskType": "...",
  "meetingId": "...",
  "context": {},
  "payload": {},
  "provider": {}
}
```

---

## AI Response

```json
{
  "taskId": "...",
  "success": true,
  "durationMs": 742,
  "confidence": 0.96,
  "result": {}
}
```

---

# AI Task Types

Supported tasks

```
SpeechRecognition

SpeakerDiarization

EntityExtraction

ConversationEvents

KnowledgeRetrieval

RecommendationGeneration

EmbeddingGeneration
```

Future tasks should extend rather than modify the protocol.

---

# Shared Contracts

Every service shares common schemas.

Examples

```
MeetingContext

TranscriptSegment

Recommendation

ProviderConfiguration

KnowledgeChunk

ConversationEvent

EmbeddingVector
```

These contracts are versioned independently.

---

# Error Format

Every API returns a common error response.

```json
{
  "code": "ProviderUnavailable",
  "message": "...",
  "correlationId": "...",
  "details": {}
}
```

Clients should never parse exception messages.

---

# Pagination

Collection endpoints use:

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 152,
  "items": []
}
```

---

# Correlation IDs

Every request generates a Correlation ID.

The same ID propagates through:

- REST
- SignalR
- AI Engine
- Logging
- Events

This enables end-to-end tracing.

---

# Timeouts

Recommended defaults

Authentication

10 s

Knowledge Upload

120 s

Meeting Creation

10 s

AI Tasks

30 s

Speech Recognition

5 s

Recommendation Generation

15 s

---

# Backward Compatibility

Public contracts must remain backward compatible.

Breaking changes require:

- New API version
- Migration guide
- Deprecation period

---

# Security

All endpoints require JWT authentication unless explicitly documented.

API keys remain encrypted on the server.

The Dashboard never receives provider secrets.

Desktop Agent never receives provider secrets.

AI Engine receives provider configuration only for the current task.

---

# Contract Testing

Every contract must be verified by automated integration tests.

Tests validate:

- Schema
- Required fields
- Serialization
- Version compatibility

Contract failures block releases.

---

# Engineering Principles

Contracts should be:

- Explicit
- Versioned
- Backward compatible
- Technology agnostic
- Independently testable

Implementation details must never leak into public contracts.

---

# Conclusion

API Contracts define the stable communication layer of CallPilot AI.

By keeping contracts independent from implementation, every component can evolve without breaking the rest of the platform.

The API surface should remain small, predictable, and carefully versioned throughout the lifetime of the project.

---

**End of Document — 08_API_Contracts.md**