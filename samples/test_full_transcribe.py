#!/usr/bin/env python3
"""Full-file transcription comparison: tiny vs small.en"""
import sys, subprocess, os, tempfile, time
import numpy as np
from faster_whisper import WhisperModel

AUDIO_FILE = sys.argv[1] if len(sys.argv) > 1 else "./samples/audio_files_samples/transcribing_2.mp3"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "small.en"
SAMPLE_RATE = 16000

print(f"=== {MODEL} - FULL TRANSCRIPTION ===")
print(f"File: {AUDIO_FILE}")

with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as f:
    RAW = f.name
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", AUDIO_FILE,
    "-f", "s16le", "-acodec", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", RAW], check=True)

print(f"Loading {MODEL}...")
model = WhisperModel(MODEL, device="cpu", compute_type="int8")

with open(RAW, "rb") as f:
    raw_bytes = f.read()
os.unlink(RAW)

samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
print(f"Audio: {len(samples)/SAMPLE_RATE:.1f}s starting transcription...")

start = time.time()
segments, info = model.transcribe(samples, beam_size=5, language="en",
    vad_filter=False, condition_on_previous_text=False, best_of=5)
transcript = []
for seg in segments:
    transcript.append(seg.text.strip())
elapsed = time.time() - start

print(f"\n--- Transcript ({elapsed:.1f}s) ---")
print("\n".join(transcript))
print(f"\nSegments: {len(transcript)}")
