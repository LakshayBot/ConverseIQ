# 11_Reference_Implementation.md

Version: 1.0

Status: Approved

---

# Purpose

The purpose of this document is to define the smallest complete implementation of CallPilot AI.

This is not a prototype.

This is the first production-quality vertical slice that validates the overall architecture.

Every major subsystem participates in this implementation.

If this slice works, the architecture is considered technically validated.

---

# Philosophy

Instead of building features independently, the project will be built vertically.

Each milestone should produce a fully functional end-to-end workflow.

The first workflow should demonstrate the complete architecture with the minimum possible functionality.

---

# Success Criteria

A user should be able to:

1. Open the Dashboard.
2. Login.
3. Configure a DeepSeek or Ollama provider.
4. Start a meeting.
5. Launch the Desktop CLI.
6. Speak into the microphone.
7. View a live transcript.
8. End the meeting.

Nothing else.

No recommendations.

No RAG.

No document upload.

No analytics.

If these eight steps work reliably, the architecture has been validated.

---

# Scope

Included

- Authentication
- JWT
- BYOK
- Meeting lifecycle
- Desktop CLI
- SignalR
- Audio streaming
- AI Engine
- Speech-to-text
- Speaker diarization
- Live transcript
- PostgreSQL persistence

Excluded

- Knowledge upload
- RAG
- Recommendations
- Event detection
- CRM
- Dashboard analytics
- Plugins
- Memory
- Multi-language

---

# Components

The reference implementation contains four running processes.

```
Next.js Dashboard

↓

CallPilot Server

↓

Python AI Engine

↓

Desktop CLI
```

All components communicate exactly as defined in the architecture.

---

# Step 1

User Login

Dashboard

↓

Server

↓

JWT

↓

Dashboard

---

# Step 2

Configure Provider

Dashboard

↓

Server

↓

Encrypted PostgreSQL

---

# Step 3

Create Meeting

Dashboard

↓

Server

↓

MeetingContext v1

↓

MeetingCreated Event

---

# Step 4

Desktop CLI

Desktop CLI starts.

↓

Authenticates using JWT.

↓

Connects through SignalR.

↓

Registers capabilities.

↓

Heartbeat starts.

---

# Step 5

Audio Capture

Desktop Audio

↓

PCM

↓

Streaming Frames

↓

SignalR

↓

Server

---

# Step 6

AI Pipeline

Server

↓

Speech Task

↓

Python AI Engine

↓

Faster Whisper

↓

Transcript Segment

↓

Server

---

# Step 7

Dashboard

Transcript Segment

↓

SignalR

↓

Dashboard

↓

Live Transcript

---

# Step 8

Persistence

Transcript Segment

↓

PostgreSQL

Meeting

↓

Completed

---

# Directory Structure

```
src/

callpilot-dashboard/

callpilot-server/

callpilot-ai-engine/

callpilot-desktop/

contracts/

docker/
```

---

# AI Engine

Only two workers exist.

Speech Worker

Speaker Worker

No recommendation engine.

---

# Database

Only required tables.

Users

Meetings

TranscriptSegments

ProviderConfigurations

RefreshTokens

Nothing else.

---

# APIs

Only required endpoints.

POST /login

POST /providers

POST /meetings

POST /meetings/start

POST /meetings/end

GET /meetings

SignalR

Transcript Hub

Meeting Hub

---

# Performance Targets

Desktop Audio

↓

Server

<100 ms

Speech Recognition

<500 ms

Dashboard

<300 ms

End-to-end

<1 second

---

# Docker

The following must start with one command.

```
docker compose up
```

Containers

callpilot-server

callpilot-ai-engine

callpilot-dashboard

postgres

ollama (optional)

---

# Tests

The reference implementation should contain.

Unit Tests

Integration Tests

Architecture Tests

Smoke Tests

One End-to-End Test

---

# Completion Checklist

Authentication

Provider configuration

Desktop CLI

Audio streaming

AI transcription

Speaker diarization

SignalR

Dashboard

Meeting lifecycle

Persistence

Docker

CI

All items must be complete before beginning Phase 2.

---

# Future Expansion

Once the reference implementation is complete, additional capabilities can be layered without changing the architecture.

Examples:

- Knowledge upload
- RAG
- Recommendations
- Analytics
- Memory
- CRM
- Plugins

The architecture should expand vertically rather than being rewritten.

---

# Conclusion

The Reference Implementation is the architectural proof that CallPilot AI functions as a cohesive system.

It validates communication between all major components, establishes the development workflow, and provides a stable baseline upon which all future capabilities will be built.

No Phase 2 work should begin until the reference implementation is complete and verified.

---

End of Document — 11_Reference_Implementation.md