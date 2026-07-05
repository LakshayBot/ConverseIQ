# 07_Event_Catalog.md

Version: 1.0

Status: Approved

---

# Purpose

CallPilot AI is an event-driven platform.

Every meaningful business action, AI inference, system state transition, and infrastructure notification is represented as an immutable event.

This document defines:

- Event naming conventions
- Event lifecycle
- Event producers
- Event consumers
- Event payloads
- Event versioning
- Reliability guarantees

Every component of the platform communicates through these events.

---

# Event Design Principles

Every event must satisfy the following principles.

- Represent a fact that already occurred.
- Be immutable.
- Be versioned.
- Be uniquely identifiable.
- Be observable.
- Be serializable.
- Be idempotent.

Events describe history.

They never describe intentions.

Correct:

```
MeetingStarted
```

Incorrect:

```
StartMeeting
```

Commands express intent.

Events express facts.

---

# Event Envelope

Every event uses a common envelope.

```json
{
  "eventId": "uuid",
  "eventName": "MeetingStarted",
  "eventVersion": 1,
  "meetingId": "uuid",
  "userId": "uuid",
  "timestamp": "ISO8601",
  "correlationId": "uuid",
  "producer": "CallPilot.Server",
  "payload": {}
}
```

This structure enables tracing, replay, and diagnostics.

---

# Event Categories

Events are grouped into logical categories.

```
Authentication

Meeting

Desktop Agent

Transcript

Speaker

Knowledge

Provider

Recommendation

Dashboard

Diagnostics

System
```

Each category has clearly defined ownership.

---

# Authentication Events

## UserAuthenticated

Producer

Authentication Module

Consumers

- Session Manager
- Audit Logger

Payload

- User ID
- Login Time
- Session ID

---

## UserLoggedOut

Producer

Authentication Module

Consumers

- Session Manager
- Audit Logger

---

# Meeting Events

## MeetingCreated

Producer

Meeting Coordinator

Consumers

- Dashboard
- AI Coordinator
- Metrics

---

## MeetingStarted

Producer

Meeting Coordinator

Consumers

- Desktop Agent
- AI Coordinator
- Dashboard

---

## MeetingCompleted

Producer

Meeting Coordinator

Consumers

- Persistence
- Dashboard
- Metrics

---

## MeetingArchived

Producer

Meeting Coordinator

Consumers

- Storage
- Analytics (Future)

---

# Desktop Agent Events

## DesktopAgentConnected

Producer

Desktop Agent Coordinator

Consumers

- Meeting Coordinator
- Dashboard
- Diagnostics

---

## DesktopAgentDisconnected

Producer

Desktop Agent Coordinator

Consumers

- Meeting Coordinator
- Diagnostics

---

## DesktopHeartbeatReceived

Producer

Desktop Agent

Consumers

- Health Monitor

---

# Transcript Events

## TranscriptStarted

Producer

Speech Worker

Consumers

- Dashboard
- AI Pipeline

---

## TranscriptUpdated

Producer

Speech Worker

Consumers

- Event Engine
- Dashboard
- MeetingContext

Payload

- Transcript Segment
- Speaker
- Timestamp

---

## TranscriptFinalized

Producer

Speech Worker

Consumers

- Recommendation Engine
- Persistence

---

# Speaker Events

## SpeakerDetected

Producer

Speaker Worker

Consumers

- MeetingContext
- Dashboard

---

## SpeakerChanged

Producer

Speaker Worker

Consumers

- Dashboard
- Event Engine

---

# Conversation Events

## CompetitorMentioned

Producer

Event Engine

Consumers

- Recommendation Engine
- Dashboard

---

## PricingObjectionDetected

Producer

Event Engine

Consumers

- Recommendation Engine

---

## TechnicalQuestionDetected

Producer

Event Engine

Consumers

- Knowledge Engine

---

## BuyingSignalDetected

Producer

Event Engine

Consumers

- Recommendation Engine

---

## PositiveSentimentDetected

Producer

Conversation Intelligence

Consumers

- Dashboard

---

## NegativeSentimentDetected

Producer

Conversation Intelligence

Consumers

- Dashboard

---

# Knowledge Events

## KnowledgeUploadStarted

