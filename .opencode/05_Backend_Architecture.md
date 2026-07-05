# 05_Backend_Architecture.md

Document Version: 1.0

Status: Approved

---

# Part 1 — Server Architecture & System Orchestration

---

# 1. Purpose

The CallPilot Server is the orchestration layer of the entire platform.

It is responsible for coordinating every component involved in a meeting session while ensuring that business rules remain separate from AI reasoning.

Unlike a traditional REST API that primarily exposes CRUD endpoints, the CallPilot Server manages long-running sessions, streaming communication, knowledge ingestion, provider management, AI orchestration, and real-time dashboard synchronization.

The server is the authoritative source of truth for every meeting.

No other service is permitted to own business state.

---

# 2. Design Philosophy

The server follows five architectural principles.

## Business Logic First

Business rules must never be embedded inside:

- Controllers
- Python AI Engine
- Dashboard
- Desktop Agent

All business decisions belong to the server.

---

## AI as a Dependency

The AI Engine is treated as an external capability.

The server owns:

- Meeting lifecycle
- User configuration
- Provider selection
- Knowledge availability
- Session state

The AI Engine owns only inference.

---

## Long-Running Sessions

Unlike CRUD applications where requests complete within milliseconds, CallPilot AI manages meetings that may last an hour or more.

The architecture must therefore support:

- Persistent sessions
- Streaming updates
- Incremental processing
- Fault recovery
- Session resumption

---

## Event-Driven Processing

Every important state transition should become a domain event.

Examples include:

- MeetingStarted
- AudioStreamConnected
- TranscriptReceived
- CompetitorDetected
- RecommendationGenerated
- MeetingEnded

Events reduce coupling and improve extensibility.

---

## Vertical Ownership

Every feature owns its complete implementation.

A feature contains:

- Commands
- Queries
- Validators
- Domain logic
- Persistence
- API endpoints

No feature should depend on another feature's internal implementation.

---

# 3. High-Level Server Architecture

```
                   Desktop Agent
                         │
                         ▼
                 WebSocket Gateway
                         │
                         ▼
                Session Orchestrator
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
 Authentication   Knowledge Manager   AI Coordinator
        │                │                │
        └────────────────┼────────────────┘
                         │
                  Event Dispatcher
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
 PostgreSQL        Dashboard Hub     Audit Logger
```

The server coordinates every interaction.

No service communicates directly with another unless explicitly defined.

---

# 4. Responsibilities

The server owns the following responsibilities.

### Authentication

- Login
- JWT generation
- Refresh tokens
- Session validation

---

### Meeting Lifecycle

- Start meeting
- Stop meeting
- Pause meeting (future)
- Resume meeting (future)

---

### Audio Session Management

- Register Desktop Agent
- Create audio stream
- Track connection health
- Handle reconnects

---

### Knowledge Management

- Document uploads
- Metadata extraction
- Ingestion jobs
- Embedding requests

---

### AI Coordination

- Route requests
- Maintain meeting context
- Dispatch events
- Collect recommendations

---

### Dashboard Synchronization

- Live transcript
- Recommendation updates
- Event notifications
- Knowledge references

---

### Provider Management

- BYOK configuration
- Model selection
- Capability resolution
- Health monitoring

---

# 5. Explicit Non-Responsibilities

The server intentionally does NOT perform:

- Speech recognition
- Embedding generation
- LLM reasoning
- Speaker diarization
- Recommendation generation

Those belong exclusively to the AI Engine.

This boundary should never be crossed.

---

# 6. Meeting Lifecycle

Every meeting progresses through a deterministic lifecycle.

```
Created

↓

WaitingForDesktopAgent

↓

Streaming

↓

Processing

↓

Completed

↓

Archived
```

State transitions are immutable.

Each transition emits a domain event.

---

# 7. Meeting Session

The Meeting Session is the most important aggregate in the system.

It represents an active conversation between one salesperson and one or more participants.

A Meeting Session owns:

- Session identifier
- User identifier
- Active provider configuration
- Connected Desktop Agent
- AI Engine state
- Knowledge context
- Event stream
- Transcript references
- Recommendation references

Every other operation occurs within the scope of a Meeting Session.

---

# 8. MeetingContext

The server maintains a canonical MeetingContext object.

This object is continuously updated as the meeting progresses.

```
MeetingContext
│
├── Session
├── User
├── Participants
├── Transcript
├── Active Events
├── Active Entities
├── Knowledge Context
├── Recommendations
├── Provider Configuration
├── Metrics
└── Diagnostics
```

The MeetingContext becomes the single source of truth for both the server and the AI Engine.

The AI Engine receives snapshots of this context but never owns it.

---

# 9. CQRS

The server follows Command Query Responsibility Segregation.

Commands modify state.

Queries read state.

This separation improves:

- Testability
- Scalability
- Performance
- Feature isolation

Commands must never return domain objects.

Queries must never modify state.

---

# 10. Commands

Examples include:

```
StartMeetingCommand

ConnectDesktopAgentCommand

DisconnectDesktopAgentCommand

UploadKnowledgeCommand

ConfigureProviderCommand

UpdateMeetingContextCommand

EndMeetingCommand
```

Every command should have:

- Validator
- Handler
- Domain events
- Logging
- Metrics

Commands should remain small and focused.

---

# 11. Queries

Examples include:

```
GetMeetingQuery

GetRecommendationsQuery

GetTranscriptQuery

GetKnowledgeQuery

GetProviderConfigurationQuery

GetMeetingHealthQuery
```

Queries should never invoke AI inference.

They return already computed information.

---

# 12. Domain Events

The server emits domain events whenever business state changes.

Examples

```
MeetingCreated

MeetingStarted

DesktopAgentConnected

TranscriptUpdated

KnowledgeUploaded

ProviderConfigured

MeetingEnded
```

Events should be immutable.

Events represent facts—not requests.

---

# 13. Internal Event Bus

The Internal Event Bus is the communication backbone of the server.

Instead of directly invoking services, components publish events.

Example

```
MeetingStarted

↓

Transcript Stream Initialized

↓

Desktop Connected

↓

Dashboard Updated

↓

Metrics Recorded
```

Each subscriber remains independent.

This dramatically reduces coupling.

---

# 14. Event Subscribers

Potential subscribers include:

Authentication

Dashboard

Knowledge Manager

Audit Logger

Metrics

AI Coordinator

Notification Service (future)

Analytics (future)

Subscribers should remain unaware of each other.

---

# 15. Why Event-Driven?

Traditional service-to-service calls create tight dependencies.

Example

```
MeetingService

↓

DashboardService

↓

NotificationService

↓

AnalyticsService
```

This quickly becomes difficult to maintain.

Instead

```
MeetingStarted

↓

Event Bus

↓

Subscribers
```

New features become new subscribers rather than modifications to existing services.

---

# 16. Engineering Principles

Every backend contribution must follow these principles.

- Business rules belong in the server.
- AI reasoning belongs in the AI Engine.
- Features own their implementation.
- Commands change state.
- Queries read state.
- Events communicate changes.
- MeetingContext is the canonical meeting representation.
- Avoid service-to-service coupling.
- Design every feature for independent testing.

The server exists to orchestrate—not to perform intelligence.

---

**End of Part 1**