# CallPilot AI — Codebase Context

> Comprehensive reference for working on the codebase. Update this when architecture, contracts, or conventions change. For session working notes, see `CLAUDE.md`.

---

## 1. What this is

**CallPilot AI** — open-source, real-time AI sales intelligence platform. Assists sales reps during live meetings: live transcription, speaker ID, conversation intelligence (competitors / pricing / objections / technical questions / product mentions), knowledge retrieval, contextual recommendations. BYOK (DeepSeek / Ollama / OpenAI / Claude / Gemini). Self-hosted via Docker.

**Pipeline at a glance:** `Audio (FFmpeg) → STT (Nemotron) → Transcript → Event Detection → Knowledge Retrieval → Recommendation → Dashboard`

---

## 2. Stack

| Layer | Tech | Path |
|---|---|---|
| Backend | **.NET 10** — ASP.NET Core minimal APIs, SignalR, EF Core, FluentValidation, Polly, Serilog | `src/CallPilot.Server/` |
| AI Engine | **Python 3.12** — FastAPI, Nemotron (NVIDIA streaming STT), GLiNER, Docling, Sentence-Transformers, Tavily, Groq, Redis | `src/callpilot-ai-engine/` |
| Dashboard | **Next.js 15** + React 19 + TailwindCSS 4 + `@microsoft/signalr` | `src/callpilot-dashboard/` |
| Desktop Agent | **.NET 10** CLI — FFmpeg audio capture + SignalR client | `src/CallPilot.Desktop/` |
| Database | **PostgreSQL 17 + pgvector** | docker-compose |
| Cache | **Redis 7** | docker-compose |
| Local LLM (opt-in) | **Ollama** (`ollama` profile) | docker-compose |
| Competitive intel | **Tavily** web search | env var |

---

## 3. Solution layout

```
src/
├── CallPilot.slnx
├── contracts/                          # currently empty stub (README only)
├── docker/                             # Dockerfiles (server, ai-engine, dashboard, desktop)
├── callpilot-ai-engine/                # Python FastAPI service
├── callpilot-dashboard/                # Next.js frontend
├── CallPilot.Desktop/                  # Standalone FFmpeg + SignalR audio-capture agent
└── CallPilot.Server/                   # All .NET backend projects (clean/onion architecture)
    ├── CallPilot.Server.Shared/        # Abstractions/IServices.cs (IJwtTokenGenerator, IPasswordHasher, IApiKeyEncryptionService)
    ├── CallPilot.Server.Domain/        # Entities, value objects. No external deps.
    ├── CallPilot.Server.Infrastructure/→ Domain, Shared  # EF Core, AI clients, encryption, chunkers, embeddings
    ├── CallPilot.Server.Application/   → Domain, Infrastructure, Shared  # Use-case handlers (CQRS-lite, no MediatR)
    ├── CallPilot.Server.Api/           → Application, Infrastructure  # ONLY Sdk.Web project. Entry point.
    └── CallPilot.Server.Tests/         → Api, Desktop  # xUnit + EF In-Memory + Moq
```

Project reference graph is a strict onion: `Shared → Domain → Infrastructure → Application → Api`. Desktop project has zero project refs (uses `Microsoft.AspNetCore.SignalR.Client` directly).

---

## 4. .NET backend — `CallPilot.Server`

### 4.1 Entry point — `CallPilot.Server.Api/Program.cs` (single-file composition root, ~486 lines)

**Key responsibilities:**
- `WebApplication.CreateBuilder` at `Program.cs:30` — no `Startup.cs`.
- **Serilog** wired at host level (reads `Logging` config, console sink).
- **DbContext** registered with `UseNpgsql` from `ConnectionStrings:DefaultConnection`.
- **JWT bearer auth** (HS256). Custom `OnMessageReceived` lifts `access_token` query string for SignalR `/hubs/*`. Custom `OnChallenge` re-stamps CORS headers on 401 to prevent browser dropping the challenge.
- **CORS** hardcoded `["http://localhost:3000"]`, `AllowCredentials`, `WithExposedHeaders("*")`.
- **SignalR** registered.
- **DI registrations** (lines 130–207):
  - Singletons: `JwtTokenGenerator`, `PasswordHasher`, `ApiKeyEncryptionService`, `ChunkingService`, three `ITextExtractor` impls, `TextExtractorFactory`, `CacheService`, `MeetingDiagnosticsService`.
  - Scoped handlers (vertical-slice): `Register/Login/Refresh/Logout/CreateProvider/ListProviders/DeleteProvider` + FluentValidation validators + `KnowledgeUploadHandler`, `StructuredIngestClient`, `EnrichmentClient`.
  - Typed HttpClients (Polly retry, exponential backoff): `AiCoordinatorService` (30s/3 retries, 2ⁿ×200ms), `EmbeddingService` (60s/2 retries), `EventDetectionService` (15s/3 retries), named `"LlmClient"` (30s/2 retries), named `"AiEngine"` (120s/no retry).
  - Scoped: `VectorSearchService`, `PromptBuilder`, `LlmService`, `RecommendationEngine`.
- **Health checks:** `DbHealthCheck` (`SELECT 1`) tag `database`; `UrlHealthCheck(aiEngineUrl + "/health")` tag `ai` (degraded on failure).
- **Migrations run on startup** via `await db.Database.MigrateAsync()` (lines 217–238) — switched from `EnsureCreatedAsync` because a migration had been silently ignored.
- **Endpoint groups** mapped (lines 306–310): `MapAuthenticationEndpoints`, `MapProviderEndpoints`, `MapKnowledgeEndpoints`, `MapHub<DesktopAgentHub>("/hubs/desktop-agent")`, `MapHub<DashboardHub>("/hubs/dashboard")`.
- **Inline minimal-API endpoints:**
  - `GET /health`, `GET /health/detailed` (lines 250–271)
  - `GET /api/v1/diagnostics/meetings/{meetingId}` (273), `GET /api/v1/diagnostics` (291)
  - `POST /api/v1/meetings`, `GET /api/v1/meetings`, `GET /api/v1/meetings/{id:guid}/transcripts`, `GET /api/v1/meetings/{id:guid}/recommendations`, `POST /api/v1/meetings/{id:guid}/process` (312–417). All `[RequireAuthorization]`.
  - `GET /api/v1/knowledge/entities/all`, `POST /api/v1/knowledge/entities/sync-trie` (421–443).
  - **`GET /internal/knowledge/entities`** (450–456) — anonymous service-to-service dump for AI engine trie sync (called via docker network, no JWT).
  - **`POST /internal/llm/generate`** (460–479) — proxy used by AI engine for competitive-intel prompts.
- Anonymous request records at bottom: `GenerateRequest(string Prompt, string? MeetingId)` and `ProcessTextRequest(string text)`.

### 4.2 Endpoints

