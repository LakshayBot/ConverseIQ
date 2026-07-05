# 02_System_Architecture.md

**Document Status**

Version: 1.0

Status: Approved

---

# 1. Purpose

This document defines the complete system architecture for CallPilot AI.

It explains every major component, their responsibilities, communication methods, deployment strategy, and architectural boundaries.

This architecture is designed around the following principles:

- Low latency
- Modular services
- Open-source friendliness
- Horizontal scalability
- Provider abstraction
- Stateless AI
- Clean separation of concerns
- Docker-first deployment

Every future feature must fit into this architecture without requiring major redesign.

---

# 2. High-Level Architecture

```
                         ┌──────────────────────────┐
                         │      Desktop Agent       │
                         │        (.NET 9 CLI)      │
                         └────────────┬─────────────┘
                                      │
                    Microphone + Desktop Audio
                                      │
                           Secure WebSocket
                                      │
                         ┌────────────▼─────────────┐
                         │      Backend API         │
                         │        (.NET 9)          │
                         └────────────┬─────────────┘
                                      │
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
             │                        │                        │
     AI Service               PostgreSQL               Next.js Dashboard
      (Python)                 + pgvector                 (Frontend)
             │
             │
      Whisper
      Diarization
      RAG
      Event Detection
      Suggestions
```

The Backend API is the center of the system.

No component communicates directly with another component unless explicitly defined.

---

# 3. System Components

The platform consists of four primary services.

## Desktop Agent

Technology

- .NET 9
- Native CLI

Purpose

Capture audio from the local machine and stream it securely.

Responsibilities

- Capture microphone audio
- Capture desktop/system audio
- Device detection
- Authentication
- WebSocket streaming
- Local buffering
- Automatic reconnection
- Health reporting

The Desktop Agent performs **no AI processing**.

It should remain lightweight and consume minimal system resources.

---

## Backend API

Technology

- ASP.NET Core 9

Purpose

Acts as the orchestration layer for the entire platform.

Responsibilities

- Authentication
- User management
- Session management
- Knowledge management
- AI orchestration
- Event routing
- WebSocket management
- Dashboard synchronization
- File ingestion
- Provider configuration
- Permission validation

The Backend API owns every business rule.

It is the only component allowed to communicate with the database.

---

## AI Service

Technology

- Python
- FastAPI

Purpose

Perform all AI-related processing.

Responsibilities

- Streaming Speech-to-Text
- Speaker Diarization
- Event Detection
- Context Building
- Product Detection
- Competitor Detection
- RAG
- Suggestion Generation
- Conversation Understanding

The AI Service is completely stateless.

It never communicates directly with PostgreSQL.

It never stores user data.

---

## Dashboard

Technology

- Next.js
- React
- TypeScript
- TailwindCSS
- ShadCN

Purpose

Provide real-time visualization of meeting intelligence.

Responsibilities

- Live transcript
- Context cards
- Suggestions
- Product comparisons
- Knowledge references
- Meeting events
- User settings
- Knowledge uploads

The dashboard never performs AI reasoning.

---

# 4. Component Responsibilities

| Component | Owns |
|-----------|------|
| Desktop Agent | Audio Capture |
| Backend API | Business Logic |
| AI Service | Intelligence |
| PostgreSQL | Persistent Data |
| Dashboard | User Experience |

No responsibility should overlap.

---

# 5. Audio Flow

```
Microphone

↓

Desktop Agent

↓

WebSocket

↓

Backend API

↓

AI Service
```

Desktop audio follows the same path.

Both streams remain independent.

The AI Service determines speaker identity.

---

# 6. Data Flow

```
Customer Speaks

↓

Desktop Audio

↓

Desktop Agent

↓

Backend API

↓

Streaming Queue

↓

AI Service

↓

Structured Events

↓

Backend API

↓

Dashboard
```

Audio never reaches the Dashboard.

Only structured information is transmitted.

---

# 7. Streaming Pipeline

The platform is designed around streaming.

Every stage should begin processing before the previous stage has fully completed.

Pipeline

```
Audio

↓

Chunking

↓

Streaming STT

↓

Speaker Diarization

↓

Context Window

↓

Event Detection

↓

RAG

↓

Suggestion Engine

↓

Dashboard
```

Streaming minimizes perceived latency.

---

# 8. Communication Protocols

Desktop Agent → Backend

- Secure WebSocket

Backend → Dashboard

- SignalR / WebSocket

Backend → AI

- HTTP
- Streaming endpoints where applicable

Backend → Database

- Entity Framework Core

