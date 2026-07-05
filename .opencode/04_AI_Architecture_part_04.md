# 04_AI_Architecture.md

## Part 4 — Knowledge Intelligence & RAG Engine

---

# 49. Purpose

The Knowledge Intelligence Engine provides the AI Engine with access to organizational knowledge.

Its purpose is not to answer arbitrary questions.

Its purpose is to retrieve the smallest possible amount of highly relevant information that helps the salesperson continue the current conversation.

Unlike traditional Retrieval-Augmented Generation systems, CallPilot AI performs retrieval based on structured business events and active conversation context rather than simple semantic similarity.

The Knowledge Engine transforms static documentation into live meeting intelligence.

---

# 50. Design Goals

The Knowledge Engine should:

- Retrieve only relevant knowledge.
- Minimize LLM token usage.
- Produce deterministic retrieval.
- Support multiple document formats.
- Support multiple embedding providers.
- Operate independently from the LLM.
- Remain provider agnostic.
- Support future enterprise integrations.

---

# 51. High-Level Architecture

```
Conversation Events
        │
        ▼
Knowledge Trigger
        │
        ▼
Query Builder
        │
        ▼
Embedding Generator
        │
        ▼
Vector Search
        │
        ▼
Re-Ranker
        │
        ▼
Context Builder
        │
        ▼
Prompt Composer
        │
        ▼
Recommendation Engine
```

Every stage performs a single responsibility.

---

# 52. Why Event-Driven Retrieval?

Traditional RAG performs retrieval only after receiving a user question.

Example

```
"How do we compare against Salesforce?"
```

↓

Search

↓

LLM

CallPilot AI instead begins retrieval as soon as this event appears.

```
CompetitorMentioned

↓

Salesforce

↓

Retrieve Comparison Documents

↓

Prepare AI Context

↓

Wait
```

If the customer later asks:

> "Why should we switch?"

The knowledge is already available.

No additional retrieval delay occurs.

---

# 53. Supported Knowledge Sources (Phase 1)

Phase 1 intentionally supports a small set of high-value document types.

Supported formats

- PDF
- DOCX
- Markdown

Rejected for Phase 1

- Website crawling
- SharePoint
- Notion
- Confluence
- Google Drive

These will be introduced in later phases through connectors.

---

# 54. Document Processing Pipeline

Every uploaded document follows the same ingestion workflow.

```
Upload

↓

Validation

↓

Text Extraction

↓

Cleaning

↓

Chunking

↓

Embedding Generation

↓

Metadata Extraction

↓

Vector Storage

↓

Index Ready
```

Documents are processed once during ingestion.

No document parsing occurs during live meetings.

---

# 55. Text Extraction

Extraction should preserve as much semantic structure as possible.

Examples

Preserve:

- Headings
- Lists
- Tables (where possible)
- Paragraph boundaries
- Code blocks
- Captions

Avoid flattening everything into plain text.

Document structure improves retrieval quality.

---

# 56. Chunking Strategy

Chunk quality has a direct impact on retrieval accuracy.

Chunks should follow semantic boundaries instead of fixed character counts.

Preferred order

1. Section
2. Heading
3. Paragraph
4. Sentence

Avoid splitting in the middle of concepts.

Each chunk should be independently understandable.

---

# 57. Metadata

Every chunk should contain metadata.

Example

```json
{
  "documentId": "...",
  "documentName": "Pricing Guide",
  "section": "Enterprise Licensing",
  "page": 14,
  "category": "Pricing",
  "tags": [
    "Enterprise",
    "Annual",
    "Discount"
  ]
}
```

Metadata becomes essential for filtering and explainability.

---

# 58. Embedding Generation

Embeddings convert document chunks into numerical vectors.

Requirements

- Provider abstraction
- Local model support
- Cloud provider support
- Batch processing
- Docker compatibility

The embedding provider must be replaceable without affecting downstream services.

---

# 59. Architecture Decision — Vector Database

Decision

Use PostgreSQL with pgvector.

Reasons

- Single database technology
- Simpler deployment
- Mature ecosystem
- Excellent Docker support
- ACID compliance
- Easier backup strategy
- Lower operational complexity

Rejected

Dedicated vector databases during Phase 1.

The architecture should support future migration if necessary.

---

# 60. Retrieval Pipeline

Retrieval consists of multiple stages.

```
Event

↓

Query Builder

↓

Embedding

↓

Vector Search

↓

Metadata Filter

↓

Re-Ranking

↓

Context Builder

↓

LLM
```

No single search stage should determine final relevance.

---

# 61. Query Builder

The Query Builder transforms structured events into retrieval queries.

Example

Event

```
CompetitorMentioned

Salesforce
```

Generated search context

```
Salesforce comparison

Migration guide

Competitive advantages

Enterprise pricing

Implementation differences

Customer success stories
```

This produces significantly better retrieval than using the transcript verbatim.

---

# 62. Re-Ranking

Vector similarity alone is insufficient.

Retrieved chunks should be re-ranked using additional signals.

Possible ranking factors

- Semantic similarity
- Document freshness
- Product version
- Category relevance
- Mention frequency
- Event type
- Confidence score

Future versions may incorporate cross-encoder re-ranking models.

---

# 63. Context Builder

The Context Builder assembles retrieved knowledge into a compact, structured payload.

Instead of forwarding ten independent chunks to the LLM, the Context Builder creates a coherent context package.

Example

```
Customer uses Salesforce

Relevant documents

Pricing Guide

Migration Guide

CRM Comparison

Security Whitepaper
```

This minimizes token usage while preserving information quality.

---

# 64. Prompt Composer

The Prompt Composer is responsible for constructing deterministic prompts.

Inputs include

- Conversation context
- Structured events
- Retrieved knowledge
- Confidence scores
- User configuration

Prompt templates must be versioned and testable.

Business rules must never be embedded inside prompt text.

---

# 65. Recommendation Generation

The Recommendation Engine receives

- Context
- Events
- Knowledge
- Conversation state

It returns structured recommendations.

Example

```json
{
  "type": "CompetitorComparison",
  "title": "Salesforce Comparison",
  "confidence": 0.97,
  "summary": "...",
  "references": [
    "Migration Guide",
    "Enterprise Pricing"
  ]
}
```

Natural language explanations should be accompanied by references to supporting documentation.

---

# 66. Explainability

Every recommendation must answer three questions.

1. Why was this recommendation generated?
2. Which events triggered it?
3. Which documents support it?

The user should never receive unexplained AI advice.

---

# 67. Caching Strategy

Repeated retrieval should be avoided.

Cache opportunities include

- Embeddings
- Document chunks
- Search results
- Re-ranked contexts

Caching should be scoped to the active meeting session.

---

# 68. Failure Handling

If retrieval fails

- Continue transcription.
- Continue event detection.
- Skip recommendation generation.
- Notify the Backend API.
- Surface degraded service status.

The absence of knowledge retrieval should never interrupt the meeting.

---

# 69. Guiding Principles

The Knowledge Intelligence Engine exists to retrieve facts—not opinions.

It should prioritize:

- Precision over volume.
- Structured context over raw documents.
- Event-driven retrieval over keyword search.
- Explainability over hidden reasoning.
- Provider abstraction over vendor lock-in.

Knowledge retrieval should always reduce uncertainty, never introduce it.

---

End of Part 4