| File | Purpose |
|---|---|
| `Endpoints/AuthenticationEndpoints.cs` (82 LOC) | `MapAuthenticationEndpoints(this WebApplication)` — `/api/v1/auth/{register,login,refresh,logout}`. Only logout requires auth. |
| `Endpoints/ProviderEndpoints.cs` (64 LOC) | `/api/v1/providers` (RequireAuthorization) — `GET /`, `POST /` (upsert on `(UserId, ProviderType)`), `DELETE /{id:guid}`. |
| `Endpoints/KnowledgeEndpoints.cs` (412 LOC) | `/api/v1/knowledge` (Authorize) — `POST /upload?mode=fast\|structured` (multipart), `GET /`, `GET /{id}`, `DELETE /{id}`, `GET /entities/{name}/details`, `GET /{id}/status`, `GET /{id}/raw-output`, `POST /{id}/reindex`. |
| `Endpoints/DbHealthCheck.cs` (31 LOC) | Opens `NpgsqlConnection`, runs `SELECT 1`. |
| `Endpoints/UrlHealthCheck.cs` (32 LOC) | Generic `IHealthCheck` with 5s timeout. |

### 4.3 SignalR Hubs

**`Hubs/DesktopAgentHub.cs`** (235 LOC, `[Authorize]`):
- `RegisterAgent(AgentRegistration)` — logs version/platform/capabilities.
- `SendAudioFrame(AudioFrameMessage)` — **main ingestion path**. Calls `AiCoordinatorService.ProcessAudioAsync`, tracks latency in `MeetingDiagnosticsService`, broadcasts `TranscriptReceived`, then for final segments calls `EventDetectionService.DetectEventsForMeetingAsync`, persists `ConversationEvent`s, generates recommendations, broadcasts `EventDetected`/`RecommendationGenerated`.
- `SendHeartbeat`, `JoinMeeting`, `LeaveMeeting`.
- Outbound events: `AgentRegistered`, `SilenceDetected`, `AudioFrameAcknowledged`, `TranscriptReceived`, `EventDetected`, `RecommendationGenerated`.
- DTOs: `AgentRegistration`, `AudioFrameMessage`, `HeartbeatMessage`.

