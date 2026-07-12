"""
WebSocket handler for Nemotron streaming ASR.

Protocol (mirrors pipecat-ai/nemotron-january-2026 exactly):

  Client → Server
    • binary frames  — raw PCM16 16kHz mono audio bytes
    • {"type": "reset", "finalize": false}  — soft reset (VAD detected silence)
    • {"type": "reset", "finalize": true}   — hard reset (end of utterance)
    • {"type": "end"}                        — alias for hard reset

  Server → Client
    • {"type": "ready"}                                     — connection accepted
    • {"type": "transcript", "text": "...", "is_final": false}  — partial
    • {"type": "transcript", "text": "...", "is_final": true, "finalize": false}  — soft reset result
    • {"type": "transcript", "text": "...", "is_final": true, "finalize": true}   — hard reset result (delta)
    • {"type": "error", "message": "..."}                   — error
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

import numpy as np

from engine.stt.nemotron_pipeline import NemotronPipeline, NemotronSession

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────
_AUDIO_CHUNK_BYTES = 1024  # process audio in 1 KB increments for low latency
_WRITE_LOCK_TIMEOUT = 5.0   # seconds to wait for the inference lock before dropping


class NemotronWebSocket:
    """Per-connection WebSocket handler with its own session state.

    Designed to be instantiated inside a FastAPI websocket endpoint.
    """

    def __init__(self, pipeline: NemotronPipeline) -> None:
        self._pipe = pipeline
        self._sess: Optional[NemotronSession] = None
        self._audio_buffer: bytearray = bytearray()
        self._running: bool = False

    async def handle(self, ws) -> None:
        """Main entry point — called from the FastAPI websocket route."""
        await ws.accept()

        # ── Ensure model is loaded ─────────────────────────────────────
        if not self._pipe.is_loaded:
            await ws.send_json({"type": "status", "message": "Loading model…"})
            try:
                await self._pipe.ensure_loaded()
            except Exception as exc:
                logger.exception("Failed to load Nemotron model")
                await ws.send_json({"type": "error", "message": str(exc)})
                await ws.close(code=1011)
                return

        # ── Initialise session ─────────────────────────────────────────
        self._sess = self._pipe.init_session(session_id=f"ws-{id(ws)}")
        self._running = True

        await ws.send_json({"type": "ready"})
        logger.info("Nemotron WS session started: %s", self._sess.session_id)

        # ── Event loop ─────────────────────────────────────────────────
        try:
            while self._running:
                try:
                    msg = await asyncio.wait_for(ws.receive(), timeout=30.0)
                except asyncio.TimeoutError:
                    # Heartbeat — keep connection alive during silence
                    await ws.send_json({"type": "heartbeat"})
                    continue

                # ── Binary audio ───────────────────────────────────
                if "bytes" in msg:
                    raw = msg["bytes"]
                    await self._handle_audio(ws, raw)

                # ── Text / JSON control ────────────────────────────
                elif "text" in msg:
                    try:
                        data = json.loads(msg["text"])
                        await self._handle_control(ws, data)
                    except json.JSONDecodeError:
                        await ws.send_json(
                            {"type": "error", "message": "Invalid JSON"}
                        )

        except Exception as exc:
            logger.exception("Nemotron WS error for %s", self._sess.session_id)
            try:
                await ws.send_json({"type": "error", "message": str(exc)})
            except Exception:
                pass
        finally:
            self._running = False
            logger.info("Nemotron WS session ended: %s", self._sess.session_id)

    # ── audio ingestion ────────────────────────────────────────────────────

    async def _handle_audio(self, ws, raw: bytes) -> None:
        """Receive raw PCM16 bytes → float32 → feed to pipeline → send partials.

        Audio is processed in 1 KB increments for low latency (modal-nvidia-asr
        uses similar micro-batching via eager message draining).
        """
        self._audio_buffer.extend(raw)

        # Process in 1 KB chunks (= 512 samples = 32 ms at 16 kHz)
        while len(self._audio_buffer) >= _AUDIO_CHUNK_BYTES:
            chunk_bytes = bytes(self._audio_buffer[:_AUDIO_CHUNK_BYTES])
            del self._audio_buffer[:_AUDIO_CHUNK_BYTES]

            # Convert PCM16 → float32
            chunk_i16 = np.frombuffer(chunk_bytes, dtype=np.int16)
            chunk_f32 = chunk_i16.astype(np.float32) / 32768.0

            # ── VAD check ───────────────────────────────────────────
            if self._pipe.detect_silence(chunk_f32, self._sess):
                # Soft reset — send current text as final marker
                await self._send_soft_final(ws)

            # ── Inference ───────────────────────────────────────────
            async with self._pipe._inference_lock:
                text = await asyncio.get_event_loop().run_in_executor(
                    None,
                    self._pipe.append_audio_and_transcribe,
                    self._sess,
                    chunk_f32,
                )

            if text is not None:
                if text != self._sess.last_emitted_text:
                    self._sess.last_emitted_text = text
                    await ws.send_json({
                        "type": "transcript",
                        "text": text,
                        "is_final": False,
                    })

    # ── control messages ───────────────────────────────────────────────────

    async def _handle_control(self, ws, data: dict) -> None:
        msg_type = data.get("type", "")

        if msg_type == "reset":
            finalize = data.get("finalize", True)
            if finalize:
                await self._send_hard_final(ws)
            else:
                await self._send_soft_final(ws)

        elif msg_type == "end":
            # Legacy alias for hard reset
            await self._send_hard_final(ws)

        elif msg_type == "ping":
            await ws.send_json({"type": "pong"})

        else:
            logger.debug("Unknown Nemotron WS control: %s", msg_type)

    # ── reset handlers (soft / hard — pipecat pattern) ─────────────────────

    async def _send_soft_final(self, ws) -> None:
        """Soft reset: return current text immediately, keep all cache state.

        The client may discard this text (it can contain partial / incomplete
        words like "shipp" instead of "shipping").  See pipecat nvidia_stt.py.
        """
        if not self._sess or not self._sess.current_text:
            return

        await ws.send_json({
            "type": "transcript",
            "text": self._sess.current_text,
            "is_final": True,
            "finalize": False,
        })

    async def _send_hard_final(self, ws) -> None:
        """Hard reset: pad silence, keep_all_outputs=True, return delta, reset cache.

        Mirrors pipecat server.py:504-574 exactly — this is the canonical
        finalisation path that captures trailing words and deduplicates.
        After this, the session is fully reset for the next utterance.
        """
        if not self._sess:
            return

        # Wait for any in-flight inference to finish
        async with self._pipe._inference_lock:
            delta = await asyncio.get_event_loop().run_in_executor(
                None, self._pipe.finalize, self._sess
            )

        if delta:
            await ws.send_json({
                "type": "transcript",
                "text": delta,
                "is_final": True,
                "finalize": True,
            })

        # ── Reset session (pipecat _init_session pattern) ──────────────
        self._pipe.reset_session(self._sess)
        self._audio_buffer = bytearray()


# ═══════════════════════════════════════════════════════════════════════════
# Convenience function for FastAPI endpoint
# ═══════════════════════════════════════════════════════════════════════════


async def handle_nemotron_websocket(ws) -> None:
    """Thin wrapper — instantiate handler and delegate."""
    pipe = NemotronPipeline.get_instance()
    handler = NemotronWebSocket(pipe)
    await handler.handle(ws)
