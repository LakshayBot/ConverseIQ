#!/bin/bash
echo "Building AI engine with small.en model..."
cd /Users/lakshaymalhotra/Desktop/Github_Projects/VoicePilotAI
docker compose build ai-engine --no-cache &
BUILD_PID=$!
echo "Build PID: $BUILD_PID (running in background)"
