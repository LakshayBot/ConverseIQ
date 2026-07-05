# 05_Backend_Architecture.md

## Part 5 — End-to-End Meeting Lifecycle, Deployment & Engineering Standards

---

# 73. End-to-End Meeting Lifecycle

The following sequence describes the complete lifecycle of a meeting from initialization to completion.

This lifecycle represents the canonical execution flow for Phase 1.

```
User Opens Dashboard
        │
        ▼
Authenticate
        │
        ▼
Configure AI Provider (BYOK)
        │
        ▼
Start Meeting
        │
        ▼
Create MeetingContext
        │
        ▼
Desktop Agent Connects
        │
        ▼
Audio Streaming Starts
        │
        ▼
Speech Recognition
        │
        ▼
Transcript Updates
        │
        ▼
Event Detection
        │
        ▼
Knowledge Retrieval
        │
        ▼
Recommendation Generation
        │
        ▼
Dashboard Updates
        │
        ▼
Meeting Ends
        │
        ▼
Persist Meeting Summary
```

Every implementation should follow this logical sequence.

---

# 74. Startup Sequence

When the platform starts, components initialize in the following order.

```
PostgreSQL

↓

CallPilot Server

↓

SignalR Hub

↓

AI Engine

↓

Next.js Dashboard

↓

Desktop Agent
```

Each component should expose a health endpoint before accepting requests.

---

# 75. Meeting Startup Workflow

```
User clicks

Start Meeting

↓

MeetingCreated

↓

MeetingContext initialized

↓

Desktop Agent authenticated

↓

Audio stream registered

↓

AI Session created

↓

Streaming begins

↓

Dashboard switches to Live Mode
```

No AI inference should begin until all required services are ready.

---

# 76. Live Meeting Workflow

During an active meeting the following loop executes continuously.

```
Receive Audio

↓

Speech Recognition

↓

Transcript Update

↓

MeetingContext Updated

↓

Event Detection

↓

Knowledge Retrieval

↓

Recommendation Generation

↓

Dashboard Push

↓

Repeat
```

The loop continues until the meeting is completed.

---

# 77. Meeting Shutdown Workflow

```
User Ends Meeting

↓

Desktop Agent Stops Streaming

↓

Flush Remaining Transcript

↓

Finalize AI Tasks

↓

Persist Meeting Data

↓

Close WebSockets

↓

Release Resources

↓

Archive Meeting
```

Shutdown should be graceful even if components disconnect unexpectedly.

---

# 78. Docker Deployment

Every major component should be independently deployable.

Phase 1 containers

```
callpilot-server

callpilot-ai-engine

callpilot-dashboard

postgres

optional ollama
```

Future containers may include

- Redis
- Background Workers
- Analytics
- CRM Connectors

Each container should communicate over an internal Docker network.

---

# 79. Environment Configuration

Configuration should be externalized.

Examples

- Database
- JWT
- BYOK encryption
- Provider endpoints
- AI timeouts
- Logging
- Upload paths

No environment-specific values should be hardcoded.

---

# 80. Logging Strategy

Every component should emit structured logs.

Required fields

- Timestamp
- Meeting ID
- User ID
- Correlation ID
- Component
- Event Type
- Duration
- Result

Logs should be machine-readable and suitable for centralized aggregation.

---

# 81. Metrics

The platform should collect operational metrics.

Examples

System

- Active meetings
- Connected agents
- Connected dashboards

AI

- STT latency
- Recommendation latency
- Retrieval latency
- Provider response time
- Token usage

Knowledge

- Indexed documents
- Embedding generation time
- Retrieval success rate

Metrics should support future dashboards and alerting.

---

# 82. Security

Security principles include:

- Encrypted API keys
- HTTPS everywhere
- JWT authentication
- Least privilege
- Input validation
- Rate limiting
- Secure file uploads

The server should never expose provider credentials to the dashboard or Desktop Agent.

---

# 83. Deployment Philosophy

The platform should support:

- Local development
- Self-hosted deployment
- Enterprise deployment
- Docker Compose
- Future Kubernetes deployment

Deployment should not require code changes.

---

# 84. Extensibility

The architecture is intentionally designed for future expansion.

Examples include:

- CRM integrations
- Multi-language transcription
- Team collaboration
- Customer support mode
- Analytics dashboards
- Plugin ecosystem
- Cloud storage providers
- Additional AI providers

New functionality should integrate through existing extension points rather than modifying core components.

---

# 85. Engineering Standards

All contributions should follow these standards.

### Code

- Small focused classes
- Feature-oriented organization
- Clear naming
- Dependency injection
- Async-first APIs

### Architecture

- No circular dependencies
- No business logic in controllers
- No provider-specific logic in application code
- Commands mutate state
- Queries read state

### AI

- Structured outputs
- Provider abstraction
- Confidence scores
- Explainability
- Deterministic preprocessing

### Documentation

Every public feature should include:

- README
- Sequence diagram
- API documentation
- Tests

---

# 86. Definition of Done

A feature is considered complete only when it includes:

- Business implementation
- Validation
- Logging
- Metrics
- Tests
- Documentation
- Error handling
- Observability

Implementation without these supporting elements is incomplete.

---

# 87. Architectural Principles

The architecture of CallPilot AI is guided by the following principles.

- Meeting-centric design
- Event-driven communication
- Provider independence
- Streaming-first processing
- Stateless AI
- Vertical Slice Architecture
- CQRS
- Explainable intelligence
- Open-source friendliness
- Docker-first deployment

Every future architectural decision should reinforce these principles rather than contradict them.

---

# 88. Conclusion

The CallPilot Server is the orchestration backbone of CallPilot AI.

It coordinates meetings, users, knowledge, providers, AI execution, and real-time communication while remaining independent of any specific AI model or vendor.

Together with the AI Engine, Desktop Agent, and Dashboard, it forms a modular platform capable of supporting real-time sales intelligence today and future conversational AI scenarios tomorrow.

This document defines the architectural foundation for all backend implementation work.

---

**End of Document — 05_Backend_Architecture.md**