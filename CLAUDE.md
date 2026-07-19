# CallPilot AI — Claude Working Notes

> Living document. Update whenever architecture, commands, conventions, or current focus change.

## What this is
**CallPilot AI** — open-source, real-time AI sales intelligence platform. Assists sales reps during live meetings: live transcription, speaker ID, conversation intelligence (competitors / pricing / objections / technical questions / product mentions / negative signals), knowledge retrieval, contextual recommendations. BYOK (DeepSeek / Ollama / OpenAI / Claude / Gemini). Self-hosted via Docker.

## Stack
- **.NET 10** — backend (`CallPilot.Server.*`)
- **Python 3.13** — AI engine (Whisper, Nemotron, GLiNER, Docling, enrichment) `src/callpilot-ai-engine/`
- **Next.js 15** — dashboard `src/callpilot-dashboard/`
- **PostgreSQL 17 + pgvector** — primary store
- **Redis** — cache
- **Ollama** — local LLM (default `qwen2.5:3b` for enrichment)
- **Tavily** — competitive-intel web search
- **Desktop agent** — `CallPilot.Desktop` (FFmpeg audio capture)

## Layout
```
src/
  CallPilot.Server/                  # .NET host (entry point)
  CallPilot.Server.Api/              # HTTP/WebSocket endpoints
  CallPilot.Server.Application/      # Use cases / handlers
  CallPilot.Server.Domain/           # Entities, value objects
  CallPilot.Server.Infrastructure/   # DB, external services
  CallPilot.Server.Shared/           # Cross-cutting types
  CallPilot.Server.Tests/            # xUnit tests
  callpilot-ai-engine/               # Python FastAPI service
  callpilot-dashboard/               # Next.js frontend
  CallPilot.Desktop/                 # Desktop audio-capture agent
  contracts/                         # Shared schemas (probably JSON Schema / OpenAPI)
  docker/                            # Dockerfiles
docker-compose.yml                   # Production-shaped compose
docker-compose.dev.yml               # Dev overrides (publishes DB port, etc.)
```

## Dev workflow
- **Start everything:** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
- **DB port (dev only):** 5432 published via `docker-compose.dev.yml` so psql/TablePlus can reach it. In prod, NOT published — internal docker network only.
- **AI engine port:** 8001
- **Server port:** 5001 (default)
- **Dashboard:** Next.js dev port
- **Python deps:** pinned via `src/docker/Dockerfile.ai-engine` — torch/torchvision must come from PyTorch CPU index (see commit `e795229`).
- **Run tests:** `dotnet test` (C#), and Python tests in `src/callpilot-ai-engine/`.

## Conventions / gotchas
- **Service-to-service:** `CallPilot.Server` calls `callpilot-ai-engine` via `CALLPILOT_SERVER_URL` and an anonymous `/internal/*` endpoint for knowledge entity sync (commit `51836ea`). Inside docker, host is the service name (`http://ai-engine:8001`), not `localhost`.
- **Knowledge ingest:** supports structured mode (Docling + GLiNER entity extraction + LLM enrichment) and fast mode (Docnet). GLiNER confidence threshold was lowered in `570ec38` so brand product names get extracted, but **brand-product recall is still a model cliff** — `KnowledgeUploadHandler.RunBackgroundEnrichmentAsync` also writes a `DocumentEntity` row (`EntityType='product'`, confidence 0.95) for each `EnrichedProductDto.Name` emitted by the LLM, so the live-call trie reliably picks up whatever the LLM enrichment surfaced. Treat the LLM enrichment output as authoritative for product names; treat GLiNER as authoritative for integrations / features / pricing tiers it can see.
- **Conversation events taxonomy:** the detector emits `ProductMentioned` (trie hits), `PricingDiscussion` (trie pricing hits), `TechnicalQuestion` (trie integration/feature + `TECHNICAL_PATTERNS`), `PricingQuestion` (regex), `Objection` (regex, with sub-type: Price/Security/Migration/Integration/Timeline/Competitor), `NegativeBuyingSignal` (regex), and dynamic `CompetitorMentioned` from the competitive-intel orchestrator. `PositiveBuyingSignal` was removed as worthless to sales reps; if reintroducing, extend `event_detector.detect_all` AND the switch arms in `RecommendationEngine` + `PromptBuilder`.
- **Transcription:** Whisper `medium.en` on CPU, int8 compute type. Word-overlap based utterance grouping (commit `4d83b10` / `89cffd8` / `74a2888`) — don't fragment same-speaker consecutive groups.
- **Conversation history:** per-meeting; partials include all previous finals (commit `c480971`).
- **Enrichment:** AI engine enriches extracted text via Ollama. Timeout is generous (~180s) because cold-start on CPU is slow for the 3B model.
- **Null bytes / invalid UTF-8:** sanitize extracted text before DB insert (commit `3e8edba`).
- **PDF text extraction:** uses PdfPig, not the previous broken extractor (commit `59ea489`).
- **Dev/prod split:** the prod compose does NOT publish the DB port and DOES use the chiseled server image. Dev uses `docker-compose.dev.yml` for local conveniences.

## Current focus (as of last session)
Closed out the product-detection gap (Prodigy + brand products from LLM enrichment now reliably land in the live trie) and dropped buying-signal events. Uncommitted edits:
- `src/callpilot-ai-engine/engine/event_engine/event_detector.py` — removed `PositiveBuyingSignal`/`NegativeBuyingSignal` paths
- `src/callpilot-ai-engine/tests/test_event_detector.py` — dropped dependent tests, renamed `test_pricing_and_tech`
- `src/CallPilot.Server/CallPilot.Server.Application/Knowledge/KnowledgeUploadHandler.cs` — auto-register LLM-confirmed product names as `DocumentEntities`
- `src/CallPilot.Server/CallPilot.Server.Infrastructure/AI/RecommendationEngine.cs` — dropped buying-signal switch arms
- `src/CallPilot.Server/CallPilot.Server.Infrastructure/AI/PromptBuilder.cs` — dropped buying-signal switch arm
- `docker-compose.yml` (earlier session) — already reviewed

## Git / branch
- Default branch: `main`
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>` (see recent log).
- PR bodies end with the `🤖 Generated with [Claude Code]` footer.
