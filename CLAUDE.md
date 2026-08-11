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
- **Desktop UI design system (Opaline, rebuilt 2026-08):** `callpilot-desktop/frontend/src/app/globals.css` is the single source of truth — two purpose-built registers, **DAWN** (light: warm paper `#f7f5f2` + terracotta `#93483c`) and **NOCTURNE** (dark: ink `#101216` + luminous terracotta `#f0b09a`), NOT inverted copies. Theme engine: `src/lib/theme.ts` (System/Light/Dark, persisted `callpilot-theme`, Tauri window-theme sync, flash-free bootstrap script in `layout.tsx`; toggle lives in the UserChip popover). Rules: **no raw Tailwind palette** (`gray/blue/red/white`), no hex colors, no emoji icons — everything maps to `--opaline-*` tokens or semantic `success/warning/info/danger`; composition helpers `.panel`, `.chip*`, `.kbd`, `.text-overline`, `.text-caption`, `.text-data`, `.field-label` in globals.css; elevation `shadow-xs..xl`; motion tokens `--dur-*`/`--ease-*` (reduced-motion respected globally). One-off sweep tool: `frontend/scripts/sweep-tokens.mjs` (idempotent raw-palette → token mapper). `tailwind.config.ts` bridges tokens into utilities incl. `primary-foreground` etc. (was silently missing — CTA text rendered ink-on-terracotta before the fix).
- **Desktop UI pass 2 (native-app product design, 2026-08):** home = three-zone native workspace — page header (context line + live health pills: Mic/System/Model/Knowledge count/Stream via `.status-pill` + `pill-dot` pulse), center idle = centered record orb (`orb-ring` breathe) + unmissable CTA + `⌘ R` hint, then hairline-separated dense lists (Recent meetings / Knowledge bank with `chip` health states) — no floating cards on idle. Shared motion vocabulary in `src/lib/motion.ts` (`fadeUp`/`fadeIn`/`scaleIn`/`stagger`, Apple-restraint durations, transform/opacity only). IntelligencePanel has designed idle (signal-type taxonomy preview) / opening (spin pill) / listening (`.eq-bar` equalizer) / offline states + staggered card entrance; card sources expand via AnimatePresence height. Sidebar: meetings rows carry date meta + hover rename/delete; Help/Settings are quiet secondary footer nav; Meetings nav shows a count chip. CTA text uses `text-primary-foreground`/`text-background` (theme-inverting) — never `text-white` on primary/warning/danger in dark. Status dots use `dot-pulse` box-shadow rings.
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

