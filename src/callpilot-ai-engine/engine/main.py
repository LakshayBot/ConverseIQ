"""
CallPilot AI Engine — Nemotron-only STT entry point.

Exposes the nvidia/nemotron-speech-streaming-en-0.6b pipeline via:
  • POST /api/v1/ai/transcribe/nemotron   (streaming REST — drop-in for the
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

# Module-level lazy singletons — populated in lifespan, accessed by the
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
            "NEMOTRON_ENABLED is false — the only STT path will refuse to load. "
            "Set NEMOTRON_ENABLED=true (the default) to enable transcription."
        )

    # Build the in-memory Aho-Corasick trie from seed competitors.
    # Document entities are loaded via /api/v1/ai/trie/rebuild after ingest.
    from engine.services.trie_scanner import build_trie
    build_trie([])
    logger.info("Trie initialised (empty — entities loaded from documents after ingest)")

    yield
    logger.info("AI Engine shutting down")


app = FastAPI(
    title="CallPilot AI Engine",
    version="0.1.0",
    lifespan=lifespan,
)

if NEMOTRON_ENABLED:
    app.include_router(nemotron_router)


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
# Nemotron streaming REST — drop-in for the desktop agent's per-frame path
# ═══════════════════════════════════════════════════════════════════════════

if NEMOTRON_ENABLED:
    from engine.stt.nemotron_pipeline import NemotronPipeline
    import numpy as np

    class _StreamingSession:
        """Per-meeting streaming session with background inference.

        The endpoint appends audio synchronously (microseconds) and returns
        the last known partial text immediately. Inference runs on a single
        background task per meeting at a rate of ~200ms of new audio, which
        keeps latency bounded even when frames arrive every 40ms — without
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
            """Returns history + current partial — the full conversation so far."""
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
    # via the /reset/nemotron endpoint — long-lived meetings keep their state.
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
        per host — serialized by the pipeline's threading lock). Updates
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
                logger.info("Nemotron model not loaded — starting lazy load (first request)")
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
        # desktop sees no activity at all — which looks like the pipeline
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
# Downstream AI services — consumed by the .NET server
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/api/v1/ai/events")
async def detect_events(request: dict):
    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    events = _get_event_detector().detect_all(text)
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


@app.post("/api/v1/ai/extract-entities")
async def extract_entities_from_text(request: dict):
    """Run GLiNER entity extraction on *text* and return deduplicated entities.

    Called by the .NET knowledge upload pipeline after text extraction,
    before chunking/embedding. GLiNER runs only here (ingest time), never
    during live calls.
    """
    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    threshold = float(request.get("confidence_threshold", 0.4))

    try:
        from engine.services.entity_extractor import extract_entities as _extract
        entities = await _extract(text, confidence_threshold=threshold)
        return {"entities": entities, "count": len(entities)}
    except Exception as exc:
        logger.exception("Entity extraction failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/ai/trie/rebuild")
async def rebuild_trie(request: dict | None = None):
    """Rebuild the in-memory Aho-Corasick trie from a list of entities.

    Called after document ingest to register new entities.  If no entities
    are provided the trie is rebuilt with seed competitors only.
    """
    from engine.services.trie_scanner import build_trie

    entities: list = (request or {}).get("entities", [])

    try:
        trie = build_trie(entities)
        return {"status": "rebuilt", "pattern_count": len(trie)}
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
# Competitive Intelligence — Phase 2 (Tavily) + Phase 3 (Redis cache)
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


@app.delete("/internal/competitor-cache/{competitor_name}")
async def invalidate_competitor_cache(competitor_name: str):
    """Invalidate the Redis cache for a specific competitor."""
    from engine.services.competitor_intel import invalidate_cache
    ok = await invalidate_cache(competitor_name)
    return {"status": "invalidated" if ok else "not_found", "competitor": competitor_name}
