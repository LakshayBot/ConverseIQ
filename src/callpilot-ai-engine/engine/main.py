"""
CallPilot AI Engine - Nemotron-only STT entry point.

Exposes the nvidia/nemotron-speech-streaming-en-0.6b pipeline via:
  • POST /api/v1/ai/transcribe/nemotron   (streaming REST - drop-in for the
                                            desktop agent's per-frame path)
  • POST /api/v1/meetings/{id}/reset/nemotron
  • POST /api/v1/ai/events                (competitor/pricing/objection detection,
                                            consumed by the .NET EventDetectionService)
  • POST /api/v1/ai/embeddings            (consumed by the .NET EmbeddingService)
  • GET  /health

The Nemotron WebSocket (/ws/transcribe/nemotron) is mounted by the
nemotron_router router. Model pre-load runs in the background during the
FastAPI lifespan so the first audio frame doesn't pay the 30-60s NeMo
initialisation cost.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request

from engine.config.nemotron_config import NEMOTRON_ENABLED, NEMOTRON_HOP_SAMPLES
from engine.models import SpeechTaskResult, TranscriptSegment
from engine.routers.nemotron_router import router as nemotron_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("callpilot.ai")

# Module-level lazy singletons - populated in lifespan, accessed by the
# /api/v1/ai/events and /api/v1/ai/embeddings endpoints. Not pre-loaded:
# each is only built on first call to avoid paying the embedding-model
# download cost when a deployment only does STT.
_event_detector: "EventDetector | None" = None
_embedding_service: "EmbeddingService | None" = None


def _get_event_detector():
    global _event_detector
    if _event_detector is None:
        from engine.event_engine.event_detector import EventDetector
        _event_detector = EventDetector()
    return _event_detector


def _get_embedding_service():
    global _embedding_service
    if _embedding_service is None:
        from engine.knowledge_engine.embedding_service import EmbeddingService
        svc = EmbeddingService()
        svc.load_model()
        _embedding_service = svc
    return _embedding_service


async def _ensure_nemotron_loaded_background(pipe) -> None:
    """Background Nemotron pre-load. Used by lifespan and lazy-load paths."""
    try:
        await pipe.ensure_loaded()
        logger.info("Nemotron model loaded (background pre-load complete)")
    except Exception as exc:
        logger.warning("Nemotron pre-load failed (will retry on first request): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if NEMOTRON_ENABLED:
        try:
            from engine.stt.nemotron_pipeline import NemotronPipeline
            pipe = NemotronPipeline.get_instance()
            asyncio.create_task(_ensure_nemotron_loaded_background(pipe))
        except Exception:
            logger.exception("Failed to start Nemotron pre-load")
    else:
        logger.warning(
            "NEMOTRON_ENABLED is false - the only STT path will refuse to load. "
            "Set NEMOTRON_ENABLED=true (the default) to enable transcription."
        )

    # Build the in-memory Aho-Corasick trie from seed competitors.
    # Document entities are loaded via /api/v1/ai/trie/rebuild after ingest.
    from engine.services.trie_scanner import build_trie
    build_trie([])
    logger.info("Trie initialised (empty - entities loaded from documents after ingest)")

    # Pull existing document entities from the .NET server on startup so the
    # trie isn't empty after a container restart (previously the AI engine
    # would boot with an empty trie and silently drop every detected event
    # until a fresh document was uploaded and the .NET side called
    # /api/v1/ai/trie/rebuild).  Best-effort: if the .NET server isn't
    # reachable yet (cold start), the trie just stays empty and the first
    # upload will rebuild it.
    asyncio.create_task(_auto_load_trie_from_server())

    yield
    logger.info("AI Engine shutting down")


async def _auto_load_trie_from_server() -> None:
    """Best-effort startup sync of the trie from the .NET server.

    Retries with backoff for up to ~60 s so we survive the .NET container
    coming up after us.  Logs and swallows any error - never crashes the
    AI engine boot path.

    If the .NET server returns an empty entity list (no brochure uploaded
    yet, or the server is unreachable), falls back to the hardcoded Secure
    Meters product seed list so the live call still gets product
    detections from the very first frame.
    """
    import os
    import httpx

    from engine.services.seed_entities import get_seed_entities
    from engine.services.trie_scanner import build_trie

    server_url = os.getenv("CALLPILOT_SERVER_URL", "http://server:5001").rstrip("/")
    url = f"{server_url}/internal/knowledge/entities"

    server_reachable = False
    for attempt in range(12):  # 12 × 5s = 60s window
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
            if resp.status_code == 200:
                payload = resp.json() or {}
                raw = payload.get("entities", [])
                # Map .NET shape → trie shape
                entities = [
                    {
                        "entity_text": e.get("EntityText") or e.get("entity_text"),
                        "entity_type": e.get("EntityType") or e.get("entity_type", "product"),
                        "document_id": str(e.get("DocumentId") or e.get("document_id") or ""),
                    }
                    for e in raw
                    if (e.get("EntityText") or e.get("entity_text"))
                ]
                if entities:
                    build_trie(entities)
                    logger.info(
                        "Startup trie sync: %d entities loaded from .NET server",
                        len(entities),
                    )
                    return
                # Server up but empty - fall through to seed
                server_reachable = True
                logger.warning(
                    "Startup trie sync: server returned 0 entities, using seed list"
                )
                break
            logger.warning(
                "Startup trie sync: server returned %s (attempt %d/12)",
                resp.status_code, attempt + 1,
            )
        except Exception as exc:  # noqa: BLE001 - fire-and-forget
            logger.warning(
                "Startup trie sync: %s (attempt %d/12)", exc, attempt + 1,
            )
        await asyncio.sleep(5)

    # Fallback: seed list.  Loaded either when the server was reachable but
    # empty, or when every retry failed.
    seeds = get_seed_entities()
    build_trie(seeds)
    logger.info(
        "Startup trie seed: %d entities loaded (%s)",
        len(seeds),
        "server unreachable" if not server_reachable else "server empty",
    )


app = FastAPI(
    title="CallPilot AI Engine",
    version="0.1.0",
    lifespan=lifespan,
)

if NEMOTRON_ENABLED:
    app.include_router(nemotron_router)

# Structure-aware document ingest (Docling). Always mounted - even on
# deployments that don't need Nemotron, callers can still use structured
# ingest. The Docling model is lazy-loaded on the first request.
from engine.routers.ingest_router import router as ingest_router
app.include_router(ingest_router)


@app.get("/health")
async def health():
    nemotron_loaded = False
    if NEMOTRON_ENABLED:
        from engine.stt.nemotron_pipeline import NemotronPipeline
        nemotron_loaded = NemotronPipeline.get_instance().is_loaded
    return {
        "status": "healthy",
        "service": "ai-engine",
        "engine": "nemotron-speech-streaming-en-0.6b",
        "model_loaded": nemotron_loaded,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Nemotron streaming REST - drop-in for the desktop agent's per-frame path
# ═══════════════════════════════════════════════════════════════════════════

if NEMOTRON_ENABLED:
    from engine.stt.nemotron_pipeline import NemotronPipeline
    import numpy as np

    class _StreamingSession:
        """Per-meeting streaming session with background inference.

        The endpoint appends audio synchronously (microseconds) and returns
        the last known partial text immediately. Inference runs on a single
        background task per meeting at a rate of ~200ms of new audio, which
        keeps latency bounded even when frames arrive every 40ms - without
        this, the per-frame inference call would queue up and latency would
        grow linearly with the queue depth.
        """

        def __init__(self, pipe, meeting_id: str) -> None:
            self.pipe = pipe
            self.meeting_id = meeting_id
            self.sess = pipe.init_session(meeting_id)
            self.last_text: str = ""
            self.last_text_lock = threading.Lock()
            self.state_lock = threading.Lock()
            self.inference_in_progress: bool = False
            self.just_reset: bool = False  # set after FINAL; cleared on first new inference
            self.history: list[str] = []   # accumulates finalized utterance texts

        def get_last_text(self) -> str:
            with self.last_text_lock:
                return self.last_text

        def get_full_text(self) -> str:
            """Returns history + current partial - the full conversation so far."""
            with self.last_text_lock:
                parts = self.history + ([self.last_text] if self.last_text else [])
                return " ".join(p for p in parts if p)

        def add_final(self, text: str) -> None:
            with self.last_text_lock:
                if text:
                    self.history.append(text)

        def reset(self) -> None:
            with self.state_lock:
                self.pipe.reset_session(self.sess)
            with self.last_text_lock:
                self.last_text = ""
                self.just_reset = True

    # Per-meeting streaming sessions. Created on first request, freed only
    # via the /reset/nemotron endpoint - long-lived meetings keep their state.
    _streaming_sessions: dict[str, _StreamingSession] = {}
    _streaming_sessions_lock = asyncio.Lock()

    async def _get_streaming_session(meeting_id: str) -> _StreamingSession:
        async with _streaming_sessions_lock:
            sess = _streaming_sessions.get(meeting_id)
            if sess is None:
                pipe = NemotronPipeline.get_instance()
                sess = _StreamingSession(pipe, meeting_id)
                _streaming_sessions[meeting_id] = sess
            return sess

    async def _run_streaming_inference(meeting_id: str, streamer: _StreamingSession) -> None:
        """Background Nemotron inference for a single meeting.

        Runs in the default thread-pool executor (one inference at a time
        per host - serialized by the pipeline's threading lock). Updates
        `streamer.last_text` and clears the `inference_in_progress` flag.
        """
        try:
            loop = asyncio.get_event_loop()
            text, _ = await loop.run_in_executor(
                None, streamer.pipe._transcribe_accumulated, streamer.sess, True
            )
            with streamer.last_text_lock:
                if text:
                    streamer.last_text = text
                    streamer.sess.current_text = text
                streamer.just_reset = False
        except Exception:
            logger.exception("Nemotron streaming inference failed for meeting %s", meeting_id)
        finally:
            with streamer.state_lock:
                streamer.inference_in_progress = False

    @app.post("/api/v1/ai/transcribe/nemotron", response_model=SpeechTaskResult)
    async def transcribe_audio_nemotron(
        request: Request,
        meeting_id: str = Query(...),
        sequence: int = Query(0),
        sample_rate: int = Query(16000),
        channels: int = Query(1),
        source: str = Query("microphone"),
    ):
        """Streaming transcription via Nemotron. Returns the last known
        partial text immediately (decoupled from inference), or a final
        transcript on VAD silence. While the model is loading, returns a
        `nemotron_loading` error so the desktop agent can retry."""
        if not NEMOTRON_ENABLED:
            raise HTTPException(status_code=503, detail="Nemotron disabled")

        pipe = NemotronPipeline.get_instance()

        if not pipe.is_loaded:
            if not pipe.is_loading:
                logger.info("Nemotron model not loaded - starting lazy load (first request)")
                asyncio.create_task(_ensure_nemotron_loaded_background(pipe))
            return SpeechTaskResult(
                task_id=f"nemotron-{meeting_id}-{sequence}",
                success=True,
                transcript=None,
                duration_ms=0,
                silence_detected=False,
                error="nemotron_loading",
            )

        body = await request.body()
        if not body:
            return SpeechTaskResult(
                task_id="nemotron-empty",
                success=True,
                transcript=None,
                duration_ms=0,
                silence_detected=False,
            )

        audio_i16 = np.frombuffer(body, dtype=np.int16)
        audio_f32 = audio_i16.astype(np.float32) / 32768.0

        streamer = await _get_streaming_session(meeting_id)
        sess = streamer.sess

        t0 = time.time()
        silence = streamer.pipe.detect_silence(audio_f32, sess)

        # ── VAD-driven finalisation ────────────────────────────────────
        if silence and sess.current_text:
            final_text = await asyncio.get_event_loop().run_in_executor(
                None, streamer.pipe.finalize, sess
            )
            if final_text:
                streamer.add_final(final_text)
            streamer.reset()
            duration_ms = (time.time() - t0) * 1000
            return SpeechTaskResult(
                task_id=f"nemotron-{meeting_id}-{sequence}",
                success=True,
                transcript=TranscriptSegment(
                    speaker="Customer-1",
                    text=final_text if final_text else sess.current_text,
                    confidence=0.95,
                    start="0.0",
                    end="0.0",
                    is_final=True,
                    meeting_id=meeting_id,
                    sequence=sequence,
                ),
                duration_ms=duration_ms,
                silence_detected=True,
            )

        # ── Append audio synchronously (microseconds) ──────────────────
        with streamer.state_lock:
            sess.accumulated_audio = np.concatenate([sess.accumulated_audio, audio_f32])
            min_samples = streamer.pipe._MIN_STREAMING_SAMPLES
            hop = NEMOTRON_HOP_SAMPLES
            emit_interval = streamer.pipe._EMIT_INTERVAL_SAMPLES

            should_infer = (
                not streamer.inference_in_progress
                and len(sess.accumulated_audio) >= min_samples
            )
            if should_infer and sess.emitted_frames > 0:
                samples_since_emit = (
                    len(sess.accumulated_audio) - sess.emitted_frames * hop
                )
                if samples_since_emit < emit_interval:
                    should_infer = False
            if should_infer:
                streamer.inference_in_progress = True

        if should_infer:
            asyncio.create_task(_run_streaming_inference(meeting_id, streamer))

        # ── Return last known text immediately ─────────────────────────
        last_text = streamer.get_full_text() or streamer.get_last_text()
        duration_ms = (time.time() - t0) * 1000

        if last_text:
            return SpeechTaskResult(
                task_id=f"nemotron-{meeting_id}-{sequence}",
                success=True,
                transcript=TranscriptSegment(
                    speaker="Customer-1",
                    text=last_text,
                    confidence=0.90,
                    start="0.0",
                    end="0.0",
                    is_final=False,
                    meeting_id=meeting_id,
                    sequence=sequence,
                ),
                duration_ms=duration_ms,
                silence_detected=False,
            )

        # ── "Ready" signal after FINAL ──────────────────────────────────
        # After VAD triggers a finalization, the session is reset and
        # `last_text` is cleared. Without this signal, the next several
        # requests return transcript=None (buffer below 320ms minimum or
        # the model hasn't produced text yet on the new audio) and the
        # desktop sees no activity at all - which looks like the pipeline
        # is dead. Emit a single empty partial on the first request after
        # reset so the desktop knows the session is fresh and ready for
        # the next utterance.
        with streamer.last_text_lock:
            if streamer.just_reset:
                streamer.just_reset = False
                return SpeechTaskResult(
                    task_id=f"nemotron-{meeting_id}-{sequence}",
                    success=True,
                    transcript=TranscriptSegment(
                        speaker="Customer-1",
                        text="",
                        confidence=0.0,
                        start="0.0",
                        end="0.0",
                        is_final=False,
                        meeting_id=meeting_id,
                        sequence=sequence,
                    ),
                    duration_ms=duration_ms,
                    silence_detected=False,
                )

        return SpeechTaskResult(
            task_id=f"nemotron-{meeting_id}-{sequence}",
            success=True,
            transcript=None,
            duration_ms=duration_ms,
            silence_detected=silence,
        )

    @app.post("/api/v1/meetings/{meeting_id}/reset/nemotron")
    async def reset_meeting_nemotron(meeting_id: str):
        async with _streaming_sessions_lock:
            streamer = _streaming_sessions.pop(meeting_id, None)
        if streamer is not None:
            streamer.reset()
        return {"status": "reset", "meeting_id": meeting_id, "engine": "nemotron"}


# ═══════════════════════════════════════════════════════════════════════════
# Downstream AI services - consumed by the .NET server
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/api/v1/ai/events")
async def detect_events(request: dict):
    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    events = _get_event_detector().detect_all(text, meeting_id=request.get("meeting_id"))
    return {"events": events, "count": len(events)}


@app.post("/api/v1/ai/embeddings")
async def generate_embedding(request: dict):
    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    svc = _get_embedding_service()
    embedding = svc.generate(text)
    return {"embedding": embedding, "model": svc.model_name, "dimensions": len(embedding)}


# ═══════════════════════════════════════════════════════════════════════════
# Dynamic Entity Extraction + Trie Management
# ═══════════════════════════════════════════════════════════════════════════

# Note: entity extraction no longer has its own endpoint. The merged LLM
# enrichment pass (/api/v1/documents/enrich) returns BOTH product cards and
# classified entities (product/feature/component/...), and the .NET upload
# handler persists those as DocumentEntity rows. GLiNER was removed - the
# LLM pass is the single entity authority.


@app.post("/api/v1/ai/trie/rebuild")
async def rebuild_trie(request: dict | None = None):
    """Rebuild the in-memory Aho-Corasick trie from a list of entities.

    Called after document ingest to register new entities.  If no entities
    are provided the trie is rebuilt from the Secure Meters product seed
    list so live calls still get product detections.
    """
    from engine.services.seed_entities import get_seed_entities
    from engine.services.trie_scanner import build_trie

    entities: list = (request or {}).get("entities", []) or []
    used_seed = False
    if not entities:
        entities = get_seed_entities()
        used_seed = True

    try:
        trie = build_trie(entities)
        return {
            "status": "rebuilt",
            "pattern_count": len(trie) if trie else 0,
            "used_seed": used_seed,
        }
    except Exception as exc:
        logger.exception("Trie rebuild failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/v1/ai/trie/status")
async def trie_status():
    """Return trie health info."""
    from engine.services.trie_scanner import get_trie
    trie = get_trie()
    return {
        "built": trie is not None,
        "pattern_count": len(trie) if trie else 0,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Competitive Intelligence - Phase 2 (Tavily) + Phase 3 (Redis cache)
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/internal/competitor-intel")
async def competitor_intel(request: dict):
    """Analyze an unknown entity for competitive intelligence.

    Called by the .NET EventDetectionService when trie scan misses an entity
    that appears to be a competing product. Fire-and-forget from .NET side.
    """
    entity = request.get("entity", "")
    segment = request.get("segment", "")
    meeting_id = request.get("meeting_id", "unknown")
    company_name = request.get("company_name", "")

    if not entity or not segment:
        raise HTTPException(status_code=400, detail="entity and segment are required")

    from engine.services.competitor_orchestrator import handle_unknown_entity

    # ── LLM client factory (lazy, uses .NET-configured provider) ──────
    async def _llm_client(prompt: str) -> str:
        """Proxy to the .NET LlmService via internal HTTP call."""
        import os
        import httpx
        server_url = os.getenv("CALLPILOT_SERVER_URL", "http://server:5001")
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{server_url}/internal/llm/generate",
                json={"prompt": prompt, "meeting_id": meeting_id},
            )
            if resp.status_code == 200:
                return resp.json().get("response", "")
            return ""

    result = await handle_unknown_entity(
        entity=entity,
        segment=segment,
        meeting_id=meeting_id,
        company_name=company_name,
        llm_client=_llm_client,
        cosine_search_fn=None,  # .NET handles cosine search; Python just runs classification + web intel
    )

    if result is None:
        return {"event_type": "NoAction", "entity": entity, "reason": "not_a_competitor"}

    return result


@app.post("/internal/product-intel")
async def product_intel(request: dict):
    """Research a detected product: Tavily discovery + LLM structured extraction.

    Called by the .NET ProductIntelEnrichmentService (background worker) when a
    product mention cannot be served from the cached ProductIntelligence row.
    The response is a validated product profile + sources that .NET persists;
    research happens once per canonical product.
    """
    name = (request.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    manufacturer = (request.get("manufacturer") or "").strip()
    category = (request.get("category") or "").strip()
    context = (request.get("context") or "")[:2000]
    company = (request.get("company") or "").strip()
    website = (request.get("website") or "").strip()
    meeting_id = request.get("meeting_id", "unknown")
    provider_config = request.get("provider")

    # Disambiguation hint from the knowledge base / seed data: the trie
    # entities carry product descriptions whose distinctive terms disambiguate
    # generic names in web search ("Prodigy" → "prodigy three-phase CT meter").
    # Request-level hints (company/website) win over inferred ones.
    description_terms = ""
    if not manufacturer or not category:
        from engine.services.seed_entities import get_seed_entities
        import re as _re
        _STOP = {"the", "and", "with", "for", "from", "into", "are", "is", "its", "a", "an"}
        for ent in get_seed_entities():
            if ent.get("entity_text") == name.lower():
                desc = ent.get("description") or ""
                m = _re.search(r"\b(Secure Meters)\b", desc, _re.IGNORECASE)
                if not manufacturer and m:
                    manufacturer = m.group(1)
                words = [w for w in _re.split(r"[^a-z0-9-]+", desc.lower()) if len(w) >= 4 and w not in _STOP]
                description_terms = " ".join(list(dict.fromkeys(words))[:6])
                break

    from engine.services.product_intel import research_product

    # ── LLM client factory (lazy, uses .NET-configured provider) ──────
    async def _llm_client(prompt: str) -> str:
        """Proxy to the .NET LlmService via internal HTTP call."""
        import os
        import httpx
        server_url = os.getenv("CALLPILOT_SERVER_URL", "http://server:5001")
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                f"{server_url}/internal/llm/generate",
                json={"prompt": prompt, "meeting_id": meeting_id},
            )
            if resp.status_code == 200:
                return resp.json().get("response", "")
            return ""

    result = await research_product(
        name=name,
        manufacturer=manufacturer,
        category=category,
        context=context,
        llm_client=_llm_client,
        boost=description_terms,
        company=company,
        website=website,
        provider_config=provider_config,
    )
    return {
        "name": name,
        **result,
    }


@app.post("/internal/ai/models")
async def ai_models(request: dict):
    """Discover the models available to a provider API key.

    Body: {"provider_type": "groq|openai|anthropic", "api_key": "...", "endpoint": null}
    Returns the live-discovered model list, degrading to the curated
    capability-tagged fallback when discovery is unavailable (Anthropic has
    no list-models API; Groq/OpenAI discovery can fail on transient errors).
    Never exposes the key.  Used by the .NET provider settings UI.
    """
    provider_type = (request.get("provider_type") or "").strip()
    api_key = (request.get("api_key") or "").strip()
    endpoint = request.get("endpoint") or None
    if not provider_type or not api_key:
        raise HTTPException(status_code=400, detail="provider_type and api_key are required")
    from engine.ai.model_catalog import ModelCatalog
    catalog = ModelCatalog()
    models = await catalog.discover(provider_type, api_key, endpoint)
    return {"provider_type": provider_type, "source": "live" if any(not m.from_fallback for m in models) else "fallback",
            "models": [m.to_dict() for m in models]}


@app.post("/internal/ai/test-key")
async def ai_test_key(request: dict):
    """Validate a provider API key (and optionally a model) without storing it.

    Body: {"provider_type": "...", "api_key": "...", "endpoint": null, "model": null}
    Makes the cheapest real provider call so .NET can show "Valid" /
    "Invalid key" / "Rate limited" / "Model unavailable" in the settings UI.
    Never stores or logs the key.
    """
    provider_type = (request.get("provider_type") or "").strip()
    api_key = (request.get("api_key") or "").strip()
    endpoint = request.get("endpoint") or None
    model = (request.get("model") or "").strip() or None
    if not provider_type or not api_key:
        raise HTTPException(status_code=400, detail="provider_type and api_key are required")

    from engine.ai.base import AiProviderConfig
    from engine.ai.providers import get_provider

    cfg = AiProviderConfig(
        provider_type=provider_type,
        model=model or _probe_model_for(provider_type),
        api_key=api_key,
        endpoint=endpoint,
        temperature=0.0,
        timeout_s=20.0,
    )
    try:
        provider = get_provider(cfg)
    except Exception as exc:
        return {"valid": False, "error_code": "unknown", "error": str(exc)[:300]}
    result = await provider.complete("Reply with the single word: OK", temperature=0.0, max_tokens=8)
    if result.outcome_status == "ok":
        return {"valid": True, "error_code": "ok", "error": None}
    return {"valid": False, "error_code": result.error_code, "error": (result.error_message or "")[:300]}


def _probe_model_for(provider_type: str) -> str:
    """Cheapest model per provider for a key-validation probe."""
    from engine.ai.base import APPLICATION_CATALOG
    catalog = APPLICATION_CATALOG.get(provider_type or "")
    return catalog[0]["id"] if catalog else ""


@app.delete("/internal/competitor-cache/{competitor_name}")
async def invalidate_competitor_cache(competitor_name: str):
    """Invalidate the Redis cache for a specific competitor."""
    from engine.services.competitor_intel import invalidate_cache
    ok = await invalidate_cache(competitor_name)
    return {"status": "invalidated" if ok else "not_found", "competitor": competitor_name}
