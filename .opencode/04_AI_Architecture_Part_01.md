# 04_AI_Architecture.md

Document Version: 1.0

Status: Approved

---

# 1. Purpose

The AI Engine is the core intelligence component of CallPilot AI.

Its responsibility is to transform raw streaming audio into structured business intelligence in real time.

Unlike conventional AI applications where Large Language Models directly answer user prompts, the AI Engine follows an event-driven architecture.

It continuously receives live audio, converts speech into text, understands conversation context, detects meaningful business events, retrieves relevant organizational knowledge, and produces contextual recommendations.

The AI Engine never communicates directly with end users.

All communication occurs through the Backend API.

This separation ensures:

- Security
- Maintainability
- Provider abstraction
- Independent scalability
- Stateless execution

The AI Engine is intentionally designed as an independent service so it can evolve independently from the rest of the platform.

---

# 2. Design Goals

The AI Engine has six primary goals.

## Low Latency

Every processing stage should begin immediately after sufficient information becomes available.

Streaming should always be preferred over batch processing.

The objective is to minimize perceived latency rather than total processing time.

---

## High Accuracy

Incorrect recommendations are worse than delayed recommendations.

Confidence scoring should exist throughout the pipeline.

Whenever confidence falls below acceptable thresholds, the engine should avoid making assumptions.

---

## Stateless Execution

The AI Engine should never permanently store user information.

Every request should contain sufficient context for processing.

Persistent state belongs to the Backend API.

---

## Provider Independence

The AI Engine must never depend on a specific AI vendor.

Every model interaction should occur through provider abstractions.

This enables:

- DeepSeek

- Ollama

Future providers should require no architectural changes.

---

## Streaming First

Every subsystem should support streaming execution.

The engine must never wait for an entire meeting before producing output.

---

## Modular Intelligence

Each capability should exist as an independent module.

Examples include:

- Speech Recognition

- Speaker Diarization

- Event Detection

- Knowledge Retrieval

- Recommendation Generation

Future capabilities should be added by introducing new modules rather than modifying existing ones.

---

# 3. AI Engine Responsibilities

The AI Engine owns every intelligence-related capability.

Its responsibilities include:

- Streaming speech recognition
- Speaker diarization
- Conversation segmentation
- Context building
- Event detection
- Entity extraction
- Competitor detection
- Product detection
- Intent recognition
- Retrieval-Augmented Generation
- Recommendation generation
- Confidence scoring
- Conversation summarization (future)
- Translation (future)

The AI Engine explicitly does NOT own:

- Authentication
- Authorization
- Database access
- User management
- Dashboard updates
- CRM integration
- File uploads
- Session management

Those responsibilities belong to the Backend API.

---

# 4. High-Level Architecture

```
                    Audio Streams

             Microphone     Desktop Audio

                    │              │

                    └──────┬───────┘

                           │

                  Audio Normalization

                           │

                  Speech Recognition

                           │

                  Speaker Diarization

                           │

                  Conversation Builder

                           │

                  Context Window

                           │

                  Event Engine

                           │

          ┌────────────────┼────────────────┐

          │                │                │

     Entity Engine    RAG Engine    Recommendation Engine

          │                │                │

          └────────────────┼────────────────┘

                           │

                 Structured Intelligence

                           │

                     Backend API
```

Each stage produces structured output consumed by the next stage.

No component should skip intermediate stages.

---

# 5. Processing Philosophy

The AI Engine does not ask an LLM to understand the entire meeting repeatedly.

Instead, intelligence is constructed incrementally.

Every processing stage enriches the conversation with additional information.

Example

Raw Audio

↓

Transcript

↓

Speakers

↓

Entities

↓

Events

↓

Knowledge

↓

Recommendations

↓

Dashboard

This layered approach dramatically reduces latency while improving explainability.

---

# 6. Core Processing Pipeline

The AI Engine consists of seven independent processing stages.

## Stage 1

Audio Processing

Responsibilities

- Receive streaming audio

- Validate format

- Normalize audio

- Prepare chunks

Output

Normalized audio frames

---

## Stage 2

Speech Recognition

Responsibilities

Convert audio into streaming transcript.

Output

Timestamped transcript.

---

## Stage 3

Speaker Diarization

Responsibilities

Determine:

Who spoke?

When?

For how long?

Output

Speaker-labelled transcript.

---

## Stage 4

Conversation Builder

Responsibilities

Convert individual transcript fragments into coherent conversational blocks.

Example

Instead of

Customer:

"I"

"Need"

"Pricing"

Conversation Builder creates

Customer

"I need pricing."

Output

Conversation segments.

---

## Stage 5

Context Builder

Responsibilities

Maintain short-term meeting memory.

Track

- Current topic

- Active products

- Competitors

- Customer objectives

- Previous references

This context is temporary.

Persistent memory belongs to future platform versions.

---

## Stage 6

Event Engine

Responsibilities

Transform conversation into structured business events.

Examples

Pricing Discussion

Competitor Mention

Buying Signal

Technical Question

Security Concern

Timeline Discussion

Budget Discussion

Feature Request

Output

Structured Events

---

## Stage 7

Knowledge Intelligence

Uses:

RAG

Product Documentation

Internal PDFs

Markdown

DOCX

Produces:

Recommendations

Product comparisons

Supporting documentation

Suggested talking points

Structured business intelligence

---

# 7. Streaming Architecture

Traditional AI systems process conversations after completion.

CallPilot AI processes conversations while they occur.

Every stage begins execution immediately.

```
Audio Chunk

↓

STT

↓

Speaker Detection

↓

Conversation Update

↓

Event Detection

↓

Knowledge Retrieval

↓

Dashboard
```

No stage waits for meeting completion.

---

# 8. Pipeline Latency Targets

Although overall meeting intelligence depends on multiple components, each stage should target independent latency budgets.

| Stage | Target |
|----------|------------|
| Audio Normalization | <20 ms |
| Streaming STT | 150–300 ms |
| Speaker Diarization | <200 ms |
| Context Builder | <50 ms |
| Event Detection | <250 ms |
| Knowledge Retrieval | <300 ms |
| Recommendation Generation | <1000 ms |

Overall recommendation latency target:

1–2 seconds.

This provides a near real-time user experience without sacrificing reasoning quality.

---

# 9. Stateless Execution

Every request processed by the AI Engine must contain sufficient context.

The AI Engine should never query PostgreSQL.

The AI Engine should never maintain meeting history internally.

Every processing request should include:

- Current transcript window
- Current conversation context
- Relevant knowledge references
- Provider configuration

This enables horizontal scaling without synchronization between AI instances.

---

# 10. AI Engine Principles

Every contributor working on the AI Engine must follow these principles.

1. Never place business logic inside AI prompts.

2. Prefer deterministic processing whenever possible.

3. Use LLM reasoning only when traditional algorithms are insufficient.

4. Avoid repeated model invocations.

5. Cache intelligently.

6. Prefer structured JSON over natural language.

7. Every output should include confidence scores.

8. Every recommendation should be explainable.

9. Every module should be independently testable.

10. AI should assist, never invent.

The AI Engine exists to convert conversations into reliable business intelligence—not to generate creative responses.

---

End of Part 1