**`Hubs/DashboardHub.cs`** (40 LOC, `[Authorize]`): Only `JoinMeeting`/`LeaveMeeting` against `meeting_{id}` group + connection logging. **Currently unused by the dashboard** (dashboard connects to `/hubs/desktop-agent` instead because that's where broadcasts happen).

### 4.4 Application layer (vertical-slice CQRS-lite, no MediatR)

**Authentication/** — each use case in its own folder with `Command.cs + Handler.cs + Validator.cs`:
- `Login/`, `Register/`, `Refresh/`, `Logout/`. Standard access + refresh token rotation with `RefreshToken.IsActive` check.

**Providers/** — `Create/`, `List/`, `Delete/`. Create is an **upsert** keyed on `(UserId, ProviderType)`; encrypts API key via `IApiKeyEncryptionService`.

**Knowledge/** — three large files:
- **`KnowledgeUploadHandler.cs`** (1074 LOC) — the document pipeline heart.
  - `UploadAsync(userId, fileName, contentType, fileSize, stream, IngestMode mode=Fast)` → saves to disk, seeds stage skeleton, runs `ProcessAsync`. Fires-and-forgets `ExtractAndStoreEntitiesAsync` (GLiNER, all modes) and `RunBackgroundEnrichmentAsync` (LLM enrichment, structured only).
  - `ReindexAsync(userId, documentId, IngestMode mode=Fast)` — wipes chunks/embeddings/entities, re-runs.
  - `ProcessAsync` orchestrates `extracting → chunking → embedding → indexed → entityextraction (async) → enriching (async, structured only)`. Uses inner `IngestStageRecorder` helper.
  - `ExtractFastAsync` — Docnet.Core (PDF), DocxTextExtractor (DOCX), MarkdownTextExtractor fallback. Sanitizes null bytes / replacement chars.
  - `ExtractStructuredAsync` — forwards PDF to Python `/api/v1/documents/ingest-structured`.
  - `EmbedChunksAsync` — per-chunk: persist `KnowledgeChunk`, call `EmbeddingService.GenerateEmbeddingAsync` (or `GenerateLocalEmbedding` fallback), persist `Embedding`, heartbeat every 10 chunks.
  - `ExtractAndStoreEntitiesAsync` — POSTs `/api/v1/ai/extract-entities` with `confidence_threshold=0.3` (lowered in commit `570ec38`), persists `DocumentEntity` rows, rebuilds the Aho-Corasick trie via `RebuildTrieAsync`.
  - **`RunBackgroundEnrichmentAsync`** (lines 536–924) — streams NDJSON from `/api/v1/documents/enrich`. On success: deletes original Docling chunks + embeddings, inserts one `KnowledgeChunk` per `EnrichedProductDto` with `chunkType="product_card"` and `source="enriched"`, embeds them, **auto-registers each LLM-confirmed product name as `DocumentEntity(EntityType='product', Confidence=0.95)`** (the product-detection-gap fix), then re-runs GLiNER on full text.
  - Nested types: `enum IngestMode { Fast, Structured }`, DTOs, `IngestStageRecorder` inner class.
- **`StructuredIngestClient.cs`** (198 LOC) — calls `/api/v1/documents/ingest-structured`. Returns `StructuredIngestResult { Chunks, Docling? }`.
- **`EnrichmentClient.cs`** (232 LOC) — calls `/api/v1/documents/enrich`. Returns `IAsyncEnumerable<EnrichEvent>` via `HttpCompletionOption.ResponseHeadersRead`. Discriminator `kind`: `"page"` → `EnrichPageResult`, `"summary"` → `EnrichSummary`.

### 4.5 Domain entities

**Knowledge/**
- `KnowledgeDocument.cs` (365 LOC) — central aggregate. Fields: `Id, UserId, FileName, ContentType, FileSizeBytes, ProcessingStatus, EnrichmentStatus?, Mode?, StoragePath?, CreatedAt, UpdatedAt?, DeletedAt?, StagesJson?, LastErrorJson?, RawOutputJson?, EnrichmentProgressJson?`. Stage recorder API: `RecordStageRunning/Done/Failed/Skipped/Pending`, `SetStageDetail`, `SetRawOutput(source, payload)` (merges into existing jsonb), `SetEnrichmentProgress`. `[NotMapped]` accessors `Stages`, `LastError`, `EnrichmentProgress`.
- `KnowledgeChunk.cs` (65 LOC) — `Id, DocumentId, ChunkIndex, Text, TokenCount, CharOffset, CharLength, CreatedAt, SectionHeading?, ChunkType, PageHint, MetadataJson?, Source`. `ChunkType` values: `"paragraph"|"bullet_group"|"oversized_paragraph"|"table_row"|"heading"|"list_item"|"product_card"`. `Source`: `"fast"|"structured"|"enriched"`.
- `Embedding.cs` (36 LOC) — stores vector as **comma-separated text** in `VectorData` (in-process cosine sim, not pgvector at EF layer).
- `IngestStage.cs` (48 LOC) — `record IngestStage(Key, Label, Status, StartedAt?, FinishedAt?, Detail?, Error?)` + `record IngestStageError(Stage, Source, HttpStatus?, Message, Model?, At)`. `Source` values: `"ai-engine"|"groq"|"gliner"|"dotnet"|"unknown"`.
- `EnrichmentProgress.cs` (65 LOC) — `record EnrichmentProgress(Total, Completed, Failed, InFlight, Pages)` + `record EnrichmentPageStatus(Page, Status, Model?, DurationMs, Error?, FinishedAt?, RetryCount=0)`.

**Meetings/** — `Meeting`, `TranscriptSegment`, `ConversationEvent`, `Recommendation`, `DocumentEntity`. All "enum-like" fields are plain strings (no enums anywhere).

**Providers/** — `ProviderConfiguration` (64 LOC) — `Id, UserId, ProviderType, Model, Endpoint?, EncryptedApiKey, Temperature, MaxTokens, TimeoutSeconds, IsEnabled, CreatedAt, UpdatedAt?, DeletedAt?`.

**Users/** — `User` (32 LOC), `RefreshToken` (33 LOC with `IsActive`, `IsExpired`, `IsRevoked`, `Revoke()`).

### 4.6 Infrastructure

**`Data/CallPilotDbContext.cs`** (192 LOC) — DbSets for all entities. Key config:
- Soft-delete query filters on `User`, `ProviderConfiguration`, `KnowledgeDocument`.
- Unique indexes: `Users.Email`, `RefreshTokens.Token`, `ProviderConfigurations(UserId, ProviderType)`.
- **jsonb columns** with GIN indexes on `KnowledgeDocuments.StagesJson/LastErrorJson/RawOutputJson/EnrichmentProgressJson` and `KnowledgeChunks.MetadataJson`.
- `KnowledgeChunks.Source` defaults to `"fast"`, max 16. **Unique index `(DocumentId, ChunkIndex)` was DROPPED** in migration `20260719092306_DropUniqueChunkIndex` to allow the enrichment 2-phase replace.
- `Embeddings.VectorData` is `text`, unique on `ChunkId`, 1:1 with `KnowledgeChunk`.

**12 migrations** applied in order:
1. `20260705143004_InitialCreate` — Users, RefreshTokens, ProviderConfigurations.
2. `20260705153356_AddMeetingAndTranscript` — Meetings, TranscriptSegments.
3. `20260705165230_AddKnowledgeEntities` — KnowledgeDocuments, KnowledgeChunks, Embeddings.
4. `20260705165753_AddConversationEvents`
5. `20260705170200_AddRecommendations`
6. `20260715172915_AddChunkStructureMetadata` — SectionHeading, ChunkType, PageHint, MetadataJson.
7. `20260718084046_AddEnrichmentStatus`
8. `20260718152300_AddDocumentMode`
9. `20260718160000_AddDocumentEntitiesTable` — **hand-edited** raw SQL with `IF NOT EXISTS`.
10. `20260719080738_AddDocumentStagesAndChunkSource` — **hand-edited** jsonb columns + GIN index.
11. `20260719085119_AddEnrichmentProgress` — **hand-edited** EnrichmentProgressJson.
12. `20260719092306_DropUniqueChunkIndex`.

**`AI/`** — wrappers around Python AI engine:
- **`AiCoordinatorService.cs`** (123 LOC) — `ProcessAudioAsync(meetingId, audio, sequence, sampleRate, channels, source, dbContext)` POSTs to `/api/v1/ai/transcribe/nemotron` (or legacy `/transcribe`). Parses `AiTranscribeResponse{TaskId, Success, Transcript?, Error, DurationMs, SilenceDetected}`, persists `TranscriptSegment`.
- **`EventDetectionService.cs`** (143 LOC) — `DetectEventsAsync(text)` POSTs to `/api/v1/ai/events`. After every call, `_= Task.Run(() => TriggerCompetitiveIntelAsync(...))` fires-and-forgets when heuristic regex `_competitiveTriggers` ("better than", "compared to", "we use", etc.) matches. Returns `DetectedEvent{EventType, EntityName, Confidence, Category, SupportingTranscript}`.
- **`LlmService.cs`** (138 LOC) — `GenerateResponseAsync(userId, prompt)` and `GenerateResponseForAnyProviderAsync(prompt)`. Looks up enabled `ProviderConfiguration` for user (or any). Switches on `provider.ProviderType.ToLowerInvariant()`: `"ollama"` → `{endpoint}/api/generate`, `"deepseek"`/`"openai"` → `{endpoint}/chat/completions`. Uses named HttpClient `"LlmClient"`.
- **`RecommendationEngine.cs`** (119 LOC) — `GenerateRecommendationAsync(meetingId, userId, ConversationEvent)`. Steps: build query (switch on EventType), `EmbeddingService.GenerateLocalEmbedding` (deterministic hash-based 384-dim), `VectorSearchService.SearchAsync(topK:3, userId)`, `PromptBuilder.BuildRecommendationPrompt`, `LlmService.GenerateResponseAsync`. Fallback to `BuildFallbackRecommendation` if LLM unavailable.
- **`PromptBuilder.cs`** (101 LOC) — `BuildRecommendationPrompt(eventType, entityName, transcript, knowledgeChunks)` + `BuildFallbackRecommendation` + private `GetContextualAdvice` switch.

**`Auth/`** — `JwtTokenGenerator` (HS256 + 64-byte refresh tokens), `PasswordHasher` (BCrypt workFactor 12).

**`Embedding/`** — `EmbeddingService.GenerateEmbeddingAsync(text, model="all-MiniLM-L6-v2")` POSTs `/api/v1/ai/embeddings`. `GenerateLocalEmbedding(text, dimensions=384)` is **deterministic hash-based** so query and indexed vectors share a space when AI engine is unreachable.

**`Encryption/`** — `ApiKeyEncryptionService` — AES-CBC, IV prepended, base64. Key from `Encryption:Key` config.

**`Knowledge/`**:
- **`ChunkingService.cs`** (247 LOC) — structure-aware chunker. Splits on `\n\n` paragraphs and `\f` form-feeds (bumps `currentPage`). Bullet groups coalesce. Short consecutive paragraphs (<800 chars) merge. Anything over 2000-char soft cap stays as `oversized_paragraph` (never split mid-paragraph).
- **`TextExtractors.cs`** (113 LOC) — `PdfTextExtractor` (Docnet.Core), `DocxTextExtractor` (`DocumentFormat.OpenXml`), `MarkdownTextExtractor` (StreamReader fallback). `TextExtractorFactory.GetExtractor(contentType)` → first match, falls back to MarkdownTextExtractor.
- **`VectorSearchService.cs`** (75 LOC) — brute-force cosine similarity (no ANN). Loads all chunks for user, top-K, returns. **Will not scale** — fine for prototype.

**`Reliability/`** — `CacheService` (wraps `IMemoryCache`, prefix-version is simple key invalidation), `MeetingDiagnosticsService` (in-memory `ConcurrentDictionary<string, MeetingMetrics>` with `TrackTranscript/Event/Recommendation/AudioFrame/Retry` and computed averages).

### 4.7 Shared abstractions

`Abstractions/IServices.cs` (20 LOC) — only file in Shared project:
- `IJwtTokenGenerator.GenerateAccessToken/GenerateRefreshToken/GenerateRefreshTokenWithExpiry`
- `IPasswordHasher.Hash/Verify`
- `IApiKeyEncryptionService.Encrypt/Decrypt`

DTOs live inline with the endpoint/handler that emits them — **no separate DTO types**.

### 4.8 Tests (`CallPilot.Server.Tests`)

xUnit 2.9.3 + Moq 4.20.72 + EF In-Memory 10.0.0. Pattern: `IAsyncLifetime` per-test in-memory DB.

- `Authentication/AuthenticationTests.cs` (194 LOC, 8 `[Fact]`s) — Register/Login/Refresh/Logout happy + sad paths.
- `Providers/ProviderTests.cs` (172 LOC, 7 `[Fact]`s) — Create upsert, List, Delete, encryption round-trip.
- `Hubs/DesktopAgentHubTests.cs` (54 LOC, 4 `[Fact]`s) — structural tests of hub DTOs only (no SignalR runtime).
- `Desktop/DesktopModelTests.cs` (56 LOC) — `AgentConfiguration` defaults, `AudioFrame`.
- `Desktop/AuthenticationServiceTests.cs` (120 LOC) — `MockHttpMessageHandler` for Login/Refresh.

---

## 5. Python AI engine — `callpilot-ai-engine/`

~5,593 LOC. Python 3.12 (Dockerfile), `>=3.11` per pyproject. **Stateless — never touches PostgreSQL directly**, talks only to .NET via HTTP.

### 5.1 Top-level layout

```
callpilot-ai-engine/
├── pyproject.toml
├── requirements-nemotron.txt          # OPTIONAL NeMo deps (gated by NEMOTRON_INSTALL build-arg)
├── engine/
│   ├── main.py                        # 618 LOC — FastAPI app + all endpoints
│   ├── models.py                      # 32 LOC — Pydantic models
│   ├── config/nemotron_config.py      # 71 LOC
│   ├── event_engine/event_detector.py # 117 LOC
│   ├── stt/{nemotron_pipeline.py, nemotron_websocket.py}
│   ├── services/                      # 9 modules
│   ├── knowledge_engine/{docling_service.py, embedding_service.py}
│   ├── routers/{nemotron_router.py, ingest_router.py}
│   └── recommendation_engine/         # empty stub — rec logic lives on .NET side
└── tests/                             # 6 test files + conftest
```

### 5.2 `engine/main.py` — FastAPI application entry

**Lifespan** (`main.py:74`):
1. If `NEMOTRON_ENABLED`, fire-and-forget background load of Nemotron.
2. Build empty trie via `build_trie([])`.
3. Spawn `_auto_load_trie_from_server()` — retries .NET `/internal/knowledge/entities` for up to 60s; falls back to `get_seed_entities()` on failure.

**All HTTP routes:**

| Method | Path | Handler | Line | Caller |
|---|---|---|---|---|
| GET | `/health` | `health()` | 197 | Docker HEALTHCHECK |
| POST | `/api/v1/ai/transcribe/nemotron` | `transcribe_audio_nemotron()` | 300 | .NET `AiCoordinatorService` |
| POST | `/api/v1/meetings/{meeting_id}/reset/nemotron` | `reset_meeting_nemotron()` | 458 | desktop agent |
| POST | `/api/v1/ai/events` | `detect_events()` | 472 | .NET `EventDetectionService` |
| POST | `/api/v1/ai/embeddings` | `generate_embedding()` | 482 | .NET `EmbeddingService` |
| POST | `/api/v1/ai/extract-entities` | `extract_entities_from_text()` | 498 | .NET ingest |
| POST | `/api/v1/ai/trie/rebuild` | `rebuild_trie()` | 521 | .NET after upload |
| GET | `/api/v1/ai/trie/status` | `trie_status()` | 550 | debugging |
| POST | `/internal/competitor-intel` | `competitor_intel()` | 566 | .NET `EventDetectionService` |
| DELETE | `/internal/competitor-cache/{competitor_name}` | `invalidate_competitor_cache()` | 613 | .NET cache busting |
| WS | `/ws/transcribe/nemotron` | `NemotronWebSocket.handle` | router | (mounted when `NEMOTRON_ENABLED`) |

Plus always-mounted ingest router: `POST /api/v1/documents/ingest-structured` and `POST /api/v1/documents/enrich` (NDJSON streaming).

**`_StreamingSession`** (line 219) — per-meeting Nemotron state. Decouples inference from request thread via `asyncio.create_task(_run_streaming_inference(...))` — returns last known partial immediately.

### 5.3 Event taxonomy — `engine/event_engine/event_detector.py`

`EventDetector.detect_all(text) → list[dict]` (line 98).

**TRIE_TYPE_EVENT_MAP** (line 31):
- trie `product` → `ProductMentioned` (0.92)
- trie `integration` → `TechnicalQuestion` (0.92)
- trie `pricing` → `PricingDiscussion` (0.92)
- trie `feature` → `TechnicalQuestion` (0.92)

**Direct detectors:**
- `PricingQuestion` — regex: `pric(e/ing)`, `cost`, `budget`, `expensive`, `per seat`, etc. (0.88)
- `Objection` (subtype in `entityName`) — Price/Security/Migration/Integration/Timeline/Competitor (0.85)
- `TechnicalQuestion` — `do you support`, `api`, `SSO`, `SAML`, `kubernetes`, `SLA`, etc. (0.84)

> **`PositiveBuyingSignal`/`NegativeBuyingSignal` REMOVED** (per CLAUDE.md). `CompetitorMentioned` emitted dynamically by competitor orchestrator, NOT by `event_detector`.

Regex tables at top: `PRICING_PATTERNS`, `OBJECTION_PATTERNS`, `TECHNICAL_PATTERNS`.

### 5.4 Nemotron STT — `engine/stt/`

**`nemotron_pipeline.py`** (423 LOC) — Singleton `NemotronPipeline` lazy-loads `nvidia/nemotron-speech-streaming-en-0.6b` via `nemo_asr.models.ASRModel.from_pretrained`. `NemotronSession` is per-stream dataclass with encoder KV cache, VAD, etc. Sliding-window cap `_MAX_PARTIAL_WINDOW_SECONDS=8s` keeps latency flat for long meetings. Two locks (`asyncio.Lock` async + `threading.Lock` sync) guarantee serialised inference.

**`nemotron_websocket.py`** (228 LOC) — Implements **pipecat-ai/nemotron-january-2026 WebSocket protocol** exactly. 1KB chunks (`_AUDIO_CHUNK_BYTES=1024`, 32ms @ 16kHz). Handles `reset/finalize/end/ping` control messages. Emits `ready/transcript/error/heartbeat/status/pong`.

### 5.5 Services — `engine/services/`

- **`trie_scanner.py`** (216 LOC) — Aho-Corasick entity scanner. `MIN_ENTITY_LEN=4`, `ACRONYM_ALLOWLIST` drops fragments like "han"/"am". `_has_word_boundary` enforces word-boundary matches. Skips `entity_type == "competitor"` (handled dynamically).
- **`seed_entities.py`** (144 LOC) — Hardcoded Secure Meters portfolio (18 products + 9 standards). Fallback when `/internal/knowledge/entities` empty or unreachable.
- **`text_normalizer.py`** (250 LOC) — Spoken-form → canonical ("apex one hundred" → "apex 100"). Includes "delisk" → "dlms cosem" alias.
- **`entity_extractor.py`** (154 LOC) — GLiNER wrapper (`knowledgator/gliner-multitask-large-v0.5`). **`GLINER_LABELS = ["product name", "software integration", "pricing tier", "product feature"]`** — `competitor` INTENTIONALLY excluded (dynamic). Used **only at ingest time**, never on live calls.
- **`enrichment_service.py`** (856 LOC) — LLM enrichment via **Groq** (`llama-3.1-8b-instant`). `EnrichedProduct.to_chunk_text()` produces stable format. Retries on rate-limit only, parses "Please try again in Xs" hint. `enrich_pages_streaming()` yields per-page as completed with `asyncio.Semaphore(3)` + `asyncio.wait_for(30s)`.
- **`competitor_classifier.py`** (99 LOC) — Phase 2A. Heuristic-first (`TRIGGER_PHRASES`: "better than", "compared to", "currently using", "vs", etc., 150-char proximity), LLM fallback.
- **`competitor_intel.py`** (176 LOC) — Phase 2+3. Tavily search + Redis cache (7-day TTL).
- **`competitive_prompt.py`** (136 LOC) — Phase 2C. Generates live sales-coach talking points. Confidence "high" if both web + your_chunks present.
- **`competitor_orchestrator.py`** (97 LOC) — Pipeline entry. `handle_unknown_entity()` returns `{"event_type": "CompetitorIntelCard", "competitor", "talking_points", "confidence", "sources", "cached", "meeting_id"}` or `None`.

### 5.6 Knowledge engine — `engine/knowledge_engine/`

- **`docling_service.py`** (225 LOC) — Structure-aware PDF parsing. Lazy-loaded. `DocumentConverter + HybridChunker`, OCR disabled (`do_ocr=False`). Singleton via `get_docling_service()`.
- **`embedding_service.py`** (36 LOC) — Sentence-Transformer `all-MiniLM-L6-v2`, device from `WHISPER_DEVICE` env var (legacy env var repurposed).

### 5.7 Routers

- **`nemotron_router.py`** (163 LOC) — `/health/nemotron`, `/ws/transcribe/nemotron`, batch `POST /transcribe/nemotron` (WAV/FLAC/PCM16 → resampled 16kHz).
- **`ingest_router.py`** (172 LOC) — `MAX_BYTES=50MB`. `/ingest-structured` (PDF → Docling → chunks). `/enrich` (NDJSON stream with `kind` discriminator).

### 5.8 Configuration

| Variable | Default | Used by |
|---|---|---|
| `NEMOTRON_ENABLED` | `true` | nemotron_config, main, .NET AiCoordinatorService |
| `NEMOTRON_MODEL_NAME` | `nvidia/nemotron-speech-streaming-en-0.6b` | nemotron_config |
| `NEMOTRON_RIGHT_CONTEXT` | `1` (0/1/6/13 → 80/160/560/1120 ms) | nemotron_config |
| `NEMOTRON_DEVICE` | `cpu` | nemotron_config |
| `NEMOTRON_CHUNK_MS` | `160` | nemotron_config |
| `NEMOTRON_VAD_SILENCE_MS` | `200` | nemotron_config |
| `NEMOTRON_VAD_RMS_THRESHOLD` | `0.001` (-60dB) | nemotron_config |
| `NEMOTRON_MIN_CHUNK_MS` | `320` | nemotron_pipeline |
| `NEMOTRON_EMIT_INTERVAL_MS` | `200` | nemotron_pipeline |
| `NEMOTRON_PARTIAL_WINDOW_SEC` | `8` | nemotron_pipeline |
| `GROQ_API_KEY` | **none** (raises `_MissingGroqKey`) | enrichment_service |
| `ENRICHMENT_MODEL` | `llama-3.1-8b-instant` | enrichment_service |
| `TAVILY_API_KEY` | `""` (disabled) | competitor_intel |
| `REDIS_URL` | `redis://localhost:6379` (docker: `redis://redis:6379`) | competitor_intel |
| `CALLPILOT_SERVER_URL` | `http://server:5001` | main (trie sync + LLM proxy) |
| `WHISPER_DEVICE` | `cpu` | embedding_service (legacy env var) |

### 5.9 Models loaded

| Model | Where | Source |
|---|---|---|
| Nemotron Speech Streaming | `NemotronPipeline._load_model()` line 138 | NVIDIA / HuggingFace |
| GLiNER Multitask Large v0.5 | `EntityExtractor._ensure_model()` line 70 | HuggingFace |
| Sentence-Transformer MiniLM-L6-v2 | `EmbeddingService.load_model()` line 16 | HuggingFace |
| Docling layout model | `DoclingIngestService._ensure_loaded()` line 77 | Docling + HF |
| Groq API (cloud) | `enrichment_service._get_groq_client()` line 329 | Groq |
| Tavily API (cloud) | `competitor_intel._tavily_search()` line 46 | Tavily |

`~/.cache/huggingface` persisted via `ai_engine_cache` volume.

### 5.10 Tests

| File | LOC | Covers |
|---|---|---|
| `conftest.py` | 13 | sys.path setup |
| `test_models.py` | 46 | Pydantic models |
| `test_trie_scanner.py` | 210 | Aho-Corasick trie behaviour |
| `test_text_normalizer.py` | 138 | Numbers-to-digits, aliases |
| `test_event_detector.py` | 213 | Regex detectors, trie entities, word-boundary regressions |
| `test_streaming_session.py` | 172 | Async decoupling, request latency |
| `test_enrichment_service.py` | 588 | Groq exception classification, parsing, retry, page processing |

Pure unit tests — no real models loaded. `pytest-asyncio` for async paths.

---

## 6. Next.js dashboard — `callpilot-dashboard/`

### 6.1 Stack

Next.js 15.5.20, React 19, TypeScript strict, TailwindCSS 4.3.2 (`@import "tailwindcss"` CSS-first), `@microsoft/signalr` 8. No component library, no React Query, no Zustand, no MUI/shadcn/Radix. **Standalone output** for Docker (`next.config.js: output: 'standalone'`).

### 6.2 Routes

| URL | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Server-side redirect to `/login` |
| `/login` | `src/app/login/page.tsx` | Login + register (single page, mode toggle) |
| `/dashboard` | `src/app/dashboard/page.tsx` | Meeting list, new meeting, links to knowledge + providers |
| `/dashboard/knowledge` | `src/app/dashboard/knowledge/page.tsx` | Document upload (fast/structured), list, status polling, view modal with chunks/entities/raw/pages/errors tabs |
| `/meeting/[id]` | `src/app/meeting/[id]/page.tsx` | Real-time live meeting view (transcript + events + recommendations + product card) |
| `/providers` | `src/app/providers/page.tsx` | BYOK provider config (DeepSeek/Ollama/OpenAI/Claude/Gemini) |

### 6.3 Auth — `src/lib/auth.tsx`

Single `AuthProvider` Context. State: `{user, token, isLoading}`. Persists `callpilot_token`/`callpilot_refresh`/`callpilot_user` to `localStorage`. User ID extracted client-side by decoding JWT payload (`payload.userId || payload.sub`).

**Limitations:** No middleware route protection (each page does client-side redirect). No token expiration handling. No automatic refresh. Logout is local-only (doesn't call `/api/v1/auth/logout`).

### 6.4 API client — `src/lib/api.ts`

`API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'`. Module-level mutable `accessToken` variable. `apiRequest<T>` helper uses `fetch`, adds `Authorization: Bearer <token>` and JSON `Content-Type`. **No retry, no AbortController, no query cache.**

Functions: `apiLogin/Register`, `apiCreateMeeting/GetMeetings/GetTranscripts`, `apiGetProviders/CreateProvider/DeleteProvider`, `apiUploadKnowledge/GetKnowledgeDocuments/DeleteKnowledgeDocument/GetKnowledgeDocument/GetDocumentStatus/GetDocumentRawOutput`, `apiGetProductDetails(name)`.

### 6.5 SignalR client — `src/lib/signalr.ts`

Hook `useSignalR(meetingId)` returns `{transcripts, events, recommendations, isConnected, error}`.

**Connects to `/hubs/desktop-agent` (NOT `/hubs/dashboard`)** because that's where `TranscriptReceived`/`EventDetected`/`RecommendationGenerated` are broadcast. Uses `withUrl(hubUrl, {accessTokenFactory: () => token, transport: 0}).withAutomaticReconnect()`.

**Event deduplication:** 15s window on `eventType + entityName` to prevent partial-transcript flooding. Transcripts and recommendations NOT deduplicated.

Reconnection: re-invokes `JoinMeeting(meetingId)` on reconnect.

### 6.6 Live meeting view — `src/app/meeting/[id]/page.tsx`

Layout: `grid grid-cols-1 lg:grid-cols-3`. Left 2/3: transcript (gray final, blue partial with animated indicator), events (amber, last 10), recommendations (green, last 5). Right 1/3: sticky `ProductDetailsCard`.

**Transcript merging (`mergeTranscripts`):**
- Same-speaker + text overlap >40% OR new text includes previous → merge (don't fragment).
- Otherwise same-speaker finals → concatenate with space.
- `Customer-1` → `Customer`.

**Active product** auto-set to newest `ProductMentioned` event. User can click previous product event to override. Dismiss sets to `null`.

### 6.7 Knowledge base page

Ingestion modes: `fast` (in-process, sub-second) vs `structured` (Docling + LLM enrichment, slower but richer). Default `structured`.

Upload flow: `POST /api/v1/knowledge/upload?mode=...` (multipart FormData) → insert at top → start 1.5s status polling loop on `GET /api/v1/knowledge/{id}/status`.

View modal tabs: chunks | entities | raw | pages | errors. Raw and pages tabs only for structured-mode docs.

**Terminal detection:** `processingStatus` is `Indexed` / `No extractable text found` / starts with `Error:` AND enrichment is `enriched` / `enrichment_failed` / `null`.

### 6.8 Shared components

- **`ProductDetailsCard.tsx`** — Calls `apiGetProductDetails(name)` when active product changes. Shows name/category/confidence/description/source docs/page/section/snippet/supporting transcript. Renders "not found" empty state with upload prompt.
- **`ProcessingStepper.tsx`** — Stages: Uploaded → Extracting → Chunking → Embedding → Indexed → Entity extraction → LLM enrichment (structured only). States: pending/running/done/failed/skipped. Stuck detection: running >30s without explicit error.

---

## 7. Desktop agent — `CallPilot.Desktop/`

**C# / .NET 10** standalone CLI (`OutputType=Exe`, `AssemblyName=callpilot-desktop`). Uses `System.CommandLine` (beta), `Microsoft.Extensions.Hosting/DI`, `SignalR.Client`, `Serilog`.

### CLI

`start` subcommand with flags: `--server-url`, `--email`, `--password`, `--meeting-id`, `--enable-mic`, `--enable-desktop-audio`, `--mic-device`, `--file-input`, `--source`, `--list-devices`.

### Audio capture — `Services/FfmpegAudioCaptureService.cs`

Wraps `ffmpeg` as external `System.Diagnostics.Process`. Cross-platform input muxers: `avfoundation` (macOS), `dshow` (Windows), `alsa` (Linux). Always re-encodes stdout to **raw PCM `s16le`, 16 kHz mono**. **Chunk size = 40ms.** Pre-flight silence check on first 1s.

### SignalR — `Services/SignalRConnectionService.cs`

`${ServerUrl}/hubs/desktop-agent` with JWT in `AccessTokenProvider`. Custom exponential-backoff `RetryPolicy` (base 5s, cap 10 attempts). Sends `RegisterAgent`, `SendAudioFrame`, `SendHeartbeat` (every 15s). Receives `TranscriptReceived`, `SilenceDetected`, `AgentRegistered`.

### Other files

- `Program.cs` (154 LOC) — CLI entrypoint, DI wiring, signal handler.
- `Models/AgentConfiguration.cs` — POCO of all tunables (defaults: ServerUrl=`http://localhost:5001`, SampleRate=16000, Channels=1, ChunkDurationMs=40, HeartbeatIntervalSeconds=15, MaxReconnectAttempts=10).
- `Audio/{AudioFrame.cs, IAudioCaptureService.cs}` — frame model + interface.
- `Services/AuthenticationService.cs` — login/refresh + create meeting.
- `Services/SessionManager.cs` — orchestrates auth → meeting → SignalR connect → capture. Also `BuildDashboardUrl` (5001 → 3000).

---

## 8. Service-to-service contract

### Anonymous internal endpoints (docker network only)

| Endpoint | Purpose | Caller |
|---|---|---|
| `GET /internal/knowledge/entities` (.NET) | Dumps all `DocumentEntity` rows for trie sync | AI engine on startup (`_auto_load_trie_from_server`, retries 5s × 12) |
| `POST /internal/llm/generate` (.NET) | Proxies LLM for competitive-intel prompts | AI engine competitor orchestrator |
| `POST /internal/competitor-intel` (AI engine) | Phase 2 orchestrator | .NET `EventDetectionService` |
| `DELETE /internal/competitor-cache/{competitor_name}` (AI engine) | Cache busting | .NET |

**Trie sync flow:** AI engine starts → retries .NET `/internal/knowledge/entities` → if empty or all retries fail, falls back to `get_seed_entities()` (Secure Meters portfolio) so first-frame detections still work → after every knowledge upload, .NET calls `POST /api/v1/ai/trie/rebuild` to push fresh entities.

---

## 9. Audio → Recommendations pipeline

```
DESKTOP AGENT (FFmpeg, PCM16 16kHz mono, 40ms frames)
  └─► SignalR → /hubs/desktop-agent.SendAudioFrame
        └─► .NET AiCoordinatorService.ProcessAudioAsync
              └─► POST http://ai-engine:8001/api/v1/ai/transcribe/nemotron
                    └─► NemotronPipeline (VAD, append, decoupled inference)
                          └─► SpeechTaskResult{transcript: TranscriptSegment, ...}
              └─► persists TranscriptSegment (utterance grouping via word-overlap)
              └─► broadcasts TranscriptReceived to meeting_{id} group
              └─► for final segments → EventDetectionService.DetectEventsForMeetingAsync
                    └─► POST /api/v1/ai/events {text}
                          └─► EventDetector.detect_all:
                                1. detect_trie_entities → ProductMentioned / PricingDiscussion / TechnicalQuestion
                                2. detect_pricing → PricingQuestion
                                3. detect_objections → Objection (Price/Security/Migration/Integration/Timeline/Competitor)
                                4. detect_technical_questions → TechnicalQuestion
                          └─► for unknown entities → POST /internal/competitor-intel
                                └─► competitor_orchestrator.handle_unknown_entity:
                                      A. classify_competitor (heuristic → LLM)
                                      B. parallel: cosine search (.NET) + Tavily search (with 7-day Redis cache)
                                      C. generate_talking_points (LLM)
                                      └─► CompetitorIntelCard
                    └─► persists ConversationEvent, broadcasts EventDetected
              └─► RecommendationEngine (PromptBuilder + LlmService + VectorSearch)
                    └─► Recommendation, broadcasts RecommendationGenerated
DASHBOARD (SignalR client on /hubs/desktop-agent)
  └─► useSignalR merges partials, dedups events (15s window), auto-selects active product
        └─► ProductDetailsCard fetches details from /api/v1/knowledge/entities/{name}/details
```

**Knowledge ingest (off hot path):**
```
Upload → KnowledgeUploadHandler.UploadAsync
  ├─ mode=structured → POST /api/v1/documents/ingest-structured → Docling chunks
  ├─ POST /api/v1/ai/extract-entities (GLiNER, threshold=0.3) → DocumentEntity rows
  │     └─► POST /api/v1/ai/trie/rebuild → live-call trie populated
  └─ background enrichment → POST /api/v1/documents/enrich (NDJSON stream)
        └─► Groq → EnrichedProduct cards → richer chunks → embedding
              + auto-write DocumentEntity("product", 0.95) for each product name
              + re-run GLiNER on full text
```

---

## 10. Dev workflow

- **Start everything (dev):** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
- **Start everything (local processes):** `./scripts/dev.sh` (parallel: server 5001, ai-engine 8001, dashboard 3000)
- **Bootstrap:** `./scripts/setup.sh` (checks tools, starts Postgres via docker, restores, creates venv, `npm install`, runs migrations)
- **Rebuild Docker:** `./scripts/rebuild.sh` (down + build --no-cache + up, polls `/health` on 5001/8001 and GET / on 3000)
- **Run all tests:** `./scripts/test.sh` (`dotnet test` Release + `pytest tests/` + `npm run build`)
- **End-to-end demo without audio:** `python scripts/simulate-meeting.py` (stdlib-only, hard-coded creds `demo@callpilot.dev/TestPass123!`, uploads 3 sample docs, POSTs scripted sales conversation to `/api/v1/meetings/{id}/process`)

### Ports

| Service | Port | Notes |
|---|---|---|
| PostgreSQL | 5432 | Published in dev only (compose.dev.yml); internal docker network only in prod |
| AI engine | 8001 | |
| .NET server | 5001 | default |
| Dashboard | 3000 | Next.js dev |
| Ollama | 11434 | `ollama` profile opt-in |
| Redis | 6379 | |

### Gotchas

- **`WHISPER_*` env vars** in compose are **legacy** — Whisper STT removed, replaced by Nemotron. `WHISPER_DEVICE` is still read by `embedding_service.py` (repurposed for embedding device).
- **Dev compose overrides** publish Postgres 5432, mount hot-reload volumes for ai-engine and server `appsettings.Development.json`, and use a dev dashboard Dockerfile.
- **No pgvector use at EF layer** — `Embeddings.VectorData` is text; cosine similarity is in-process. pgvector image still used for parity/forward-compat.
- **`Source` column uniqueness** dropped — enrichment 2-phase replace can create temporary duplicate `(DocumentId, ChunkIndex)` rows.
- **Service-to-service auth is anonymous** — `/internal/*` endpoints rely on docker network isolation only.
- **CORS workaround** — `OnChallenge` re-stamps CORS headers on 401 because .NET 8+ quirk drops them.

---

## 11. Contracts (`src/contracts/`)

**Currently a stub.** Only `README.md` (10 lines) — "will contain API contract schemas, Event message schemas, Shared domain types, Provider interface definitions" — directory is **empty**. Hub protocol is duplicated inline (`AudioFrameMessage`, `AgentRegistration`, `TranscriptEvent` etc.). REST DTOs are duplicated as private types in each endpoint/handler. Cross-service schema consistency relies on convention + case-insensitive JSON property matching.

**Highest-leverage future refactor:** generate OpenAPI/TypeScript from .NET or share JSON Schema files.

---

## 12. Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `setup.sh` | One-shot dev bootstrap: tool checks, postgres up, `dotnet restore`, venv + `pip install -e ".[dev]"`, `npm install`, `dotnet ef database update` |
| `dev.sh` | Starts server + ai-engine + dashboard in parallel as background processes, kills on SIGINT |
| `test.sh` | `dotnet test` Release + `pytest tests/` + `npm run build`. Exits 1 if any fail |
| `rebuild.sh` | `docker compose down --remove-orphans && build --no-cache && up -d`. Polls health endpoints |
| `simulate-meeting.py` | End-to-end demo without audio. Login, register on 401, upload 3 sample docs from `../samples/`, create meeting, POST scripted 15-utterance Salesforce sales convo to `/process`, print color-coded events + recs + diagnostics |

---

## 13. Test patterns

### .NET (xUnit + EF In-Memory + Moq)

```csharp
public class XTests : IAsyncLifetime
{
    private CallPilotDbContext _db = null!;
    public async Task InitializeAsync()
    {
        _db = new CallPilotDbContext(new DbContextOptionsBuilder<CallPilotDbContext>()
            .UseInMemoryDatabase($"CallPilot_Test_{Guid.NewGuid()}").Options);
    }
    public Task DisposeAsync() { _db.Dispose(); return Task.CompletedTask; }
    // [Fact] tests use _db directly
}
```

For HTTP clients: inline `MockHttpMessageHandler : HttpMessageHandler` override `SendAsync`.

### Python (pytest + pytest-asyncio)

Pure unit tests, no real models loaded. `conftest.py` adds project root to `sys.path` so `import engine.*` works without install.

---

## 14. File-index cheat sheet (absolute paths)

```
src/
├── CallPilot.slnx
├── contracts/README.md                                  # empty stub
├── docker/{Dockerfile.ai-engine, Dockerfile.dashboard, Dockerfile.desktop, Dockerfile.server}
├── callpilot-ai-engine/
│   ├── engine/main.py                                   # FastAPI app + all endpoints
│   ├── engine/models.py
│   ├── engine/config/nemotron_config.py
│   ├── engine/event_engine/event_detector.py            # 117 LOC
│   ├── engine/stt/{nemotron_pipeline.py, nemotron_websocket.py}
│   ├── engine/services/{trie_scanner, seed_entities, text_normalizer, entity_extractor,
│   │                    enrichment_service, competitor_classifier, competitor_intel,
│   │                    competitive_prompt, competitor_orchestrator}.py
│   ├── engine/knowledge_engine/{docling_service.py, embedding_service.py}
│   ├── engine/routers/{nemotron_router.py, ingest_router.py}
│   └── tests/{conftest, test_models, test_trie_scanner, test_text_normalizer,
│              test_event_detector, test_streaming_session, test_enrichment_service}.py
├── callpilot-dashboard/
│   ├── src/app/{layout.tsx, page.tsx, globals.css}
│   ├── src/app/{login, dashboard, dashboard/knowledge, meeting/[id], providers}/page.tsx
│   ├── src/components/{ProductDetailsCard.tsx, ProcessingStepper.tsx}
│   └── src/lib/{api.ts, auth.tsx, signalr.ts}
├── CallPilot.Desktop/
│   ├── Program.cs                                       # 154 LOC
│   ├── Models/AgentConfiguration.cs
│   ├── Audio/{AudioFrame.cs, IAudioCaptureService.cs}
│   └── Services/{AuthenticationService.cs, FfmpegAudioCaptureService.cs,
│                  SessionManager.cs, SignalRConnectionService.cs,
│                  SignalR/{Events.cs, RetryPolicy.cs}}
└── CallPilot.Server/
    ├── CallPilot.slnx
    ├── CallPilot.Server.Shared/Abstractions/IServices.cs
    ├── CallPilot.Server.Domain/
    │   ├── Knowledge/{KnowledgeDocument, KnowledgeChunk, Embedding, IngestStage, EnrichmentProgress}.cs
    │   ├── Meetings/{Meeting, TranscriptSegment, ConversationEvent, Recommendation, DocumentEntity}.cs
    │   ├── Providers/ProviderConfiguration.cs
    │   └── Users/{User.cs, RefreshToken.cs}
    ├── CallPilot.Server.Infrastructure/
    │   ├── Data/CallPilotDbContext.cs + Migrations/ (12 migrations)
    │   ├── AI/{AiCoordinatorService, EventDetectionService, LlmService,
    │   │      RecommendationEngine, PromptBuilder}.cs
    │   ├── Auth/{JwtTokenGenerator, PasswordHasher}.cs
    │   ├── Embedding/EmbeddingService.cs
    │   ├── Encryption/ApiKeyEncryptionService.cs
    │   ├── Knowledge/{ChunkingService, TextExtractors, VectorSearchService}.cs
    │   └── Reliability/{CacheService, MeetingDiagnosticsService}.cs
    ├── CallPilot.Server.Application/
    │   ├── Authentication/{Login, Logout, Refresh, Register}/{Command, Handler, Validator}.cs
    │   ├── Providers/{Create, Delete, List}/{Command, Handler, Validator, Response}.cs
    │   └── Knowledge/{KnowledgeUploadHandler.cs (1074 LOC), StructuredIngestClient.cs, EnrichmentClient.cs}
    ├── CallPilot.Server.Api/
    │   ├── Program.cs                                   # 486 LOC entry point
    │   ├── Endpoints/{AuthenticationEndpoints, ProviderEndpoints, KnowledgeEndpoints,
    │   │              DbHealthCheck, UrlHealthCheck}.cs
    │   ├── Hubs/{DashboardHub.cs (40 LOC), DesktopAgentHub.cs (235 LOC)}
    │   └── appsettings.json, appsettings.Development.json
    └── CallPilot.Server.Tests/
        ├── Authentication/AuthenticationTests.cs
        ├── Desktop/{DesktopModelTests, AuthenticationServiceTests}.cs
        ├── Hubs/DesktopAgentHubTests.cs
        └── Providers/ProviderTests.cs
```

---

## 15. Open issues / known gaps

1. **`src/contracts/` is empty** — no shared API/event schemas. Cross-service consistency by convention only.
2. **Dashboard `/hubs/dashboard` is unused** — dashboard connects to `/hubs/desktop-agent` because that's where broadcasts happen. `DashboardHub` is dead code.
3. **No refresh-token expiry handling on dashboard** — tokens expire silently, no automatic refresh.
4. **Vector search is in-process brute-force** — `VectorSearchService.CosineSimilarity` over all chunks per query. Will not scale.
5. **`DashboardHub` and `recommendation_engine/` (Python) are empty stubs** — both are reserved but unused.
6. **`Postgres` is the only dependency that has a health check** in compose — Redis, Ollama, ai-engine liveness only via the ai-engine `/health` URL check.
7. **`Dockerfile.desktop` doesn't bundle FFmpeg** — desktop agent must run on host with `ffmpeg` available; cannot be fully containerized.
8. **`WHISPER_*` env vars** still set in compose/Dockerfile despite Whisper STT being removed — `WHISPER_DEVICE` is now repurposed for embedding device; the rest are dead.
