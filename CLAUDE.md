# CallPilot AI - Claude Working Notes

> Living document. Update whenever architecture, commands, conventions, or current focus change.
> Last refreshed: 2026-07-22 (full context rebuild - Nemotron STT, Groq enrichment, new Tauri desktop app).

## What this is
**CallPilot AI** - open-source, real-time AI sales intelligence platform. Assists sales reps during live meetings: live transcription, speaker ID, conversation intelligence (competitors / pricing / objections / technical questions / product mentions), knowledge retrieval, contextual recommendations. BYOK (DeepSeek / Ollama / OpenAI / Claude / Gemini) for the recommendation LLM. Self-hosted via Docker.

## Stack
- **.NET 10** - backend (`src/CallPilot.Server/*`)
- **Python 3.12/3.13** - AI engine (**Nemotron** STT, GLiNER, Docling, Groq enrichment) `src/callpilot-ai-engine/`
- **Next.js 15** - dashboard `src/callpilot-dashboard/`
- **Tauri 2 + Next.js 14 + Rust** - GUI desktop app `callpilot-desktop/` (repo root, NOT under `src/`)
- **PostgreSQL 17 + pgvector** - primary store
- **Redis 7** - cache
- **Groq** - LLM for knowledge enrichment (`llama-3.1-8b-instant` default)
- **Ollama** - optional local LLM, profile-gated in compose (opt-in, not auto-started)
- **Tavily** - competitive-intel web search (optional)

## Layout
```
callpilot-desktop/                   # NEW: Tauri 2 GUI desktop app (Meetily fork) - repo root
src/
  CallPilot.Server/                  # .NET solution root
    CallPilot.Server.Api/            # HTTP endpoints + SignalR hubs (entry point)
    CallPilot.Server.Application/    # Use cases / handlers
    CallPilot.Server.Domain/         # Entities, value objects
    CallPilot.Server.Infrastructure/ # DB, external services, AI coordination
    CallPilot.Server.Shared/         # Cross-cutting abstractions
    CallPilot.Server.Tests/          # xUnit tests
  callpilot-ai-engine/               # Python FastAPI AI service
  callpilot-dashboard/               # Next.js 15 web frontend
  CallPilot.Desktop/                 # Headless .NET CLI audio-capture agent (FFmpeg + SignalR)
  contracts/                         # README-only placeholder - no real schemas yet
  docker/                            # Dockerfiles (ai-engine, server, dashboard, desktop)
docker-compose.yml                   # Production-shaped compose
docker-compose.dev.yml               # Dev overrides (publishes DB port, live-mounts code)
```

