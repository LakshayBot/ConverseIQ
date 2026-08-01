#!/usr/bin/env python3
"""Benchmark transcription accuracy by streaming audio to AI Engine and comparing against ground truth."""

import subprocess
import sys
import time
import json
import re
import os
from difflib import SequenceMatcher

import requests

AI_ENGINE_URL = "http://localhost:8001"
MP3_PATH = os.path.join(os.path.dirname(__file__), "Video_transcription_audio.mp3")
TRUTH_PATH = os.path.join(os.path.dirname(__file__), "Video_transcription_Pitch")
MEETING_ID = "benchmark-sales-pitch"
CHUNK_MS = 500  # 500ms chunks to match _min_new_samples - minimizes HTTP overhead
SAMPLE_RATE = 16000

def load_ground_truth():
    with open(TRUTH_PATH, 'r') as f:
        text = f.read().strip()
    # Remove SRT timestamp artifact: "00:03:37.300,00:00:00.000"
    text = re.sub(r'\d{2}:\d{2}:\d{2}\.\d{3},\d{2}:\d{2}:\d{2}\.\d{3}', '', text)
    # Normalize whitespace and strip speaker labels
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def extract_audio_raw():
    """Convert MP3 to raw 16kHz mono s16le PCM via ffmpeg."""
    result = subprocess.run(
        ["ffmpeg", "-i", MP3_PATH, "-f", "s16le", "-acodec", "pcm_s16le",
         "-ar", str(SAMPLE_RATE), "-ac", "1", "-"],
        capture_output=True
    )
    if result.returncode != 0:
        print(f"ffmpeg error: {result.stderr.decode()}")
        sys.exit(1)
    return result.stdout

def stream_and_collect(raw_audio: bytes):
    """Stream audio in chunks and collect transcripts."""
    chunk_bytes = int(SAMPLE_RATE * (CHUNK_MS / 1000) * 2)  # 16-bit = 2 bytes per sample
    total_chunks = len(raw_audio) // chunk_bytes
    transcripts = []
    total_start = time.time()

    print(f"Streaming {len(raw_audio)/SAMPLE_RATE:.1f}s of audio in {total_chunks} × {CHUNK_MS}ms chunks...")
    print(f"AI Engine: {AI_ENGINE_URL}")
    print("-" * 60)

    for seq in range(total_chunks):
        start = seq * chunk_bytes
        end = start + chunk_bytes
        chunk = raw_audio[start:end]

        try:
            resp = requests.post(
                f"{AI_ENGINE_URL}/api/v1/ai/transcribe",
                params={
                    "meeting_id": MEETING_ID,
                    "sequence": seq,
                    "sample_rate": SAMPLE_RATE,
                    "channels": 1,
                    "source": "desktop",
                },
                data=chunk,
                timeout=30,
            )
            if resp.status_code == 200:
                result = resp.json()
                if result.get("transcript"):
                    t = result["transcript"]
                    transcripts.append({
                        "seq": seq,
                        "text": t["text"],
                        "confidence": t["confidence"],
                        "speaker": t["speaker"],
                        "timestamp_s": time.time() - total_start,
                    })
                    print(f"  [{seq:5d}] {t['speaker']}: {t['text']}")
            else:
                pass
        except requests.exceptions.ConnectionError:
            print(f"\nERROR: Cannot connect to AI Engine at {AI_ENGINE_URL}")
            print("Make sure 'docker compose up -d' is running")
            sys.exit(1)

        # Progress every 50 chunks
        if seq % 50 == 0 and seq > 0:
            elapsed = time.time() - total_start
            pct = (seq / total_chunks) * 100
            eta = elapsed / seq * (total_chunks - seq)
            print(f"  --- Progress: {pct:.0f}% ({seq}/{total_chunks}), ETA: {eta:.0f}s, {len(transcripts)} transcripts so far ---")

    elapsed = time.time() - total_start
    print("-" * 60)
    print(f"Done in {elapsed:.1f}s ({len(raw_audio)/SAMPLE_RATE/elapsed:.1f}x real-time)")
    return transcripts

def normalize(text: str) -> str:
    """Lowercase, remove punctuation, normalize whitespace."""
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def word_error_rate(reference: str, hypothesis: str) -> dict:
    """Simple WER-like comparison."""
    ref_words = reference.split()
    hyp_words = hypothesis.split()

    matcher = SequenceMatcher(None, ref_words, hyp_words)
    matches = sum(block.size for block in matcher.get_matching_blocks())

    # Count substitutions, deletions, insertions
    ops = matcher.get_opcodes()
    substitutions = deletions = insertions = 0
    for tag, i1, i2, j1, j2 in ops:
        if tag == 'replace':
            substitutions += max(i2 - i1, j2 - j1)
        elif tag == 'delete':
            deletions += i2 - i1
        elif tag == 'insert':
            insertions += j2 - j1

    total_errors = substitutions + deletions + insertions
    wer = (total_errors / len(ref_words) * 100) if ref_words else 0
    accuracy = 100 - wer

    return {
        "ref_words": len(ref_words),
        "hyp_words": len(hyp_words),
        "matches": matches,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "total_errors": total_errors,
        "WER": round(wer, 2),
        "accuracy": round(accuracy, 2),
    }

def main():
    print("=" * 60)
    print("CallPilot Transcription Benchmark")
    print("=" * 60)

    # Reset meeting state
    try:
        requests.post(f"{AI_ENGINE_URL}/api/v1/meetings/{MEETING_ID}/reset", timeout=5)
        print("Meeting state reset.")
    except:
        pass

    # Load ground truth
    truth = load_ground_truth()
    print(f"Ground truth: {len(truth.split())} words, {len(truth)} chars")
    print()

    # Extract and stream audio
    raw = extract_audio_raw()
    transcripts = stream_and_collect(raw)

    if not transcripts:
        print("\n❌ No transcripts received! Check AI Engine logs.")
        sys.exit(1)

    # Build full transcription
    all_text = " ".join(t["text"] for t in transcripts if t["text"])

    # Compare
    norm_truth = normalize(truth)
    norm_hyp = normalize(all_text)

    results = word_error_rate(norm_truth, norm_hyp)

    print()
    print("=" * 60)
    print("BENCHMARK RESULTS")
    print("=" * 60)
    print(f"Transcripts received:  {len(transcripts)}")
    print(f"Avg confidence:        {sum(t['confidence'] for t in transcripts)/len(transcripts):.2f}")
    print(f"Ground truth words:    {results['ref_words']}")
    print(f"Transcribed words:     {results['hyp_words']}")
    print(f"Matched words:         {results['matches']}")
    print(f"Substitutions:         {results['substitutions']}")
    print(f"Deletions (missed):    {results['deletions']}")
    print(f"Insertions (extra):    {results['insertions']}")
    print(f"Total errors:          {results['total_errors']}")
    print(f"Word Error Rate:       {results['WER']}%")
    print(f"Accuracy:              {results['accuracy']}%")
    print()

    # Show side-by-side sample
    print("--- Ground truth (first 300 chars) ---")
    print(truth[:300])
    print()
    print("--- Transcribed (first 300 chars) ---")
    print(all_text[:300])

    # Save for comparison
    out = {
        "truth": truth,
        "transcribed": all_text,
        "metrics": results,
        "transcript_count": len(transcripts),
        "avg_confidence": sum(t['confidence'] for t in transcripts)/len(transcripts) if transcripts else 0,
    }
    out_path = os.path.join(os.path.dirname(__file__), "benchmark_results.json")
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
    print(f"\nFull results saved to {out_path}")

if __name__ == "__main__":
    main()
