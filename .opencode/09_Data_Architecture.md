# 09_Data_Architecture.md

Version: 1.0

Status: Approved

---

# Purpose

This document defines the complete data architecture for CallPilot AI.

It specifies:

- Data ownership
- Persistence boundaries
- Aggregate relationships
- Indexing strategy
- Audit strategy
- Migration policy
- Vector storage
- Performance guidelines

The database exists to support business workflows—not application layers.

PostgreSQL is the authoritative source of truth for all persisted business data.

---

# Design Principles

The persistence layer follows these principles.

- PostgreSQL is the primary datastore.
- One source of truth for business data.
- pgvector is used for semantic search.
- No business logic inside SQL.
- Every table has an owner.
- Every table is versioned through migrations.
- Every entity is auditable.
- Data should be normalized unless read performance requires denormalization.

---

# Data Ownership

Every major feature owns its own data.

```
Authentication
    │
    ├── Users
    ├── RefreshTokens
    └── Sessions

Meetings
    │
    ├── Meetings
    ├── TranscriptSegments
    ├── ConversationEvents
    └── Recommendations

Knowledge
    │
    ├── Documents
    ├── Chunks
    └── Embeddings

Providers
    │
    └── ProviderConfigurations

Diagnostics
    │
    ├── Metrics
    └── AuditLogs
```

No feature should write directly into another feature's tables except through defined workflows.

---

# Core Aggregates

The following aggregates define the primary business model.

```
User

Meeting

KnowledgeDocument

ProviderConfiguration

Recommendation
```

Each aggregate owns its lifecycle.

---

# Entity Relationships

```
User
 │
 ├──────────────┐
 │              │
 ▼              ▼
Meetings    ProviderConfigurations
 │
 ├──────────────┐
 │              │
 ▼              ▼
Transcript   Recommendations
 │
 ▼
ConversationEvents

KnowledgeDocument
 │
 ▼
KnowledgeChunk
 │
 ▼
Embedding
```

The graph intentionally avoids circular ownership.

---

# Meeting Aggregate

The Meeting aggregate contains:

- Metadata
- Status
- Timing
- Active provider reference
- Meeting summary
- Diagnostics reference

Transcript segments, events, and recommendations reference the Meeting through foreign keys.

---

# Transcript Storage

Transcripts are stored incrementally.

Each segment contains:

- Meeting ID
- Speaker ID
- Sequence Number
- Start Timestamp
- End Timestamp
- Text
- Confidence
- Created At

The complete transcript is reconstructed by ordering segments by sequence number.

This avoids rewriting large text blobs during live meetings.

---

# Conversation Events

Conversation events are persisted separately from transcripts.

Examples:

- Competitor Mentioned
- Pricing Objection
- Technical Question
- Buying Signal

Each event references:

- Meeting
- Transcript Segment
- Timestamp
- Confidence
- Source Worker

This enables analytics without reprocessing transcripts.

---

# Recommendations

Recommendations are immutable records.

Each recommendation stores:

- Meeting ID
- Trigger Event
- Generated Text
- Confidence
- Knowledge References
- Provider
- Model
- Generated At

Historical recommendations must never be modified.

---

# Knowledge Storage

Documents are separated into three logical entities.

```
Document

↓

Chunk

↓

Embedding
```

### Document

Stores:

- File metadata
- Original filename
- MIME type
- Upload date
- Processing status

### Chunk

Stores:

- Chunk number
- Text
- Token count
- Character offsets

### Embedding

Stores:

- Chunk ID
- Vector (pgvector)
- Embedding model
- Dimensions
- Generated timestamp

---

# Provider Configuration

Provider configurations belong to individual users.

Stored values include:

- Provider
- Model
- Endpoint
- Encrypted API key
- Temperature
- Max tokens
- Timeout
- Enabled capabilities

API keys are encrypted before persistence.

Plain-text keys must never be stored.

---

# Audit Strategy

Every aggregate includes standard audit fields.

```
CreatedAt

CreatedBy

UpdatedAt

UpdatedBy

DeletedAt

DeletedBy
```

Deletion is soft by default unless explicitly documented.

---

# Soft Deletes

Business entities should use soft deletes.

Examples:

- Knowledge documents
- Meetings
- Provider configurations

Operational data such as temporary metrics may be hard deleted.

---

# Migration Strategy

All schema changes are managed through EF Core migrations.

Rules:

- No manual schema changes in production.
- Every migration is reviewed.
- Migrations are idempotent.
- Rollback path required for breaking changes.

---

# Indexing Strategy

Primary indexes:

- Meeting ID
- User ID
- Created At
- Provider ID
- Status

Composite indexes:

- Meeting + Sequence Number
- Meeting + Timestamp
- User + Created At

Vector indexes:

- pgvector HNSW (preferred)
- IVF Flat (optional for large datasets)

Indexes should be reviewed regularly using query plans.

---

# Partitioning Strategy

Phase 1:

Single PostgreSQL instance.

Future:

Partition large tables by:

- Meeting date
- Organization (multi-tenant)
- Archive status

Partitioning should be transparent to application code.

---

# Concurrency

Optimistic concurrency should be used for mutable aggregates.

Examples:

- Meeting state
- Provider configuration

Transcript segments and recommendations are append-only and do not require updates.

---

# Data Retention

Retention policies should be configurable.

Suggested defaults:

Meetings

365 days

Transcript Segments

365 days

Recommendations

365 days

Knowledge Documents

Until deleted by the user

Audit Logs

180 days

Retention policies must be configurable by deployment.

---

# Backup Strategy

Recommended backups include:

- Nightly full backup
- Hourly WAL archiving
- Weekly restore validation

Embeddings and relational data should be backed up together.

---

# Performance Guidelines

Target query times:

Meeting lookup

<50 ms

Transcript retrieval

<100 ms

Knowledge retrieval

<250 ms

Recommendation history

<100 ms

Vector search

<300 ms

Performance budgets should be monitored continuously.

---

# Security

Sensitive fields must be encrypted.

Examples:

- Provider API keys
- Refresh tokens

Passwords are stored only as secure hashes.

No business secrets should be logged.

---

# Future Evolution

The data architecture supports future additions including:

- Organizations
- Teams
- CRM integrations
- Shared knowledge bases
- Analytics
- Customer memory
- Multi-region deployments

Future features should extend existing aggregates where appropriate.

---

# Engineering Principles

The persistence layer should remain:

- Predictable
- Auditable
- Observable
- Performant
- Provider independent
- AI independent

Business meaning should always take precedence over implementation convenience.

---

# Conclusion

The data architecture provides a stable, scalable foundation for CallPilot AI.

It separates business aggregates, preserves auditability, enables efficient semantic search, and supports future growth without requiring fundamental schema redesign.

The database is not merely a storage mechanism—it is the persistent representation of the platform's business state.

---

**End of Document — 09_Data_Architecture.md**