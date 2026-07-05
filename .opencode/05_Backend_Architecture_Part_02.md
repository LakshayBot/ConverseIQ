# 05_Backend_Architecture.md

## Part 2 — Meeting Orchestration & Real-Time Communication

---

# 17. Meeting Aggregate

The Meeting Aggregate is the central business object of CallPilot AI.

Every operation performed by the platform occurs within the context of a meeting.

The Meeting Aggregate is responsible for enforcing business invariants and coordinating related domain entities.

The aggregate owns:

- Meeting identifier
- Meeting state
- User
- Connected Desktop Agent
- Connected Dashboard Clients
- MeetingContext
- Active provider configuration
- Event timeline
- Recommendation timeline
- Knowledge scope

No other aggregate should directly modify meeting state.

---

# 18. Meeting State Machine

A meeting always exists in one valid state.

```
Created
    │
    ▼
WaitingForDesktopAgent
    │
    ▼
DesktopConnected
    │
    ▼
Streaming
    │
    ▼
AIProcessing
    │
    ▼
Completed
    │
    ▼
Archived
```

Invalid state transitions must be rejected.

Examples:

❌ Archived → Streaming

❌ Completed → AIProcessing

❌ Created → Completed

Every transition emits a domain event.

---

# 19. Meeting Coordinator

The Meeting Coordinator is responsible for orchestrating all runtime components during an active meeting.

Responsibilities include:

- Register Desktop Agent
- Create MeetingContext
- Initialize AI session
- Start transcript stream
- Dispatch events
- Monitor health
- Handle reconnects
- End meeting gracefully

The Meeting Coordinator never performs AI inference.

Instead, it coordinates independent components.

---

# 20. AI Coordinator

The AI Coordinator is the server-side gateway to the Python AI Engine.

Responsibilities:

- Create AI session
- Forward transcript windows
- Forward MeetingContext snapshots
- Receive recommendations
- Receive detected events
- Handle retries
- Handle provider failures

The AI Coordinator should expose a stable contract regardless of how the AI Engine evolves.

---

# 21. Desktop Agent Coordinator

The Desktop Agent Coordinator manages all communication with the local CLI Agent.

Responsibilities:

- Authenticate Desktop Agent
- Register agent
- Establish WebSocket
- Heartbeat monitoring
- Audio stream registration
- Agent capability negotiation
- Automatic reconnection

Each connected Desktop Agent belongs to exactly one authenticated user.

---

# 22. WebSocket Architecture

The platform relies heavily on persistent WebSocket connections.

Separate logical channels should exist for different communication types.

```
Desktop Agent
        │
        ▼
Audio Channel

----------------------------

Dashboard
        │
        ▼
Transcript Channel

----------------------------

Dashboard
        │
        ▼
Recommendation Channel

----------------------------

Dashboard
        │
        ▼
Meeting Event Channel

----------------------------

Dashboard
        │
        ▼
Diagnostics Channel
```

Logical separation simplifies scaling and debugging.

---

# 23. Streaming Pipeline

The Backend Server never buffers an entire meeting.

Streaming occurs incrementally.

```
Desktop Audio

↓

Server

↓

AI Engine

↓

Recommendations

↓

Dashboard
```

Each stage begins processing immediately after sufficient data becomes available.

---

# 24. Transcript Pipeline

Transcript updates progress through several stages.

```
Desktop Agent

↓

Partial Transcript

↓

MeetingContext Update

↓

AI Engine

↓

Final Transcript

↓

Dashboard
```

Partial transcripts improve responsiveness.

Only finalized transcript segments should trigger expensive downstream AI workflows.

---

# 25. Recommendation Pipeline

Recommendations are event-driven.

```
Conversation Event

↓

Knowledge Retrieval

↓

Prompt Construction

↓

LLM

↓

Recommendation

↓

Validation

↓

Dashboard
```

Recommendations should never bypass validation.

---

# 26. Dashboard Synchronization

The dashboard should receive updates using push-based communication.

Events include:

- TranscriptUpdated
- RecommendationGenerated
- MeetingStatusChanged
- ProviderStatusChanged
- KnowledgeReady
- DiagnosticsUpdated

The dashboard should never poll the server.

---

# 27. Real-Time Guarantees

The server should target the following behavior.

Transcript updates

<300 ms

Recommendation delivery

<2 seconds

Meeting state synchronization

Immediate

Dashboard reconnection

Automatic

WebSocket recovery

Automatic

These targets should be monitored continuously.

---

# 28. Heartbeat System

Every persistent connection should participate in heartbeat monitoring.

Monitored connections include:

- Desktop Agent
- Dashboard
- AI Engine

Missed heartbeat sequence:

```
Healthy

↓

Heartbeat Missed

↓

Retry

↓

Warning

↓

Disconnected

↓

Cleanup
```

Meeting state should remain consistent even during temporary disconnections.

---

# 29. Connection Recovery

Unexpected disconnects should not terminate meetings immediately.

Recovery strategy:

Desktop Agent disconnected

↓

Grace Period

↓

Reconnect

↓

Resume Streaming

↓

Continue Meeting

If recovery fails, the meeting should transition into a recoverable error state before completion.

---

# 30. Session Isolation

Every meeting must be completely isolated.

Meeting A must never receive:

- Transcript data
- Recommendations
- Knowledge
- Provider configuration
- Events

from Meeting B.

Isolation applies to:

- Memory
- WebSocket routing
- AI sessions
- Database operations

---

# 31. Meeting Timeline

Every significant activity should be recorded in the meeting timeline.

Examples:

```
Meeting Created

Desktop Connected

Transcript Started

Competitor Mentioned

Pricing Objection

Knowledge Retrieved

Recommendation Displayed

Meeting Completed
```

The timeline enables diagnostics, analytics, and future replay capabilities without storing raw audio.

---

# 32. Diagnostics

Every active meeting exposes runtime diagnostics.

Examples:

- Current state
- Connected clients
- AI latency
- Transcript latency
- Event count
- Recommendation count
- Knowledge retrieval latency
- Provider status

Diagnostics are intended for monitoring and troubleshooting.

---

# 33. Failure Scenarios

The orchestration layer must tolerate failures.

Examples:

Desktop Agent disconnects

↓

Pause transcript stream

↓

Attempt reconnection

↓

Resume

--------------------------------

AI Engine timeout

↓

Retry

↓

Fallback

↓

Continue meeting

--------------------------------

Dashboard disconnects

↓

Reconnect

↓

Replay missed updates

--------------------------------

Knowledge retrieval failure

↓

Skip recommendation

↓

Continue transcription

The platform should degrade gracefully rather than fail completely.

---

# 34. Engineering Principles

Meeting orchestration should remain:

- Event-driven
- Stateless where possible
- Deterministic
- Recoverable
- Observable
- Horizontally scalable

The server is responsible for coordinating the meeting—not interpreting its content.

---

End of Part 2