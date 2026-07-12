"""Configuration for the Nemotron Speech Streaming experimental pipeline."""

import os
import logging
from dataclasses import dataclass, field
from typing import List

logger = logging.getLogger(__name__)

# ── Feature flags ──────────────────────────────────────────────────────────
NEMOTRON_ENABLED = os.getenv("NEMOTRON_ENABLED", "true").lower() == "true"

# ── Model identity ─────────────────────────────────────────────────────────
NEMOTRON_MODEL_NAME = os.getenv(
    "NEMOTRON_MODEL_NAME",
    "nvidia/nemotron-speech-streaming-en-0.6b",
)

# ── Streaming parameters ───────────────────────────────────────────────────
# right_context → model attention context size [left, right]
#   0  =  80ms chunk  (no right context — fastest, least accurate)
#   1  = 160ms chunk  (default — balanced latency/accuracy)
#   6  = 560ms chunk  (higher accuracy, more latency)
#  13  = 1120ms chunk (batch-quality accuracy, highest latency)
NEMOTRON_RIGHT_CONTEXT = int(os.getenv("NEMOTRON_RIGHT_CONTEXT", "1"))

RIGHT_CONTEXT_MAP: dict[int, list[int]] = {
    0: [70, 0],
    1: [70, 1],
    6: [70, 6],
    13: [70, 13],
}

# ── Device ─────────────────────────────────────────────────────────────────
NEMOTRON_DEVICE = os.getenv("NEMOTRON_DEVICE", "cpu")

# ── Chunk timing (model operates on 10ms mel frames) ───────────────────────
NEMOTRON_CHUNK_MS = int(os.getenv("NEMOTRON_CHUNK_MS", "160"))   # ms per inference step
NEMOTRON_HOP_SAMPLES = 160                                        # 10ms at 16kHz
NEMOTRON_SUBSAMPLING = 4                                          # Conformer subsampling factor
NEMOTRON_PRE_ENCODE_CACHE_MS = 90                                 # overlap for chunk boundary continuity
NEMOTRON_PRE_ENCODE_CACHE_FRAMES = NEMOTRON_PRE_ENCODE_CACHE_MS // 10

# ── VAD (energy-based silence detection) ───────────────────────────────────
NEMOTRON_VAD_SILENCE_MS = int(os.getenv("NEMOTRON_VAD_SILENCE_MS", "200"))
NEMOTRON_VAD_SILENCE_FRAMES = NEMOTRON_VAD_SILENCE_MS // 10       # frames at 10ms each
NEMOTRON_VAD_RMS_THRESHOLD = float(os.getenv("NEMOTRON_VAD_RMS_THRESHOLD", "0.001"))  # -60 dB

# ── Derived — do not edit ──────────────────────────────────────────────────
NEMOTRON_SAMPLE_RATE = 16000
SHIFT_FRAMES = NEMOTRON_CHUNK_MS // 10                             # frames per inference step (default 16)
FINAL_PADDING_FRAMES = (NEMOTRON_RIGHT_CONTEXT + 1) * SHIFT_FRAMES
ATT_CONTEXT_SIZE = RIGHT_CONTEXT_MAP.get(NEMOTRON_RIGHT_CONTEXT, [70, 1])


@dataclass
class NemotronConfig:
    """Immutable snapshot of the Nemotron configuration (used at startup)."""
    enabled: bool = NEMOTRON_ENABLED
    model_name: str = NEMOTRON_MODEL_NAME
    right_context: int = NEMOTRON_RIGHT_CONTEXT
    att_context_size: List[int] = field(default_factory=lambda: list(ATT_CONTEXT_SIZE))
    device: str = NEMOTRON_DEVICE
    chunk_ms: int = NEMOTRON_CHUNK_MS
    shift_frames: int = SHIFT_FRAMES
    hop_samples: int = NEMOTRON_HOP_SAMPLES
    pre_encode_cache_size: int = NEMOTRON_PRE_ENCODE_CACHE_FRAMES
    vad_silence_frames: int = NEMOTRON_VAD_SILENCE_FRAMES
    vad_rms_threshold: float = NEMOTRON_VAD_RMS_THRESHOLD
    final_padding_frames: int = FINAL_PADDING_FRAMES
    sample_rate: int = 16000