No service communicates directly with PostgreSQL except the Backend API.

---

# 9. Authentication

Phase 1 authentication flow

```
Desktop Agent

↓

JWT Authentication

↓

Backend API

↓

Access Token

↓

Secure WebSocket
```

The AI Service trusts only requests forwarded by the Backend API.

---

# 10. Audio Processing Strategy

The Desktop Agent captures:

Microphone

AND

Desktop Audio

independently.

The streams are never mixed.

Benefits

- Better speaker attribution
- Easier debugging
- Cleaner AI pipeline
- Future multi-channel support

---

# 11. AI Processing Strategy

The AI pipeline is divided into two layers.

## Fast Layer

Target latency

150–300 ms

Responsibilities

- Speech Recognition
- Speaker Detection
- Live Transcript

---

## Intelligence Layer

Target latency

1–3 seconds

Responsibilities

- Event Detection
- Product Recognition
- Competitor Detection
- RAG
- Suggestions
- Context Building

Separating these layers prevents expensive AI operations from delaying transcription.

---

# 12. Event-Driven Architecture

The platform is event-driven.

Instead of asking an LLM to reason over every spoken sentence, the system converts the transcript into structured business events.

Examples

```
CompetitorMentioned

PricingQuestion

SecurityConcern

FeatureRequest

BudgetDiscussion

TimelineDiscussion

PositiveBuyingSignal

NegativeBuyingSignal
```

The Dashboard subscribes to these events rather than raw AI responses.

This significantly reduces latency and inference costs.

---

# 13. Knowledge Retrieval

Knowledge retrieval occurs only when required.

Example

Customer

"We currently use Product X."

Pipeline

```
CompetitorMentioned

↓

Knowledge Search

↓

Product Comparison

↓

AI Recommendation
```

This selective retrieval strategy avoids unnecessary AI calls.

---

# 14. Provider Abstraction

Every external dependency must be abstracted.

Supported provider categories include:

Speech Providers

- Faster Whisper
- WhisperLive
- Future providers

LLMs

- Ollama
- DeepSeek
- OpenAI
- Claude
- Gemini

Embedding Models

- Local
- Cloud

Vector Storage

- pgvector

The rest of the application should never depend on a specific vendor.

---

# 15. Deployment Model

All services run independently.

```
Desktop Agent

(User Machine)

──────────────

Backend API

(Docker)

──────────────

AI Service

(Docker)

──────────────

PostgreSQL

(Docker)

──────────────

Next.js

(Docker)
```

Every service can be updated independently.

---

# 16. Scalability

The architecture should support horizontal scaling.

Examples

- Multiple Dashboard users
- Multiple Desktop Agents
- Multiple AI workers
- Load-balanced Backend APIs

Stateless services simplify scaling.

---

# 17. Failure Handling

If the AI Service becomes unavailable:

- Audio streaming continues.
- Sessions remain active.
- Users receive a degraded experience.
- Backend retries failed requests.
- Dashboard displays service health.

If the Dashboard disconnects:

Meeting processing continues.

If the Desktop Agent disconnects:

The Backend marks the session as inactive after a configurable timeout.

---

# 18. Logging Strategy

Every component must produce structured logs.

Logs should include

- Timestamp
- Session ID
- User ID
- Correlation ID
- Component Name
- Event Type
- Duration

Logs should never include raw audio.

Sensitive information must be masked where appropriate.

---

# 19. Security Principles

The platform follows these security principles.

- TLS for all communication
- JWT authentication
- BYOK encryption
- Least privilege access
- No plaintext API keys
- No direct AI access from clients
- No direct database access outside the Backend API

---

# 20. Future Expansion

This architecture intentionally supports future capabilities without requiring redesign.

Examples

- CRM integrations
- Calendar integrations
- Website knowledge ingestion
- Confluence integration
- SharePoint integration
- Meeting memory
- Team analytics
- Sales coaching
- Customer Success mode
- Support mode

Future modules should integrate by extending existing services rather than replacing them.

---

# 21. Architectural Principles

Every contributor to this project must follow these principles.

- Keep the Desktop Agent lightweight.
- Keep AI stateless.
- Keep business logic inside the Backend API.
- Keep providers abstracted.
- Prefer streaming over batch processing.
- Avoid vendor lock-in.
- Favor composition over tight coupling.
- Design for open-source contributions.
- Maintain Docker compatibility.
- Preserve backward compatibility wherever practical.

Every architectural decision should improve maintainability, scalability, and extensibility.

---

**End of Document — 02_System_Architecture.md**