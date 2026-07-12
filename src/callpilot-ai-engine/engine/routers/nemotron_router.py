"""
Nemotron experimental endpoints — mounted as a FastAPI router.

Endpoints
─────────
  GET  /health/nemotron         — model load status + device info
  WS   /ws/transcribe/nemotron  — streaming ASR (raw PCM16 bytes)
  POST /transcribe/nemotron     — batch ASR (WAV/FLAC file upload)
  POST /transcribe/compare      — side-by-side: Faster-Whisper vs Nemotron

All Nemotron code is self-contained; zero changes to existing STT files.
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
import wave
from typing import Optional

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from engine.config.nemotron_config import (
    NEMOTRON_ENABLED,
    NEMOTRON_MODEL_NAME,
    NEMOTRON_DEVICE,
    NEMOTRON_RIGHT_CONTEXT,
    NEMOTRON_CHUNK_MS,
)
from engine.stt.nemotron_pipeline import NemotronPipeline
from engine.stt.nemotron_websocket import NemotronWebSocket

logger = logging.getLogger(__name__)

router = APIRouter(tags=["nemotron-experimental"])

# ═══════════════════════════════════════════════════════════════════════════
# Shared helpers
# ═══════════════════════════════════════════════════════════════════════════


def _get_pipeline() -> NemotronPipeline:
    """Convenience accessor — returns the singleton pipeline."""
    return NemotronPipeline.get_instance()


async def _ensure_model() -> None:
    """Ensure the Nemotron model is loaded (raises 503 if not enabled)."""
    if not NEMOTRON_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Nemotron pipeline is disabled (NEMOTRON_ENABLED=false)",
        )
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

    # ── Mono ──────────────────────────────────────────────────────────
    if data.ndim > 1:
        data = data.mean(axis=1)

    # ── Resample if needed ────────────────────────────────────────────
    if sr != 16000 and sr > 0:
        try:
            import scipy.signal
            import math
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
    if not NEMOTRON_ENABLED:
        return {
            "status": "disabled",
            "model": NEMOTRON_MODEL_NAME,
            "device": NEMOTRON_DEVICE,
        }

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
    """Streaming ASR via WebSocket.

    Protocol (identical to pipecat-ai/nemotron-january-2026):
        Client → Server:  binary audio frames (PCM16, 16 kHz, mono)
        Client → Server:  {"type": "reset", "finalize": true/false}
        Server → Client:  {"type": "transcript", "text": "...", "is_final": false}
        Server → Client:  {"type": "transcript", "text": "...", "is_final": true}
    """
    if not NEMOTRON_ENABLED:
        await ws.accept()
        await ws.send_json({"type": "error", "message": "Nemotron pipeline disabled"})
        await ws.close()
        return

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

    Response:
        {"transcript": "...", "model": "nemotron-0.6b", "mode": "batch",
         "duration_sec": 12.3, "processing_time_sec": 4.5}
    """
    await _ensure_model()

    audio, duration = await _decode_audio_to_f32(file)
    pipe = _get_pipeline()

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


@router.post("/transcribe/compare")
async def transcribe_compare(file: UploadFile = File(...)):
    """Run the same audio through BOTH Faster-Whisper AND Nemotron.

    Returns side-by-side transcripts for experimental benchmarking.

    Response:
        {"faster_whisper": "...", "nemotron": "...",
         "audio_duration_sec": 12.3, "nemotron_loaded": true}
    """
    await _ensure_model()

    audio, duration = await _decode_audio_to_f32(file)
    pipe = _get_pipeline()

    # ── Nemotron batch ─────────────────────────────────────────────────
    nemotron_text = "N/A"
    nemotron_loaded = False
    try:
        nemotron_text, _ = await asyncio.get_event_loop().run_in_executor(
            None, pipe.transcribe_batch, audio
        )
        nemotron_loaded = True
    except Exception as exc:
        logger.exception("Nemotron comparison failed")
        nemotron_text = f"ERROR: {exc}"

    # ── Faster-Whisper (use existing pipeline from lifespan) ──────────
    whisper_text = "N/A"
    try:
        from engine.main import speech_worker as _sw

        if _sw is not None:
            audio_i16 = (audio * 32767).clip(-32768, 32767).astype(np.int16)
            audio_bytes = audio_i16.tobytes()

            result = await _sw.process_audio(
                meeting_id="compare-bench",
                audio_bytes=audio_bytes,
                sequence=0,
                sample_rate=16000,
                channels=1,
                source="desktop",
            )
            if result.success and result.transcript:
                whisper_text = result.transcript.text
        else:
            whisper_text = "ERROR: speech_worker not initialized"
    except Exception as exc:
        logger.exception("Faster-Whisper comparison failed")
        whisper_text = f"ERROR: {exc}"

    return {
        "faster_whisper": whisper_text,
        "nemotron": nemotron_text,
        "audio_duration_sec": round(duration, 2),
        "nemotron_loaded": nemotron_loaded,
    }
