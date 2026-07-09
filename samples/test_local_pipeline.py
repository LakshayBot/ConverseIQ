#!/usr/bin/env python3
"""
Direct transcription comparison: tiny vs small.en
Tests the EXACT same pipeline as the AI Engine but locally.
"""
import sys
import subprocess
import os
import tempfile
import numpy as np
import time

AUDIO_FILE = sys.argv[1] if len(sys.argv) > 1 else "./samples/audio_files_samples/transcribing_2.mp3"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "small.en"

CHUNK_MS = 400  # match desktop agent chunk size
SAMPLE_RATE = 16000

print(f"=== LOCAL TRANSCRIPTION TEST: {MODEL} ===")
print(f"File: {AUDIO_FILE}")

# Convert to raw PCM
with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as f:
    RAW = f.name
subprocess.run(
    ["ffmpeg", "-y", "-v", "error", "-i", AUDIO_FILE,
     "-f", "s16le", "-acodec", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", RAW],
    check=True,
)

# Load model
from faster_whisper import WhisperModel
print(f"Loading {MODEL}...")
model = WhisperModel(MODEL, device="cpu", compute_type="int8")

# Read raw audio
with open(RAW, "rb") as f:
    raw_bytes = f.read()
os.unlink(RAW)

samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
total_dur = len(samples) / SAMPLE_RATE
print(f"Audio: {total_dur:.1f}s, {len(samples)} samples")

# Split into chunks like the real pipeline
chunk_samples = int(SAMPLE_RATE * CHUNK_MS / 1000)  # 6400 samples = 400ms
chunks = [samples[i:i+chunk_samples] for i in range(0, len(samples), chunk_samples)]

# Simulate the accumulation-based pipeline (matching speech_recognizer.py)
accumulated = np.array([], dtype=np.float32)
overlap_samples = int(SAMPLE_RATE * 2)  # keep 2s overlap

start = time.time()
transcripts = []

for i, chunk in enumerate(chunks):
    if len(chunk) == 0:
        continue
    accumulated = np.concatenate([accumulated, chunk]) if len(accumulated) > 0 else chunk.copy()

    dur = len(accumulated) / SAMPLE_RATE
    if dur < 0.5:
        continue

    try:
        segments, info = model.transcribe(
            accumulated,
            beam_size=5,
            language="en",
            vad_filter=False,
            condition_on_previous_text=False,
            no_speech_threshold=0.9,
            best_of=5,
        )
        seg_list = list(segments)
        if seg_list:
            last = seg_list[-1]
            if last.no_speech_prob < 0.95 and last.text.strip():
                transcripts.append(last.text.strip())
                print(f"  [{i:04d}] {last.text.strip()}")
            # Clear buffer, keep overlap
            overlap = min(overlap_samples, len(accumulated))
            accumulated = accumulated[-overlap:]
    except Exception as e:
        print(f"  [{i:04d}] ERROR: {e}")
        accumulated = np.array([], dtype=np.float32)

elapsed = time.time() - start
print(f"\nTotal time: {elapsed:.1f}s ({total_dur/elapsed:.1f}x realtime)")
print(f"Transcripts: {len(transcripts)} in {len(chunks)} chunks")
print(f"\n=== FULL TRANSCRIPT ===")
print(" ".join(transcripts))
