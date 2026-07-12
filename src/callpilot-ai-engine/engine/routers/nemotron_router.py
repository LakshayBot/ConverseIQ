"""
Nemotron STT endpoints — mounted as a FastAPI router when NEMOTRON_ENABLED.

Endpoints
─────────
  GET  /health/nemotron         — model load status + device info
  WS   /ws/transcribe/nemotron  — streaming ASR (raw PCM16 bytes, the
                                  primary path used by the desktop agent
                                  for desktop audio capture)
  POST /transcribe/nemotron     — batch ASR (WAV/FLAC file upload)
"""

from __future__ import annotations

import io
import logging

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from engine.config.nemotron_config import (
    NEMOTRON_CHUNK_MS,
    NEMOTRON_DEVICE,
    NEMOTRON_MODEL_NAME,
    NEMOTRON_RIGHT_CONTEXT,
)
from engine.stt.nemotron_pipeline import NemotronPipeline
from engine.stt.nemotron_websocket import NemotronWebSocket

logger = logging.getLogger(__name__)

router = APIRouter(tags=["nemotron"])


# ═══════════════════════════════════════════════════════════════════════════
# Shared helpers
# ═══════════════════════════════════════════════════════════════════════════


def _get_pipeline() -> NemotronPipeline:
    return NemotronPipeline.get_instance()


async def _ensure_model() -> None:
    """Ensure the Nemotron model is loaded (raises 503 if loading fails)."""
    pipe = _get_pipeline()
    try:
        await pipe.ensure_loaded()
    except Exception as exc:
        logger.exception("Nemotron model failed to load")
        raise HTTPException(
            status_code=503,
            detail=f"Nemotron model failed to load: {exc}",
        )


async def _decode_audio_to_f32(upload: UploadFile) -> tuple[np.ndarray, float]:
    """Decode WAV/FLAC upload → float32 mono 16kHz numpy array.

    Returns (audio, duration_seconds).
    """
    raw = await upload.read()

    # Try soundfile first (handles WAV, FLAC, OGG)
    try:
        import soundfile as sf
        data, sr = sf.read(io.BytesIO(raw), dtype="float32")
    except Exception:
        # Fallback: treat as raw PCM16 16kHz mono
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        sr = 16000

    if data.ndim > 1:
        data = data.mean(axis=1)

    if sr != 16000 and sr > 0:
        try:
            import math
            import scipy.signal
            gcd = math.gcd(sr, 16000)
            data = scipy.signal.resample_poly(data, 16000 // gcd, sr // gcd)
        except ImportError:
            raise HTTPException(
                status_code=400,
                detail=f"Audio is {sr} Hz (need 16 kHz) and scipy is not available for resampling",
            )

    data = data.astype(np.float32)
    duration = len(data) / 16000.0
    return data, duration


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/health/nemotron")
async def health_nemotron():
    """Return Nemotron model load status and configuration."""
    pipe = _get_pipeline()
    return {
        "status": "healthy" if pipe.is_loaded else "not_loaded",
        "model": NEMOTRON_MODEL_NAME,
        "device": NEMOTRON_DEVICE,
        "model_loaded": pipe.is_loaded,
        "config": {
            "right_context": NEMOTRON_RIGHT_CONTEXT,
            "chunk_ms": NEMOTRON_CHUNK_MS,
        },
    }


@router.websocket("/ws/transcribe/nemotron")
async def ws_transcribe_nemotron(ws: WebSocket):
    """Streaming ASR via WebSocket — the primary desktop-audio path.

    Protocol:
        Client → Server:  binary audio frames (PCM16, 16 kHz, mono)
        Client → Server:  {"type": "reset", "finalize": true/false}
        Server → Client:  {"type": "transcript", "text": "...", "is_final": bool}
    """
    handler = NemotronWebSocket(_get_pipeline())
    try:
        await handler.handle(ws)
    except WebSocketDisconnect:
        logger.info("Nemotron WS client disconnected")
    except Exception as exc:
        logger.exception("Nemotron WS unhandled error")
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass


@router.post("/transcribe/nemotron")
async def transcribe_nemotron(file: UploadFile = File(...)):
    """Batch (non-streaming) transcription.

    Upload a WAV, FLAC, or raw PCM16 file.  Returns the full transcript
    using maximum accuracy settings (right_context=13, keep_all_outputs).
    """
    await _ensure_model()

    audio, duration = await _decode_audio_to_f32(file)
    pipe = _get_pipeline()

    import asyncio
    import time
    t0 = time.time()
    transcript, _ = await asyncio.get_event_loop().run_in_executor(
        None, pipe.transcribe_batch, audio
    )
    elapsed = time.time() - t0

    return {
        "transcript": transcript,
        "model": "nemotron-0.6b",
        "mode": "batch",
        "duration_sec": round(duration, 2),
        "processing_time_sec": round(elapsed, 2),
        "real_time_factor": round(elapsed / max(duration, 0.01), 2),
    }
