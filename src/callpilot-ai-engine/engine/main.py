import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request

from engine.models import SpeechTaskResult, TranscriptSegment
from engine.knowledge_engine.embedding_service import EmbeddingService
from engine.event_engine.event_detector import EventDetector
from engine.workers.speech_worker import SpeechWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("callpilot.ai")

speech_worker: SpeechWorker | None = None
embedding_service: EmbeddingService | None = None
event_detector: EventDetector | None = None


def get_model_config():
    return {
        "model_size": os.getenv("WHISPER_MODEL_SIZE", "medium.en"),
        "device": os.getenv("WHISPER_DEVICE", "cpu"),
        "compute_type": os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global speech_worker, embedding_service, event_detector
    config = get_model_config()
    logger.info(
        f"Loading Whisper model: {config['model_size']} on {config['device']}/{config['compute_type']}"
    )
    speech_worker = SpeechWorker(
        model_size=config["model_size"],
        device=config["device"],
        compute_type=config["compute_type"],
    )

    embedding_service = EmbeddingService()
    embedding_service.load_model()

    event_detector = EventDetector()

    # ── Pre-load Nemotron model in background (if enabled) ─────────────
    if _NEMOTRON_ENABLED:
        try:
            from engine.stt.nemotron_pipeline import NemotronPipeline
            pipe = NemotronPipeline.get_instance()
            asyncio.create_task(_preload_nemotron(pipe))
        except Exception:
            logger.exception("Failed to start Nemotron pre-load")

    logger.info("AI Engine ready")
    yield
    logger.info("AI Engine shutting down")


async def _preload_nemotron(pipe) -> None:
    """Pre-load the Nemotron model so the first streaming request is fast."""
    try:
        logger.info("Nemotron pre-load started (background)…")
        await pipe.ensure_loaded()
        logger.info("Nemotron pre-load complete")
    except Exception as exc:
        logger.warning("Nemotron pre-load failed (will retry on first request): %s", exc)


app = FastAPI(
    title="CallPilot AI Engine",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai-engine",
        "model_loaded": speech_worker is not None,
        "config": get_model_config(),
    }


@app.post("/api/v1/ai/transcribe", response_model=SpeechTaskResult)
async def transcribe_audio(
    request: Request,
    meeting_id: str = Query(...),
    sequence: int = Query(0),
    sample_rate: int = Query(16000),
    channels: int = Query(1),
    source: str = Query("microphone"),
):
    if speech_worker is None:
        raise HTTPException(status_code=503, detail="Speech worker not initialized")

    body = await request.body()

    result = await speech_worker.process_audio(
        meeting_id=meeting_id,
        audio_bytes=body,
        sequence=sequence,
        sample_rate=sample_rate,
        channels=channels,
        source=source,
    )

    return result


@app.post("/api/v1/ai/transcribe/json", response_model=SpeechTaskResult)
async def transcribe_audio_json(request: dict):
    if speech_worker is None:
        raise HTTPException(status_code=503, detail="Speech worker not initialized")

    audio_bytes = request.get("audio")
    if isinstance(audio_bytes, str):
        import base64
        audio_bytes = base64.b64decode(audio_bytes)

    meeting_id = request.get("meeting_id", "unknown")
    sequence = request.get("sequence", 0)
    sample_rate = request.get("sample_rate", 16000)
    channels = request.get("channels", 1)
    source = request.get("source", "microphone")

    if isinstance(audio_bytes, list):
        audio_bytes = bytes(audio_bytes)

    result = await speech_worker.process_audio(
        meeting_id=str(meeting_id),
        audio_bytes=bytes(audio_bytes) if audio_bytes else b"",
        sequence=int(sequence),
        sample_rate=int(sample_rate),
        channels=int(channels),
        source=str(source),
    )

    return result


@app.post("/api/v1/meetings/{meeting_id}/reset")
async def reset_meeting(meeting_id: str):
    if speech_worker is None:
        raise HTTPException(status_code=503, detail="Speech worker not initialized")

    speech_worker.reset_meeting(meeting_id)
    return {"status": "reset", "meeting_id": meeting_id}


@app.post("/api/v1/ai/events")
async def detect_events(request: dict):
    if event_detector is None:
        raise HTTPException(status_code=503, detail="Event detector not initialized")

    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    events = event_detector.detect_all(text)
    return {"events": events, "count": len(events)}


@app.post("/api/v1/ai/embeddings")
async def generate_embedding(request: dict):
    if embedding_service is None:
        raise HTTPException(status_code=503, detail="Embedding service not initialized")

    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    embedding = embedding_service.generate(text)
    return {"embedding": embedding, "model": embedding_service.model_name, "dimensions": len(embedding)}


# ═══════════════════════════════════════════════════════════════════════════
# Nemotron experimental pipeline (guard: NEMOTRON_ENABLED env var)
# ═══════════════════════════════════════════════════════════════════════════

from engine.config.nemotron_config import NEMOTRON_ENABLED as _NEMOTRON_ENABLED

if _NEMOTRON_ENABLED:
    from engine.routers.nemotron_router import router as nemotron_router

    app.include_router(nemotron_router)

    # ── Per-meeting Nemotron sessions (for the streaming REST endpoint) ──
    _nemotron_sessions: dict[str, "NemotronSession"] = {}
    _nemotron_sessions_lock = asyncio.Lock()

    @app.post("/api/v1/ai/transcribe/nemotron", response_model=SpeechTaskResult)
    async def transcribe_audio_nemotron(
        request: Request,
        meeting_id: str = Query(...),
        sequence: int = Query(0),
        sample_rate: int = Query(16000),
        channels: int = Query(1),
        source: str = Query("microphone"),
    ):
        """Streaming transcription via Nemotron — drop-in for /api/v1/ai/transcribe.

        Maintains per-meeting NemotronSession state across sequential chunks.
        Returns partial transcripts frequently (~every 200ms of accumulated audio),
        final transcripts on VAD silence, or a \"loading\" status while the model
        initialises.
        """
        from engine.stt.nemotron_pipeline import NemotronPipeline
        import numpy as np

        pipe = NemotronPipeline.get_instance()

        # ── Lazy-load model (blocks first call for 30-60s) ──────────────
        if not pipe.is_loaded:
            if not pipe.is_loading:
                logger.info("Nemotron model not loaded — starting lazy load (first request)")
                # Kick off loading in background so we can return a status
                asyncio.create_task(_load_nemotron_background(pipe))
            return SpeechTaskResult(
                task_id=f"nemotron-{meeting_id}-{sequence}",
                success=True,
                transcript=None,
                duration_ms=0,
                silence_detected=False,
                error="nemotron_loading",
            )

        # Read raw PCM16 audio
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

        # Get or create session for this meeting
        async with _nemotron_sessions_lock:
            if meeting_id not in _nemotron_sessions:
                _nemotron_sessions[meeting_id] = pipe.init_session(meeting_id)
            sess = _nemotron_sessions[meeting_id]

        t0 = time.time()

        # VAD check
        silence = pipe.detect_silence(audio_f32, sess)

        # Streaming inference
        text = await asyncio.get_event_loop().run_in_executor(
            None, pipe.append_audio_and_transcribe, sess, audio_f32
        )

        duration_ms = (time.time() - t0) * 1000

        if silence and sess.current_text:
            # VAD triggered — hard finalize and reset
            final_text = await asyncio.get_event_loop().run_in_executor(
                None, pipe.finalize, sess
            )
            pipe.reset_session(sess)

            transcript = TranscriptSegment(
                speaker="Customer-1",
                text=final_text if final_text else sess.current_text,
                confidence=0.95,
                start=str(sess.emitted_frames * 0.01),
                end=str((sess.emitted_frames + 1) * 0.01),
                is_final=True,
                meeting_id=meeting_id,
                sequence=sequence,
            )

            return SpeechTaskResult(
                task_id=f"nemotron-{meeting_id}-{sequence}",
                success=True,
                transcript=transcript,
                duration_ms=duration_ms,
                silence_detected=True,
            )

        if text is not None and text.strip():
            transcript = TranscriptSegment(
                speaker="Customer-1",
                text=text,
                confidence=0.90,
                start="0.0",
                end="0.0",
                is_final=False,
                meeting_id=meeting_id,
                sequence=sequence,
            )

            return SpeechTaskResult(
                task_id=f"nemotron-{meeting_id}-{sequence}",
                success=True,
                transcript=transcript,
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


    async def _load_nemotron_background(pipe) -> None:
        """Background task to load the Nemotron model without blocking."""
        try:
            await pipe.ensure_loaded()
            logger.info("Nemotron model loaded successfully (background)")
        except Exception as exc:
            logger.exception("Nemotron background load failed: %s", exc)

    @app.post("/api/v1/meetings/{meeting_id}/reset/nemotron")
    async def reset_meeting_nemotron(meeting_id: str):
        """Reset a Nemotron streaming session."""
        async with _nemotron_sessions_lock:
            if meeting_id in _nemotron_sessions:
                from engine.stt.nemotron_pipeline import NemotronPipeline
                pipe = NemotronPipeline.get_instance()
                pipe.reset_session(_nemotron_sessions[meeting_id])
                del _nemotron_sessions[meeting_id]
        return {"status": "reset", "meeting_id": meeting_id, "engine": "nemotron"}

    logger.info(
        "Nemotron experimental pipeline ENABLED "
        "(set NEMOTRON_ENABLED=false to disable)"
    )
else:
    logger.info("Nemotron experimental pipeline DISABLED (NEMOTRON_ENABLED=false)")
