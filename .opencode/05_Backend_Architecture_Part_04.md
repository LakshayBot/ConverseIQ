# 05_Backend_Architecture.md

## Part 4 — AI Worker Integration, Provider Management & Knowledge Pipeline

---

# 57. AI Integration Philosophy

The Python AI Engine is an independent execution engine.

It should not contain business rules.

It should not understand users.

It should not manage meetings.

It should not access PostgreSQL.

Instead, it receives well-defined work from the CallPilot Server and returns structured results.

The server remains the system of record.

The AI Engine remains a computation engine.

---

# 58. AI Worker Architecture

Conceptually, the AI Engine operates as a collection of workers.

```
CallPilot Server

↓

AI Coordinator

↓

AI Task

↓

Speech Worker

Entity Worker

RAG Worker

Recommendation Worker

Embedding Worker

↓

Structured Result

↓

CallPilot Server
```

Workers execute AI tasks independently and remain unaware of business workflows.

---

# 59. AI Task Contract

Every request from the server to the AI Engine follows a common structure.

Each task contains:

- Task ID
- Task Type
- Meeting ID
- MeetingContext snapshot
- Payload
- Provider configuration
- Timeout
- Correlation ID

Every response includes:

- Task ID
- Success flag
- Result
- Diagnostics
- Execution time
- Confidence (where applicable)

This standard contract simplifies testing, logging, and future scaling.

---

# 60. Supported AI Tasks (Phase 1)

The AI Engine should expose distinct task types rather than generic inference endpoints.

Examples include:

- TranscribeAudio
- DetectSpeakers
- ExtractEntities
- DetectEvents
- BuildKnowledgeContext
- GenerateRecommendations
- GenerateEmbeddings

Each task should have a dedicated handler inside the AI Engine.

---

# 61. AI Coordinator Responsibilities

The AI Coordinator inside the CallPilot Server is responsible for:

- Creating AI tasks
- Selecting providers
- Applying timeouts
- Retrying transient failures
- Mapping results back into MeetingContext
- Recording diagnostics
- Publishing domain events

The AI Coordinator should never perform AI inference directly.

---

# 62. Provider Management

Provider configuration belongs entirely to the server.

Each authenticated user maintains one or more provider profiles.

A provider profile includes:

- Provider type
- Model
- Endpoint
- API key (encrypted)
- Temperature
- Max tokens
- Timeout
- Enabled capabilities

The AI Engine receives provider information only for the current task.

It never persists credentials.

---

# 63. Capability Resolution

The server resolves capabilities before invoking the AI Engine.

Examples:

Speech Recognition → Faster Whisper

Reasoning → DeepSeek

Embeddings → Local Model

The AI Engine executes the task using the selected provider without needing to know why it was chosen.

---

# 64. Knowledge Upload Pipeline

Knowledge ingestion is orchestrated by the server.

Workflow:

```
Upload Document

↓

Validate

↓

Store Original File

↓

Extract Text

↓

Chunk Content

↓

Generate Embeddings

↓

Persist Metadata

↓

Store Vectors

↓

Publish KnowledgeReady
```

Each stage should emit events for observability.

---

# 65. Embedding Generation

Embedding generation is an AI task.

The server sends prepared text chunks to the AI Engine.

The AI Engine returns vectors.

The server stores vectors using pgvector.

The AI Engine never writes directly to the database.

---

# 66. AI Result Validation

Every AI response must be validated before entering the MeetingContext.

Validation includes:

- Schema validation
- Required fields
- Confidence thresholds
- Provider metadata
- Execution status

Invalid AI responses should be rejected and logged.

---

# 67. Retry Strategy

Transient AI failures should be retried automatically.

Examples:

- Provider timeout
- Temporary network issue
- Rate limit

Retries should use exponential backoff with configurable limits.

Permanent failures should not be retried.

---

# 68. Health Monitoring

The server continuously monitors AI Engine health.

Metrics include:

- Availability
- Response time
- Task throughput
- Error rate
- Active providers
- Queue depth (future)

Health information should be exposed through diagnostics endpoints.

---

# 69. Observability

Every AI task should generate telemetry.

Captured information includes:

- Task type
- Provider
- Model
- Execution time
- Tokens (if applicable)
- Confidence
- Success/failure
- Correlation ID

This telemetry enables debugging, performance analysis, and future optimization.

---

# 70. Security Boundaries

The AI Engine should never:

- Authenticate users
- Access JWT tokens
- Read from PostgreSQL
- Access uploaded files directly
- Persist business state

Its responsibility is limited to AI computation.

---

# 71. Scalability

The architecture should support multiple AI Engine instances.

Future scaling strategies include:

- Dedicated speech workers
- Dedicated embedding workers
- Dedicated recommendation workers
- GPU-enabled workers
- CPU-only workers

The server should be capable of distributing tasks without changing business logic.

---

# 72. Engineering Principles

The AI Engine is a computation layer.

The CallPilot Server is the orchestration layer.

Keeping these responsibilities separate ensures:

- Independent deployment
- Easier testing
- Better scalability
- Cleaner code ownership
- Provider independence

No business rule should exist inside the AI Engine.

---

End of Part 4