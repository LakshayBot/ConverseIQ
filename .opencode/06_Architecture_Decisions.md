# 06_Architecture_Decisions.md

Version: 1.0

Status: Approved

---

# Purpose

This document records the major architectural decisions made during the design of CallPilot AI.

Unlike implementation documents, Architecture Decision Records (ADRs) explain **why** decisions were made, what alternatives were considered, and what trade-offs were accepted.

Every significant architectural change should either:

- Extend an existing ADR.
- Supersede an existing ADR.
- Introduce a new ADR.

Architectural decisions must not be changed casually. Stability is essential for an open-source project with multiple contributors.

---

# ADR-001 — Desktop CLI Instead of Browser Extension

## Status

Accepted

---

## Context

CallPilot AI requires continuous access to desktop audio while remaining independent of any specific meeting platform.

Supported platforms include:

- Microsoft Teams
- Zoom
- Google Meet
- Slack Huddles
- Discord
- Any browser-based meeting
- Any desktop VoIP application

---

## Problem

Browser extensions have significant limitations.

Examples:

- Cannot reliably capture system audio across all browsers.
- Browser-specific APIs.
- Store approval requirements.
- Different APIs across Chromium, Firefox, Safari.
- Difficult enterprise deployment.
- Limited background execution.

---

## Decision

A lightweight .NET CLI Desktop Agent captures:

- Desktop audio
- Microphone audio

and streams them to the CallPilot Server.

---

## Consequences

Advantages

- Platform independent
- Browser independent
- Easier enterprise deployment
- Better audio quality
- Simpler architecture

Trade-offs

- Requires local installation
- Additional process running in background

Decision accepted.

---

# ADR-002 — Python AI Engine

## Status

Accepted

---

## Context

The project backend is written in .NET.

AI workloads require:

- Speech Recognition
- Diarization
- Embeddings
- LLM Providers
- RAG

---

## Alternatives

### Everything in .NET

Pros

- Single language

Cons

- Smaller AI ecosystem
- Fewer maintained libraries
- Slower experimentation

---

### Python AI Engine

Pros

- Excellent AI ecosystem
- Native support for ML frameworks
- Faster experimentation
- Better community support

Cons

- Multi-language project
- IPC between services

---

## Decision

Business logic remains in .NET.

AI logic remains in Python.

This separation preserves clean boundaries.

Decision accepted.

---

# ADR-003 — Bring Your Own Key (BYOK)

## Status

Accepted

---

## Context

Different users prefer different providers.

Enterprise customers often require:

- Internal models
- Self-hosted models
- Vendor restrictions

---

## Decision

Every user configures:

- Provider
- Model
- Endpoint
- API Key

The platform never ships with embedded provider credentials.

---

## Consequences

Advantages

- Vendor independence
- Lower legal risk
- Lower operational cost
- Enterprise compatibility

Trade-offs

- Additional configuration UI

Decision accepted.

---

# ADR-004 — Provider Abstraction

## Status

Accepted

---

## Context

AI providers change rapidly.

Hardcoding provider logic throughout the application creates long-term maintenance problems.

---

## Decision

The AI Engine depends on capabilities rather than providers.

Examples

- Chat
- Embeddings
- Speech
- Re-ranking

Provider implementations satisfy common interfaces.

---

## Consequences

Replacing one provider should require configuration changes rather than architectural changes.

Decision accepted.

---

# ADR-005 — Event-Driven Architecture

## Status

Accepted

---

## Context

AI systems generate many asynchronous events.

Examples

- TranscriptUpdated
- CompetitorDetected
- RecommendationGenerated

Direct service dependencies increase coupling.

---

## Decision

Business components communicate through an internal Event Bus.

---

## Consequences

Advantages

- Loose coupling
- Better extensibility
- Easier testing
- Plugin-friendly architecture

Trade-offs

- More event definitions
- Event versioning required

Decision accepted.

---

# ADR-006 — PostgreSQL + pgvector

## Status

Accepted

---

## Context

Knowledge retrieval requires vector search.

Alternatives included dedicated vector databases.

---

## Decision

Use PostgreSQL with pgvector.

---

## Why

- Single database
- Docker friendly
- Mature ecosystem
- ACID
- Lower operational complexity

---

## Future

The storage layer remains abstract to allow migration if requirements change.

Decision accepted.

---

# ADR-007 — Vertical Slice Architecture

## Status

Accepted

---

## Context

Traditional layered architectures become difficult to navigate in large AI applications.

---

## Decision

Organize application code around features.

Each feature owns:

- Commands
- Queries
- Validators
- Handlers
- Endpoints
- Tests

---

## Consequences

Higher cohesion.

Lower coupling.

Simpler contributor onboarding.

Decision accepted.

---

# ADR-008 — Worker-Based AI Execution

## Status

Accepted

---

## Context

AI workloads have different latency and resource characteristics.

Treating every AI capability as a REST endpoint limits future scalability.

---

## Decision

Model AI execution as workers that process structured tasks.

Future implementations may use queues without changing business logic.

Decision accepted.

---

# ADR-009 — Immutable MeetingContext

## Status

Accepted

---

## Context

Multiple modules consume meeting state simultaneously.

Mutable shared state complicates debugging.

---

## Decision

MeetingContext is treated as an immutable snapshot.

Each processing stage produces a new version.

Example

MeetingContext v12

↓

Entity Extraction

↓

MeetingContext v13

---

## Consequences

Advantages

- Easier debugging
- Time-travel inspection
- Better testing
- Deterministic behavior

Decision accepted.

---

# ADR-010 — Events Before LLM

## Status

Accepted

---

## Context

Most AI applications send transcripts directly to an LLM.

This increases:

- Token usage
- Cost
- Latency
- Hallucination risk

---

## Decision

Conversation understanding follows this pipeline.

Transcript

↓

Entities

↓

Events

↓

Knowledge

↓

LLM

The LLM consumes structured business understanding rather than raw conversations.

---

## Consequences

Advantages

- Lower cost
- Lower latency
- Explainability
- Better recommendations

Trade-offs

- Additional engineering effort

Decision accepted.

---

# Future ADRs

Potential future decisions include:

- Multi-tenancy
- CRM integrations
- Memory architecture
- Distributed worker scheduling
- Plugin marketplace
- Kubernetes deployment
- Multi-region deployments
- Analytics architecture

---

# Engineering Rule

No pull request should introduce a major architectural change without:

1. A new ADR or an update to an existing ADR.
2. Trade-off analysis.
3. Migration strategy.
4. Backward compatibility assessment.

This ensures architectural consistency as the project evolves.

---

**End of Document — 06_Architecture_Decisions.md**