Producer

Knowledge Workflow

Consumers

- Dashboard
- Metrics

---

## KnowledgeChunkCreated

Producer

Knowledge Pipeline

Consumers

- Embedding Worker

---

## EmbeddingsGenerated

Producer

Embedding Worker

Consumers

- Persistence

---

## KnowledgeIndexed

Producer

Knowledge Pipeline

Consumers

- Dashboard

---

## KnowledgeRetrieved

Producer

RAG Worker

Consumers

- Recommendation Engine

Payload

- Retrieved Documents
- Confidence
- Retrieval Time

---

# Recommendation Events

## RecommendationStarted

Producer

Recommendation Engine

Consumers

- Metrics

---

## RecommendationGenerated

Producer

Recommendation Worker

Consumers

- Dashboard
- Persistence

Payload

- Recommendation
- Confidence
- References

---

## RecommendationDismissed

Producer

Dashboard

Consumers

- Metrics

---

# Provider Events

## ProviderConfigured

Producer

Provider Manager

Consumers

- AI Coordinator

---

## ProviderChanged

Producer

Provider Manager

Consumers

- AI Coordinator

---

## ProviderUnavailable

Producer

Health Monitor

Consumers

- Diagnostics

---

# Dashboard Events

## DashboardConnected

Producer

Dashboard Hub

Consumers

- Meeting Coordinator

---

## DashboardDisconnected

Producer

Dashboard Hub

Consumers

- Diagnostics

---

# Diagnostics Events

## HighLatencyDetected

Producer

Diagnostics

Consumers

- Metrics

---

## AIWorkerTimeout

Producer

AI Coordinator

Consumers

- Retry Manager

---

## RetryScheduled

Producer

Retry Manager

Consumers

- Metrics

---

# System Events

## ServerStarted

## ServerStopped

## ConfigurationReloaded

## DatabaseConnected

## DatabaseDisconnected

These events assist operational monitoring.

---

# Event Ordering

Ordering guarantees apply only within a single meeting.

Example

```
MeetingStarted

↓

DesktopAgentConnected

↓

TranscriptStarted

↓

TranscriptUpdated

↓

CompetitorMentioned

↓

KnowledgeRetrieved

↓

RecommendationGenerated

↓

MeetingCompleted
```

Ordering across different meetings is not guaranteed.

---

# Event Versioning

Breaking changes require a new event version.

Examples

```
RecommendationGenerated v1

RecommendationGenerated v2
```

Consumers should support multiple versions during migration.

---

# Event Reliability

Events are delivered at least once.

Consumers must therefore be idempotent.

Processing an event multiple times should not change system correctness.

---

# Event Correlation

Every event carries a Correlation ID.

This allows tracing an entire recommendation pipeline.

Example

```
TranscriptUpdated

↓

CompetitorMentioned

↓

KnowledgeRetrieved

↓

RecommendationGenerated
```

All four events share the same Correlation ID.

---

# Event Persistence

Events classified as business events should be persisted.

Examples

- MeetingStarted
- MeetingCompleted
- RecommendationGenerated
- KnowledgeIndexed

Operational events such as heartbeat notifications may remain transient.

---

# Event Replay

Persisted events should support replay for:

- Debugging
- Testing
- Analytics
- Future meeting reconstruction

Replay must never produce side effects in production systems.

---

# Event Naming Rules

Events must:

- Use past tense.
- Describe completed actions.
- Avoid implementation details.
- Remain technology independent.

Correct

```
KnowledgeIndexed
```

Incorrect

```
SaveVectorDatabase
```

---

# Engineering Rules

Adding a new event requires:

1. Payload schema.
2. Producer.
3. Consumers.
4. Version.
5. Tests.
6. Documentation.

No event should exist without a clearly defined lifecycle.

---

# Conclusion

Events form the communication backbone of CallPilot AI.

They enable loose coupling, scalability, observability, replayability, and future extensibility.

Every subsystem—including the Desktop Agent, CallPilot Server, AI Engine, Dashboard, and future plugins—must communicate through this shared event model.

This event catalog serves as the canonical reference for all event-driven interactions within the platform.

---

**End of Document — 07_Event_Catalog.md**