## Two desktop clients (complementary, NOT duplicates)
- **`src/CallPilot.Desktop/`** - headless C# CLI. FFmpeg capture, streams raw audio over **SignalR** to `/hubs/desktop-agent`. For scripted/server-side use, file replay (`--file-input`), `--list-devices`. Invoke: `dotnet run -- start --server-url http://localhost:5001 --email … --password …`.
- **`callpilot-desktop/`** - rich **Tauri 2 GUI** (Rust `callpilot-audio` binary + Next.js 14/React 18/shadcn). Fork of [Meetily](https://github.com/Zackriya-Solutions/meetily) (MIT); see `callpilot-desktop/ADAPTATION_NOTES.md` for every keep/adapt/remove decision. Local STT (Whisper via whisper-rs + Parakeet TDT via ONNX), `cpal` capture + Silero VAD + ring-buffer mixing + EBU R128 normalization, local SQLite/IndexedDB. Talks to backend via `reqwest` JSON (`callpilot_api_request` Tauri command, bypasses webview CORS) to `:5001` and a WS to `:8001` (`/ws/intelligence/{session_id}` → IntelligencePanel cards). Mic → "REP", system audio → "PROSPECT".
  - Run: `cd callpilot-desktop/frontend && pnpm install && pnpm tauri:dev` (dev server on `:3118`). Feature-gated builds: `pnpm tauri:dev:{cpu,cuda,metal,coreml,…}`, `pnpm tauri:build:cpu`.

## Dev workflow
- **Start everything:** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
- **Ports:** AI engine **8001**, server **5001**, dashboard **3000**, Redis **6379**. Postgres NOT published in prod (internal only); dev override publishes **5432** for psql/TablePlus. Ollama **11434** only under `--profile ollama`.
- **Dockerfiles** (`src/docker/`): `Dockerfile.ai-engine` (Python 3.12-slim, torch CPU wheel, `NEMOTRON_INSTALL` build arg), `Dockerfile.server` (.NET sdk→aspnet 10), `Dockerfile.dashboard` (node:22-alpine), `Dockerfile.desktop` (.NET CLI agent).
- **Python deps:** torch/torchvision must come from PyTorch CPU index (commit `e795229`). Nemotron deps in `requirements-nemotron.txt`.
- **Run tests:** `dotnet test` (C#); Python tests under `src/callpilot-ai-engine/tests/` (pytest).

## Key env vars (see `.env.example`)
- **Postgres:** `POSTGRES_DB/USER/PASSWORD`. **Auth/crypto:** `JWT_SECRET`, `ENCRYPTION_KEY` (32-byte). 
- **Service wiring:** `AiEngine__BaseUrl=http://ai-engine:8001` (server→engine), `CALLPILOT_SERVER_URL=http://server:5001` (engine→server, startup trie sync), `REDIS_URL=redis://redis:6379`.
- **STT:** `NEMOTRON_ENABLED` (default `true`), `NEMOTRON_MODEL_NAME` (`nvidia/nemotron-speech-streaming-en-0.6b`), `NEMOTRON_DEVICE` (`cpu`), plus `NEMOTRON_{RIGHT_CONTEXT,CHUNK_MS,VAD_*,MIN_CHUNK_MS,EMIT_INTERVAL_MS,PARTIAL_WINDOW_SEC}`.
- **Enrichment:** `GROQ_API_KEY` (required for enrichment), `ENRICHMENT_MODEL` (`llama-3.1-8b-instant`).
- **Optional:** `TAVILY_API_KEY` (competitive intel). **Dashboard:** `NEXT_PUBLIC_API_URL=http://localhost:5001`.
- **Legacy/dead:** `WHISPER_MODEL_SIZE/COMPUTE_TYPE` are no longer read by any STT code; only `WHISPER_DEVICE` survives as a misnamed CPU-selector for the `all-MiniLM-L6-v2` embedding model in `embedding_service.py`.

## Conventions / gotchas
- **STT is Nemotron-only.** `engine/main.py` is the "Nemotron-only STT entry point". Model: `nvidia/nemotron-speech-streaming-en-0.6b` on CPU, loaded via NeMo `ASRModel.from_pretrained`, inference serialized via `_inference_lock`/`inference_lock`. Routes: `/ws/transcribe/nemotron` (primary streaming), `/transcribe/nemotron` (file), `/api/v1/ai/transcribe/nemotron` (REST per-frame), `/api/v1/meetings/{id}/reset/nemotron`. **Whisper is fully removed from the STT path** (only residual mentions are env-var names + a comment).
- **Enrichment is Groq, not Ollama** (commit `ec52e5a`). `enrichment_service.py` uses `AsyncGroq` with `response_format={"type":"json_object"}`, per-page 30s cap, fail-open (missing key/timeout → `products=[]`, .NET marks `enrichment_failed`). Outcome taxonomy: `ok|missing_key|http_4xx|http_5xx|timeout|connection_error|parse_error|unknown`. `.NET EnrichmentClient.cs` is a pure HTTP/NDJSON proxy to `/api/v1/documents/enrich` (4-min overall budget) - it never calls Groq/Ollama directly.
- **Service-to-service:** inside docker use service names (`http://ai-engine:8001`, `http://server:5001`), not `localhost`. AI engine pulls entities from the .NET anonymous `/internal/knowledge/entities` on startup to seed the trie (commit `51836ea`), falling back to `seed_entities.py`.
- **Knowledge ingest:** structured mode (Docling + GLiNER + Groq LLM enrichment) and fast mode (in-process extractors: PdfPig for PDF, commit `59ea489`). GLiNER threshold lowered in `570ec38` for brand product names, but **brand-product recall is a model cliff** - `KnowledgeUploadHandler` also writes a `DocumentEntity` (`EntityType='product'`, confidence 0.95) per LLM-emitted `EnrichedProductDto.Name` so the live trie reliably picks them up. Treat LLM enrichment as authoritative for product names; GLiNER authoritative for integrations/features/pricing tiers it can see.
- **Conversation events taxonomy** (`event_detector.py` → switch arms in `RecommendationEngine` + `PromptBuilder`): `ProductMentioned` (trie), `PricingDiscussion` (trie pricing), `TechnicalQuestion` (trie integration/feature + `TECHNICAL_PATTERNS`), `PricingQuestion` (regex), `Objection` (regex; sub-types Price/Security/Migration/Integration/Timeline/Competitor), and dynamic `CompetitorMentioned` from the competitive-intel orchestrator. **Both `PositiveBuyingSignal` and `NegativeBuyingSignal` were dropped** (commit `2bd3d57`) as low-value to reps; to reintroduce, extend `detect_all` AND both switch arms.
- **Trie / entity scanning:** Aho-Corasick (`trie_scanner.py`); `text_normalizer.py` handles canonicalization/aliases/spoken-numbers. Trie scan stays safe when no entities ingested (commit `3029186`).
- **Competitive intel:** `competitor_classifier` → `competitor_intel` (Tavily + Redis cache) → `competitor_orchestrator` → `competitive_prompt`. Endpoints `/internal/competitor-intel`, `DELETE /internal/competitor-cache/{name}`.
- **Conversation history:** per-meeting; partials include all previous finals (commit `c480971`).
- **Data hygiene:** sanitize null bytes / invalid UTF-8 before DB insert (commit `3e8edba`).
- **Contracts are duplicated, not shared:** `src/contracts/` is a placeholder. Cross-service message shapes live in Python `engine/models.py`, .NET hub records (`DesktopAgentHub.cs`), desktop `Services/SignalR/Events.cs`, and dashboard `lib/api.ts` + `lib/signalr.ts`.
- **Dashboard quirk:** `callpilot-dashboard/src/lib/signalr.ts` connects the meeting view to `/hubs/desktop-agent` even though a separate `/hubs/dashboard` hub exists server-side.

## Main .NET endpoints
- **Auth:** `POST /api/v1/auth/{register,login,refresh,logout}`
- **Providers:** `GET/POST /api/v1/providers`, `DELETE /api/v1/providers/{id}`
- **Meetings:** `POST/GET /api/v1/meetings`, `GET /api/v1/meetings/{id}/{transcripts,recommendations}`, `POST /api/v1/meetings/{id}/process`
- **Knowledge:** `POST /api/v1/knowledge/upload?mode=fast|structured`, `GET/DELETE /api/v1/knowledge[/{id}]`, `GET /{id}/{status,raw-output}`, `POST /{id}/reindex`, entities `/entities/{name}/details`, `/entities/all`, `POST /entities/sync-trie`
- **Internal:** `GET /internal/knowledge/entities`, `POST /internal/llm/generate` (Python→.NET BYOK proxy)
- **Health/diag:** `GET /health`, `/health/detailed`, `/api/v1/diagnostics[/meetings/{id}]`
- **SignalR:** `/hubs/desktop-agent` (RegisterAgent, SendAudioFrame, SendHeartbeat, Join/LeaveMeeting → AgentRegistered, TranscriptReceived, EventDetected, RecommendationGenerated, SilenceDetected), `/hubs/dashboard` (Join/LeaveMeeting)

## Git / branch
- Default branch: `main`. Working tree currently clean.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- PR bodies end with the `🤖 Generated with [Claude Code]` footer.
