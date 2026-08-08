#!/bin/bash
set -e

# Run from anywhere: resolve the repo root from this script's location so
# docker-compose.yml and src/ paths work whether invoked from the root or
# from scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

echo "================================================"
echo " CallPilot AI - Starting Development Environment"
echo "================================================"

# Ensure PostgreSQL is running
if command -v docker >/dev/null 2>&1; then
    docker compose up -d postgres 2>/dev/null || true
fi

# Start server
echo "Starting CallPilot Server on http://localhost:5001..."
dotnet run --project src/CallPilot.Server/CallPilot.Server.Api &
SERVER_PID=$!

# Start AI Engine
echo "Starting AI Engine on http://localhost:8001..."
cd src/callpilot-ai-engine
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi
uvicorn engine.main:app --host 0.0.0.0 --port 8001 &
AI_PID=$!
cd ../..

# Start Dashboard
echo "Starting Dashboard on http://localhost:3000..."
cd src/callpilot-dashboard
npm run dev &
DASH_PID=$!
cd ../..

echo ""
echo "================================================"
echo " Services Started:"
echo "  Server:    http://localhost:5001"
echo "  AI Engine: http://localhost:8001"
echo "  Dashboard: http://localhost:3000"
echo "================================================"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $SERVER_PID $AI_PID $DASH_PID 2>/dev/null; exit 0" INT TERM

wait
