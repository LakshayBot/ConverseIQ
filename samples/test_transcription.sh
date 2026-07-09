#!/bin/bash
set -euo pipefail

AUDIO="$1"
MEETING_ID="test-$(uuidgen | cut -c1-8)"
CHUNK_MS=400  # milliseconds

echo "=== TRANSCRIPTION TEST ==="
echo "Audio:   $AUDIO"
echo "Meeting: $MEETING_ID"
echo "AI Engine config: $(curl -s http://localhost:8001/health | jq -r '.config.model_size')"
echo ""

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "[1/3] Converting to raw PCM 16kHz mono..."
ffmpeg -v error -i "$AUDIO" -f s16le -acodec pcm_s16le -ar 16000 -ac 1 "$TMPDIR/audio.raw"

TOTAL_BYTES=$(wc -c < "$TMPDIR/audio.raw" | tr -d ' ')
# 16000 Hz * 2 bytes/sample * (CHUNK_MS/1000) seconds = 32 bytes per ms * CHUNK_MS
CHUNK_BYTES=$(( 32 * CHUNK_MS ))
TOTAL_DURATION=$(echo "scale=2; $TOTAL_BYTES / 32000" | bc)

echo "[2/3] Audio: ${TOTAL_DURATION}s, splitting into ${CHUNK_MS}ms chunks (${CHUNK_BYTES} bytes)..."
split -b $CHUNK_BYTES "$TMPDIR/audio.raw" "$TMPDIR/chunk_"
CHUNK_COUNT=$(ls "$TMPDIR"/chunk_* | wc -l | tr -d ' ')
echo "       $CHUNK_COUNT chunks"

echo "[3/3] Sending chunks to AI Engine..."
TRANSCRIPTS=()
SEQ=0
for chunk in "$TMPDIR"/chunk_*; do
    RESULT=$(curl -s -X POST "http://localhost:8001/api/v1/ai/transcribe?meeting_id=$MEETING_ID&sequence=$SEQ&sample_rate=16000&channels=1&source=microphone" \
        --data-binary "@$chunk" \
        -H "Content-Type: application/octet-stream" 2>/dev/null)
    TEXT=$(echo "$RESULT" | jq -r '.transcript.text // empty')
    if [ -n "$TEXT" ]; then
        CONF=$(echo "$RESULT" | jq -r '.transcript.confidence // "0"')
        printf "[seq=%04d] [conf=%.2f] %s\n" "$SEQ" "$CONF" "$TEXT"
        TRANSCRIPTS+=("$TEXT")
    fi
    SEQ=$((SEQ + 1))
    sleep 0.05
done

echo ""
echo "=== SUMMARY ==="
echo "Total chunks sent: $CHUNK_COUNT"
echo "Transcripts generated: ${#TRANSCRIPTS[@]}"
echo ""
echo "=== FULL TRANSCRIPT ==="
for t in "${TRANSCRIPTS[@]}"; do
    echo "$t"
done
echo ""
echo "======================="