## Product Intelligence (researched product profiles, 2026-08)
- **Global, cached product profiles** persisted in PostgreSQL (`ProductIntelligences` + `ProductSources`, migration `20260809112546_AddProductIntelligence`). `ConversationEvent` gained nullable `ProductIntelligenceId` (SET NULL FK) — the meeting-specific mention links back to the canonical profile.
- **Company-scoped (2026-08-09):** `KnowledgeBases` entity (company context: name, CompanyName, website, description) scopes both documents (`KnowledgeDocument.KnowledgeBaseId`) and product profiles (`ProductIntelligence.KnowledgeBaseId` + denormalized `CompanyName`, unique index `(CompanyName, CanonicalName)`, migration `20260809124802_AddKnowledgeBaseAndProductScope`). The Knowledge Bank is where product intelligence is prepared — not the live call.
- **Ingest flow:** upload → existing RAG (extract/chunk/embed/index/GLiNER/Groq) → `RunProductIdentificationAsync` (chained AFTER enrichment so the shared jsonb stage log settles) → engine `POST /internal/product-identify` (LLM extracts canonical products + aliases, filters generic metering terms) → persist `DocumentEntity('product')` → `ProductIntelService.EnsureScopedAsync(kb, company, name)` enqueues research → worker researches (Tavily, advanced depth, company + website disambiguation) → persists KB-scoped profile + sources.
- **Live call:** product detected → scoped GET `/api/v1/products/intelligence/{name}` resolves the user's KB row first (then legacy/global) — no fresh web search. Per-company rows never mix.
- **Endpoints:** knowledge-bases CRUD (`/api/v1/knowledge-bases`), upload accepts `knowledgeBaseId`, `GET /api/v1/products/intelligence/{name}`, `.../sources`, `POST .../enrich` (refresh). Document `/status` returns per-doc `products[]` (ProductEntity→ProductIntelligence join) + `productsTotal`/`productsEnriched`.
- **UI:** KB creation form + selector in KnowledgeUpload; per-document "Product intelligence X/Y enriched" chip list (Ready/Researching/Pending/No info) — chips are **clickable buttons** opening a right-side `ProductDetailDrawer` (status badge, source/discovery, live profile sections, sources, Raw intelligence expander, Last enriched, actions). Shared status vocabulary in `lib/productStatus.ts` (Pending/Enriching/Completed/Failed/NeedsReview → Pending/Processing/Ready/Failed/Partial). Actions: Start enrichment / Reprocess / Retry (reuse `POST .../enrich` force), Delete (`DELETE /api/v1/knowledge/{docId}/products/{name}` removes the per-doc `DocumentEntity` + the shared KB `ProductIntelligence` only when no other doc in the KB references it — never the source PDF). Document `/status` products[] includes `displayName`, `sourcePage`, `sourceChunk`.
- **Bulk product actions (2026-08-09):** per-document product list supports multi-select (per-doc frontend state keyed by the `DocumentEntity` id from `/status` products[].`id`), a per-doc Select-All tri-state checkbox, and a bulk bar (Process selected / Delete selected / Clear). `POST /api/v1/knowledge/{docId}/products/bulk-enrich` reuses the individual enrich path (skips already-Processing, no duplicate jobs, idempotent; Ready re-researches like individual Reprocess); `POST /api/v1/knowledge/{docId}/products/bulk-delete` reuses individual delete rules in a transaction (shared intelligence removed only when unreferenced). Both are scoped strictly to the document's own product records.
- **Python:** `engine/services/product_intel.py` (research + `identify_products`) + `/internal/product-intel` + `/internal/product-identify`; all fail-open. `identify_products` now returns **classified entities** (`entityType` PRODUCT/PRODUCT_CATEGORY/FEATURE/COMPONENT/ACCESSORY/APPLICATION/TECHNICAL_SPECIFICATION/OTHER + confidence + evidence); only PRODUCT ≥0.7 auto-enriches, 0.4–0.69 stored Pending, <0.4 demoted.
- **Document-scoped product isolation (2026-08-09):** `DocumentEntity` is the per-document "extracted product" record — it now carries its OWN `EntityCategory` (only PRODUCT rows appear in the doc's list), `EnrichmentStatus`/`LastEnrichedAt` (per-doc processing state, independent even when the shared KB profile is reused) and `ProductIntelligenceId` (link to the shared company-scoped profile). `RunProductIdentificationAsync` UPGRADES existing GLiNER rows in place (never duplicates) and dedups verbose supersets ("sprint 210 modular meter" → "sprint 210"). `/status` products come from `DocumentEntity` status filtered by `EntityCategory='PRODUCT'`, with the profile lookup scoped to the doc's KB.
- **GET is read-only:** `GET /api/v1/products/intelligence/{name}` never creates rows or enqueues research (clicking a product never starts enrichment). Enrichment is only triggered by the background ingest pipeline or explicit actions: doc-scoped `POST /api/v1/knowledge/{docId}/products/{name}/enrich` (drawer Start/Reprocess/Retry), `POST /api/v1/products/intelligence/{name}/enrich`, and detection-time enqueue. Duplicate-trigger protection: active-Enriching + in-flight guard → no double jobs.
- **Legacy visibility (2026-08-09):** document `/status` products include rows where `EntityCategory == "PRODUCT"` **or `EntityCategory IS NULL`** (rows that predate the classification field) so pre-classification documents keep showing their extracted products; per-doc `EnrichmentStatus` falls back to the KB-scoped profile status for those rows. Frontend empty-state (muted "No products detected") renders only after the `productresearch` stage settles.

## Local meeting summarization (2026-08-10; GGUF rewire 2026-08-11)
- **Runs on the user's machine via the bundled llama-helper sidecar (llama.cpp), NOT Ollama** (`llm_engine` Rust module, mirroring whisper/parakeet): catalog of 4 GGUF models in `llm_engine/models.rs` (`qwen3.5-2b-q4` / `qwen3.5-4b-q4` / `gemma3-1b-q8` / `gemma3-4b-q4`, real HF URLs, each with sampling preset + chat template `gemma3`/`qwen3.5_nonthinking` via `format_prompt`). Downloads stream into `app_data_dir/models/summary/` (`model_manager.rs`: `.part` temp file, progress+speed events, cancel flag, GGUF-magic + ≥90%-size validation → Missing/Downloading/Ready/Corrupted). `llm_get_models`/`llm_pull_model` (streamed `llm-model-download-progress` events)/`llm_cancel_download` (new)/`llm_delete_model`/`llm_generate_summary`. Selected model + auto-summarize persisted in tauri-store `summarization-config.json`. Inference: one `llama-helper` spawn per summary run (`helper.rs`, JSON-over-stdio `generate`/`response`/`error`/`goodbye` frames, 15-min timeout, stderr drained to log), kept alive across chunk requests via `Arc<tokio::Mutex<LlamaHelper>>`; chunk prompts carry only the user prompt (schema goes in the template system slot). The transcript is chunked → per-chunk summary → final synthesis (long transcripts), with stage progress events (`llm-summary-progress`) and strict-JSON output. Never sent to any server LLM; LLM failure falls back to the zero-setup extractive `summarize_heuristic`.
- **llama-helper sidecar:** workspace member `src-tauri/llama-helper/` (`llama-cpp-2 = "=0.1.146"` + `metal`/`cuda`/`vulkan` features), staged via `scripts/build-llama-helper.sh` into `binaries/llama-helper-<triple>` (externalBin; dev binary goes next to the app exe). Build gotchas fixed 2026-08-11: `llama-cpp-sys-2` must be pinned to `0.1.146` (newer versions drop the oaicompat bindings the lib expects — `cargo update -p llama-cpp-sys-2 --precise 0.1.146`), and the dead `esaxx-rs` git patch in `[patch.crates-io]` was removed (repo deleted upstream; crates.io 0.1.10 is used). `notify-rust` pinned to 4.11.5 for rustc 1.88.
- **Flow:** meeting ends → desktop navigates to meeting-details → if `isAutoSummary` + a local model is selected + no summary exists, `useLocalSummarization` runs `llm_generate_summary` → PUTs the structured summary (`summary/keyPoints/decisions/actionItems/customerRequirements/objections/followUps` + `model/modelName/generatedLocally/generatedAt`) to `PUT /api/v1/meetings/{id}/summary`. Save failures retain the generated summary in localStorage (keyed by meeting id) for retry without re-running inference. Summary tab (`LocalSummaryView`) renders structured sections + "Generated locally · model" + [Regenerate].
- **Backend:** reuses the existing `Meetings.SummaryJson` text column (no new table, idempotent upsert). `GET /meetings/{id}/summary` now returns the REAL stored status (was hardcoded "completed") so failed/unsaved states surface.
- **Settings:** Transcription tab → "Meeting summarization" section (model cards: name/size/context, download-with-progress + cancel, Ready/Corrupted/Not installed chips, select, delete; helper-missing notice when the llama-helper binary is absent).

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
