"""
Nemotron Speech Streaming pipeline — cache-aware, energy-VAD gated.

Implements the inference patterns from:
  • modal-projects/modal-nvidia-asr  (cache-aware streaming, concurrent slots)
  • pipecat-ai/nemotron-january-2026 (soft/hard reset, delta dedup, 160ms chunks)

Lazy-loads the model on first use so server startup stays fast even when
NeMo takes 30+ seconds to initialise. Uses two serialisation locks:
  • `inference_lock`  (asyncio.Lock) — held by the WebSocket handler while
                                the executor runs a batch transcribe
  • `_inference_lock` (threading.Lock) — held by the sync streaming path
                                inside `_transcribe_accumulated`
The two locks together prevent concurrent CPU-bound NeMo inference on a
single host, regardless of whether the caller is an asyncio task or a
thread.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Optional, Tuple

import numpy as np

from engine.config.nemotron_config import (
    NEMOTRON_DEVICE,
    NEMOTRON_HOP_SAMPLES,
    NEMOTRON_MODEL_NAME,
    NEMOTRON_SAMPLE_RATE,
    NEMOTRON_VAD_RMS_THRESHOLD,
    NEMOTRON_VAD_SILENCE_FRAMES,
)

logger = logging.getLogger(__name__)

# torch is imported lazily inside methods that need it — keeps the import cost
# off the critical path and lets the rest of the module load before NeMo
# resolves its ~hundreds-of-MB dependency tree.

# ═══════════════════════════════════════════════════════════════════════════
# Per-stream session state
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class NemotronSession:
    """Cache-aware state for a single streaming recognition session."""

    session_id: str
    accumulated_audio: np.ndarray = field(
        default_factory=lambda: np.array([], dtype=np.float32)
    )
    emitted_frames: int = 0

    # ── Encoder KV cache (3-tensor tuple from conformer encoder) ──────────
    cache_last_channel: Optional["torch.Tensor"] = None
    cache_last_time: Optional["torch.Tensor"] = None
    cache_last_channel_len: Optional["torch.Tensor"] = None

    # ── Decoder state ─────────────────────────────────────────────────────
    previous_hypotheses: Optional["torch.Tensor"] = None
    pred_out_stream: Optional["torch.Tensor"] = None

    # ── Transcript text ───────────────────────────────────────────────────
    current_text: str = ""
    last_emitted_text: str = ""  # for delta dedup (pipecat pattern)

    # ── VAD state ─────────────────────────────────────────────────────────
    silent_frames: int = 0
    vad_triggered: bool = False


# ═══════════════════════════════════════════════════════════════════════════
# Singleton pipeline  (lazy-loads model on first call)
# ═══════════════════════════════════════════════════════════════════════════


class NemotronPipeline:
    """Streaming ASR via nvidia/nemotron-speech-streaming-en-0.6b."""

    _instance: Optional["NemotronPipeline"] = None

    def __init__(self) -> None:
        self.model: Optional["ASRModel"] = None
        self._loaded: bool = False
        self._loading: bool = False
        self._load_lock: asyncio.Lock = asyncio.Lock()
        self._inference_lock: threading.Lock = threading.Lock()  # sync path
        self.inference_lock: asyncio.Lock = asyncio.Lock()       # async path (WebSocket)

    # ── singleton ────────────────────────────────────────────────────────

    @classmethod
    def get_instance(cls) -> "NemotronPipeline":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── lazy load ────────────────────────────────────────────────────────

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def is_loading(self) -> bool:
        return self._loading

    async def ensure_loaded(self) -> None:
        """Lazy-load the Nemotron model on first request (thread-safe)."""
        if self._loaded:
            return

        async with self._load_lock:
            if self._loaded:
                return
            if self._loading:
                while not self._loaded:
                    await asyncio.sleep(0.25)
                return

            self._loading = True
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, self._load_model
                )
                self._loaded = True
            finally:
                self._loading = False

    def _load_model(self) -> None:
        """Synchronous model load — runs in thread pool to avoid blocking the event loop."""
        import nemo.collections.asr as nemo_asr  # noqa: F401

        logger.info(
            "Loading Nemotron model %s on %s (this may take 30-60 s on first run)…",
            NEMOTRON_MODEL_NAME,
            NEMOTRON_DEVICE,
        )
        t0 = time.time()

        self.model = nemo_asr.models.ASRModel.from_pretrained(
            NEMOTRON_MODEL_NAME,
            map_location=NEMOTRON_DEVICE,
        )
        self.model.eval()

        elapsed = time.time() - t0
        logger.info("Nemotron model ready (%.1f s, device=%s)", elapsed, NEMOTRON_DEVICE)

    # ── session management ────────────────────────────────────────────────

    def init_session(self, session_id: str) -> NemotronSession:
        return NemotronSession(session_id=session_id)

    def reset_session(self, sess: NemotronSession) -> None:
        """Hard reset after finalisation — clears all accumulated state."""
        sess.accumulated_audio = np.array([], dtype=np.float32)
        sess.emitted_frames = 0
        sess.previous_hypotheses = None
        sess.pred_out_stream = None
        sess.current_text = ""
        sess.last_emitted_text = ""
        sess.silent_frames = 0
        sess.vad_triggered = False

    # ── streaming transcription ───────────────────────────────────────────
    # Minimum audio (ms) before the first inference attempt.
    # Nemotron processes 160ms chunks natively, but short audio often
    # returns empty text — wasting ~500ms of NeMo overhead.  320ms gives
    # the model enough signal for a meaningful first word without adding
    # noticeable latency.
    _MIN_STREAMING_CHUNK_MS: int = int(os.getenv("NEMOTRON_MIN_CHUNK_MS", "320"))
    _MIN_STREAMING_SAMPLES: int = _MIN_STREAMING_CHUNK_MS * NEMOTRON_SAMPLE_RATE // 1000

    # How long to wait between consecutive batch transcribe calls (ms).
    # The desktop sends 40ms chunks, so an interval of ~200ms means every
    # 5 chunks trigger a fresh transcript.
    _EMIT_INTERVAL_SAMPLES: int = int(
        os.getenv("NEMOTRON_EMIT_INTERVAL_MS", "200")
    ) * NEMOTRON_SAMPLE_RATE // 1000

    # MAX sliding window for partial transcripts (seconds).
    # Instead of re-transcribing the ENTIRE accumulated buffer (which grows
    # without bound and causes latency to climb to 3+ seconds), we only
    # transcribe the last N seconds of audio for each partial emission.
    # This keeps inference time constant (~1 s on CPU) regardless of
    # meeting length.  The FULL buffer is still used for finalize() so
    # the completed segment has maximum accuracy.
    _MAX_PARTIAL_WINDOW_SECONDS: float = float(
        os.getenv("NEMOTRON_PARTIAL_WINDOW_SEC", "8")
    )
    _MAX_PARTIAL_WINDOW_SAMPLES: int = int(
        _MAX_PARTIAL_WINDOW_SECONDS * NEMOTRON_SAMPLE_RATE
    )

    def append_audio_and_transcribe(
        self, sess: NemotronSession, chunk: np.ndarray
    ) -> Optional[str]:
        """Append raw float32 audio and return full accumulated transcript.

        Uses batch transcribe() on the accumulated buffer.  The first call that
        reaches _MIN_STREAMING_SAMPLES triggers the initial inference; subsequent
        calls re-transcribe only when _EMIT_INTERVAL_SAMPLES of new audio has
        arrived since the last emission.

        Returns the **full** accumulated transcript text, or None if the buffer
        hasn't grown enough since the last emission.
        """
        if not self._loaded or self.model is None:
            return None

        sess.accumulated_audio = np.concatenate([sess.accumulated_audio, chunk])

        # Don't transcribe at all until we have at least one native chunk.
        if len(sess.accumulated_audio) < self._MIN_STREAMING_SAMPLES:
            return None

        # Only re-run inference when enough *new* audio has arrived.
        samples_since_emit = len(sess.accumulated_audio) - (sess.emitted_frames * NEMOTRON_HOP_SAMPLES)
        if sess.emitted_frames > 0 and samples_since_emit < self._EMIT_INTERVAL_SAMPLES:
            return None

        try:
            import torch  # noqa: F401
            with torch.no_grad():
                text, _duration = self._transcribe_accumulated(sess, return_duration=True)
        except Exception:
            logger.exception("Nemotron streaming batch inference failed")
            return sess.current_text  # return last known good text

        # ⚠ Always advance emitted_frames after inference — even if text is
        # empty.  Without this, short-audio inferences that return "" never
        # update the pointer, so every 40ms chunk triggers a fresh (queued)
        # inference and the system never catches up.
        sess.emitted_frames = len(sess.accumulated_audio) // NEMOTRON_HOP_SAMPLES

        if text:
            sess.current_text = text

        return text or sess.current_text

    def _transcribe_accumulated(
        self, sess: NemotronSession, return_duration: bool = False,
        use_full_buffer: bool = False,
    ) -> Tuple[str, float]:
        """Run batch transcribe() on accumulated audio.

        For streaming partials (use_full_buffer=False): only transcribes the
        last _MAX_PARTIAL_WINDOW_SECONDS of audio — keeps latency flat
        regardless of meeting length.

        For finalize (use_full_buffer=True): transcribes the full buffer for
        maximum accuracy on the completed segment.

        Serialised with _inference_lock to prevent multiple threads from
        competing for CPU cores during batch inference.
        """
        import torch  # noqa: F401

        audio = sess.accumulated_audio.copy()  # snapshot to avoid races

        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)

        # ── Sliding window cap for streaming partials ─────────────────────
        # Without this, the buffer grows forever and each inference takes
        # longer than the last (96 s of audio → 11+ s processing → queue
        # backup → 2.9 s measured latency).  Capping to the last N seconds
        # gives constant ~1 s latency even in hour-long meetings.
        if not use_full_buffer and len(audio) > self._MAX_PARTIAL_WINDOW_SAMPLES:
            audio = audio[-self._MAX_PARTIAL_WINDOW_SAMPLES:]

        duration = len(audio) / NEMOTRON_SAMPLE_RATE
        text = self._run_batch_transcribe(audio)
        total_dur = len(sess.accumulated_audio) / NEMOTRON_SAMPLE_RATE

        if not use_full_buffer and total_dur > self._MAX_PARTIAL_WINDOW_SECONDS:
            logger.debug(
                "Nemotron partial: windowed last %.1fs of %.1fs total → %r",
                duration, total_dur, text,
            )
        elif duration >= 2.0:
            logger.debug("Nemotron: %.1fs audio → %r", duration, text)

        return (text, duration) if return_duration else text

    def _run_batch_transcribe(self, audio: np.ndarray) -> str:
        """Write audio to a temp WAV, run `model.transcribe([tmp])`, decode
        the hypothesis output, delete the temp file. Shared by
        `_transcribe_accumulated` (partials + finalize) and `transcribe_batch`.
        """
        import torch  # noqa: F401
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, NEMOTRON_SAMPLE_RATE, format="WAV")

        try:
            t0 = time.time()
            with self._inference_lock:
                with torch.no_grad():
                    output = self.model.transcribe(
                        [tmp.name],
                        batch_size=1,
                        return_hypotheses=False,
                    )
            elapsed = time.time() - t0
            text = self._decode_hypothesis_output(output)
            logger.debug("Nemotron inference: %.2fs wall, %d chars", elapsed, len(text))
            return text
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    @staticmethod
    def _decode_hypothesis_output(output) -> str:
        """Extract a plain-text transcript from the NeMo transcribe() return
        value, which can be a list of Hypothesis objects, a list of strings,
        or a bare string depending on the NeMo version and options."""
        if isinstance(output, list) and len(output) > 0:
            first = output[0]
            if hasattr(first, "text"):
                text = first.text
            else:
                text = str(first)
        elif isinstance(output, str):
            text = output
        else:
            text = str(output)
        return text.replace("▁", " ").strip()

    # ── finalisation (hard reset) ────────────────────────────────────────

    def finalize(self, sess: NemotronSession) -> str:
        """Return the final transcript of all accumulated audio (batch mode).

        Uses the robust transcribe() API — no fragile conformer_stream_step.
        Returns the delta (new text) vs the last emitted partial.
        """
        if not self._loaded or self.model is None:
            return sess.current_text

        import torch  # noqa: F401

        try:
            with torch.no_grad():
                final_text, _duration = self._transcribe_accumulated(
                    sess, return_duration=True, use_full_buffer=True,
                )
        except Exception:
            logger.exception("Nemotron finalize batch inference failed")
            return sess.current_text

        # ── Delta dedup ─────────────────────────────────────────────────
        if final_text and sess.last_emitted_text:
            if final_text.startswith(sess.last_emitted_text):
                delta = final_text[len(sess.last_emitted_text):].lstrip()
            else:
                delta = final_text
        else:
            delta = final_text

        sess.last_emitted_text = final_text
        sess.current_text = final_text
        return delta or final_text

    # ── batch transcription (REST endpoint) ─────────────────────────────────

    def transcribe_batch(self, audio: np.ndarray) -> Tuple[str, float]:
        """Batch-mode transcription — processes entire audio at once.

        Returns (transcript, duration_seconds).
        """
        if not self._loaded or self.model is None:
            raise RuntimeError("Nemotron model not loaded")

        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)
        duration = len(audio) / NEMOTRON_SAMPLE_RATE

        text = self._run_batch_transcribe(audio)

        logger.info(
            "Nemotron batch: %.1f s audio → %d chars",
            duration, len(text),
        )
        return text, duration

    # ── VAD ────────────────────────────────────────────────────────────────

    def detect_silence(self, chunk: np.ndarray, sess: NemotronSession) -> bool:
        """Energy-based VAD — returns True after NEMOTRON_VAD_SILENCE_MS of quiet.

        Simple RMS thresholding at -60 dB (rms < 0.001).  This is intentionally
        simpler than Silero VAD to avoid the PyTorch + onnxruntime dependency
        weight, and matches how the pipecat bot detects turn boundaries.
        """
        rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))
        chunk_frames = len(chunk) // NEMOTRON_HOP_SAMPLES

        if rms < NEMOTRON_VAD_RMS_THRESHOLD:
            sess.silent_frames += max(chunk_frames, 1)
        else:
            sess.silent_frames = 0
            sess.vad_triggered = False

        if sess.silent_frames >= NEMOTRON_VAD_SILENCE_FRAMES and not sess.vad_triggered:
            sess.vad_triggered = True
            return True

        return False
