#!/bin/bash
set -e

echo "================================================"
echo " CallPilot AI - Development Setup"
echo "================================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

command -v dotnet >/dev/null 2>&1 || { echo "ERROR: .NET SDK is required. Install from https://dotnet.microsoft.com"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: Python 3 is required."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "WARNING: Docker not found. Infrastructure services will need to be started manually."; }

echo "  .NET: $(dotnet --version)"
echo "  Node:  $(node --version)"
echo "  Python: $(python3 --version)"
echo ""

# Start infrastructure
if command -v docker >/dev/null 2>&1; then
    echo "Starting PostgreSQL..."
    docker compose up -d postgres
    echo "Waiting for PostgreSQL to be ready..."
    sleep 5
fi

# Restore .NET
echo ""
echo "Restoring .NET dependencies..."
dotnet restore src/CallPilot.slnx

# Setup Python AI Engine
echo ""
echo "Setting up Python AI Engine..."
cd src/callpilot-ai-engine
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -e ".[dev]" --quiet
cd ../..

# Install Dashboard dependencies
echo ""
echo "Installing Dashboard dependencies..."
cd src/callpilot-dashboard
npm install --silent
cd ../..

# Apply database migrations
echo ""
echo "Applying database migrations..."
dotnet ef database update \
    --project src/CallPilot.Server/CallPilot.Server.Infrastructure/CallPilot.Server.Infrastructure.csproj \
    --startup-project src/CallPilot.Server/CallPilot.Server.Api/CallPilot.Server.Api.csproj

echo ""
echo "================================================"
echo " Setup Complete!"
echo "================================================"
echo ""
echo "To start development:"
echo "  ./scripts/dev.sh"
echo ""
echo "Or start services individually:"
echo "  Terminal 1: dotnet run --project src/CallPilot.Server/CallPilot.Server.Api"
echo "  Terminal 2: cd src/callpilot-ai-engine && source .venv/bin/activate && uvicorn engine.main:app --reload --port 8001"
echo "  Terminal 3: cd src/callpilot-dashboard && npm run dev"
echo ""
