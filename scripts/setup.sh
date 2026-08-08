#!/bin/bash
set -e

# CallPilot AI - Development Setup (smart bootstrap)
#
# Detects the current environment state:
#   • Nothing set up (no network, no containers, no images) → creates the
#     compose network, volumes, builds the application images, starts all
#     services, applies DB migrations, installs local dev dependencies.
#   • Already running → starts only the missing pieces and skips what's
#     already up. Safe to re-run any time.
#
# Usage:
#   ./scripts/setup.sh                  # full bootstrap
#   ./scripts/setup.sh --skip-deps      # infra only (skip npm/pip/dotnet restore)
#   ./scripts/setup.sh --with-ollama    # also start the optional ollama profile
#   ./scripts/setup.sh -h               # help

# ──────────────────────────────────────────────────────────────────────────────
# Options
# ──────────────────────────────────────────────────────────────────────────────

WITH_OLLAMA=0
SKIP_DEPS=0
for arg in "$@"; do
  case "$arg" in
    --with-ollama) WITH_OLLAMA=1 ;;
    --skip-deps)   SKIP_DEPS=1 ;;
    -h|--help)
      echo "Usage: ./scripts/setup.sh [--with-ollama] [--skip-deps]"
      exit 0
      ;;
  esac
done

say()  { printf "\033[1;36m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }
err()  { printf "  \033[1;31m✗\033[0m %s\n" "$*"; }

# Run from anywhere: resolve the repo root from this script's location and
# cd into it, so relative paths (.env, docker-compose.yml, src/...) work
# whether the script is invoked from the repo root or from scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

# ──────────────────────────────────────────────────────────────────────────────
# Bootstrap: .env + prerequisites
# ──────────────────────────────────────────────────────────────────────────────

echo "================================================"
echo " CallPilot AI - Development Setup"
echo "================================================"
echo ""

# Create .env from the example on a fresh clone - everything else reads it.
if [ ! -f .env ]; then
  say "→ .env not found - creating from .env.example"
  cp .env.example .env
  ok "Created .env (edit secrets before any non-local use)"
fi

echo "Checking prerequisites..."
command -v dotnet >/dev/null 2>&1 || { err ".NET SDK is required. Install from https://dotnet.microsoft.com"; exit 1; }
command -v node >/dev/null 2>&1 || { err "Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v python3 >/dev/null 2>&1 || { err "Python 3 is required."; exit 1; }

echo "  .NET: $(dotnet --version)"
echo "  Node:  $(node --version)"
echo "  Python: $(python3 --version)"
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Docker: detect state, then create network/volumes/images/containers as needed
# ──────────────────────────────────────────────────────────────────────────────

DOCKER_OK=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER_OK=1
fi

if [ "$DOCKER_OK" -eq 1 ]; then
  RUNNING=$(docker compose ps -q 2>/dev/null | wc -l | tr -d ' ')
  NETWORK_NAME="$(basename "$(pwd)")_default"
  NET_EXISTS=$(docker network ls -q -f "name=${NETWORK_NAME}" 2>/dev/null | head -1 | wc -l | tr -d ' ')
  SERVER_IMG=$(docker image inspect voicepilotai-server >/dev/null 2>&1 && echo yes || echo no)

  echo "Detected environment state:"
  echo "  containers running: $RUNNING"
  echo "  compose network:    $([ "$NET_EXISTS" = "1" ] && echo present || echo missing)"
  echo "  server image:       $SERVER_IMG"
  echo ""

  if [ "$RUNNING" = "0" ] && [ "$NET_EXISTS" = "0" ] && [ "$SERVER_IMG" = "no" ]; then
    say "Fresh environment - creating network, volumes and images from scratch"
    echo ""
    echo "[1/4] Starting infrastructure (PostgreSQL + Redis)..."
    docker compose up -d postgres redis
    ok "PostgreSQL + Redis started"

    echo ""
    echo "[2/4] Building application images (first build can take a while)..."
    docker compose build server ai-engine dashboard
    ok "Images built"

    echo ""
    echo "[3/4] Starting application services..."
    docker compose up -d server ai-engine dashboard
    ok "server + ai-engine + dashboard started"
  else
    say "Existing environment detected - starting only what is missing"
    echo ""
    echo "[1/3] Ensuring infrastructure is up (PostgreSQL + Redis)..."
    docker compose up -d postgres redis
    ok "Infrastructure ensured"

    if [ "$SERVER_IMG" = "no" ]; then
      echo ""
      echo "[2/3] Application images missing - building..."
      docker compose build server ai-engine dashboard
      ok "Images built"
    else
      echo "[2/3] Application images already present - skipping build"
    fi

    echo ""
    echo "[3/3] Ensuring application services are up..."
    docker compose up -d server ai-engine dashboard
    ok "Services ensured"
  fi

  if [ "$WITH_OLLAMA" = "1" ]; then
    docker compose --profile ollama up -d ollama
    ok "Ollama started (optional profile)"
  fi

  # Wait for PostgreSQL to accept connections (migrations need it)
  echo ""
  echo "Waiting for PostgreSQL to accept connections..."
  PG_READY=0
  for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-callpilot}" >/dev/null 2>&1; then
      ok "PostgreSQL ready"
      PG_READY=1
      break
    fi
    sleep 2
  done
  if [ "$PG_READY" = "0" ]; then
    warn "PostgreSQL did not become ready - check 'docker compose ps'"
  fi
else
  warn "Docker not available - infrastructure services must be started manually."
  PG_READY=0
fi

# ──────────────────────────────────────────────────────────────────────────────
# Local development dependencies (skip with --skip-deps)
# ──────────────────────────────────────────────────────────────────────────────

if [ "$SKIP_DEPS" = "0" ]; then
  echo ""
  echo "Restoring .NET dependencies..."
  dotnet restore src/CallPilot.slnx >/dev/null && ok ".NET restored"

  echo ""
  echo "Setting up Python AI Engine..."
  if [ ! -d src/callpilot-ai-engine/.venv ]; then
    python3 -m venv src/callpilot-ai-engine/.venv
  fi
  # shellcheck disable=SC1091
  source src/callpilot-ai-engine/.venv/bin/activate
  pip install -e ".[dev]" --quiet
  deactivate
  ok "Python AI Engine ready"

  echo ""
  echo "Installing Dashboard dependencies..."
  (cd src/callpilot-dashboard && npm install --silent)
  ok "Dashboard dependencies installed"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Database migrations (idempotent - only pending ones are applied)
# ──────────────────────────────────────────────────────────────────────────────

if [ "$PG_READY" = "1" ]; then
  echo ""
  echo "Applying database migrations..."
  dotnet ef database update \
    --project src/CallPilot.Server/CallPilot.Server.Infrastructure/CallPilot.Server.Infrastructure.csproj \
    --startup-project src/CallPilot.Server/CallPilot.Server.Api/CallPilot.Server.Api.csproj \
    >/dev/null && ok "Migrations up to date"
else
  warn "Skipping migrations - PostgreSQL is not reachable"
fi

echo ""
echo "================================================"
echo " Setup Complete!"
echo "================================================"
echo ""
echo " Services:"
echo "  Dashboard: http://localhost:3000"
echo "  Server:    http://localhost:5001"
echo "  AI Engine: http://localhost:8001"
echo "  Postgres:  localhost:5432"
if [ "$WITH_OLLAMA" = "1" ]; then
  echo "  Ollama:    localhost:11434"
fi
echo ""
echo " To run the stack in dev mode (hot reload):"
echo "   ./scripts/dev.sh"
echo ""
echo " To rebuild only the services you changed:"
echo "   ./scripts/rebuild.sh"
echo "================================================"
