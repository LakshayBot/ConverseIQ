#!/bin/bash
set -e

# CallPilot AI - interactive rebuild & deploy.
#
# Asks which service(s) to rebuild instead of always doing a full
# --no-cache rebuild of everything. Picking just the services you
# changed (e.g. server + ai-engine) saves a lot of time.
#
# Usage:
#   ./scripts/rebuild.sh            # interactive prompt
#   ./scripts/rebuild.sh server     # rebuild one or more named services
#   ./scripts/rebuild.sh --all      # full rebuild, no prompt
#   ./scripts/rebuild.sh -y server ai-engine   # non-interactive, multi-service
#
# Prebuilt-image services (postgres, redis, ollama) are never rebuilt -
# they are pulled once and reused (see pull_policy: missing in
# docker-compose.yml).

# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────

# Services that carry application code worth rebuilding (excludes infra
# like postgres/redis and the ollama image - those are prebuilt images,
# pulled once and reused; see pull_policy: missing in docker-compose.yml).
BUILDABLE=("ai-engine" "server" "dashboard")

# Human-friendly labels shown in the picker
label_for() {
  case "$1" in
    ai-engine) echo "AI Engine (Python - Nemotron STT, Groq enrichment)" ;;
    server)    echo ".NET Server (API, SignalR, knowledge ingest)" ;;
    dashboard) echo "Dashboard (Next.js web UI)" ;;
    *)         echo "$1" ;;
  esac
}

# Health-check endpoint per service (empty = no check)
health_url_for() {
  case "$1" in
    server)    echo "http://localhost:5001/health" ;;
    ai-engine) echo "http://localhost:8001/health" ;;
    dashboard) echo "http://localhost:3000" ;;
    *)         echo "" ;;
  esac
}

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

say()  { printf "\033[1;36m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }
err()  { printf "  \033[1;31m✗\033[0m %s\n" "$*"; }

# Run from anywhere: resolve the repo root from this script's location so
# docker-compose.yml is found whether invoked from the root or scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

validate_services() {
  local invalid=()
  for svc in "$@"; do
    if ! printf '%s\n' "${BUILDABLE[@]}" | grep -qx "$svc"; then
      invalid+=("$svc")
    fi
  done
  if [ ${#invalid[@]} -gt 0 ]; then
    err "Unknown service(s): ${invalid[*]}"
    echo "  Valid services: ${BUILDABLE[*]}"
    exit 1
  fi
}

# Interactive multi-select: toggles with space, enter to confirm.
pick_services() {
  local selected=()
  local i idx key

  echo ""
  say "Select service(s) to rebuild (press space to toggle, enter to confirm):"
  echo ""
  for i in "${!BUILDABLE[@]}"; do
    printf "  [ ] %s  —  %s\n" "$((i + 1))" "$(label_for "${BUILDABLE[$i]}")"
  done
  echo ""
  printf "  Enter 'a' for ALL, or numbers like '1 2': "

  IFS= read -r -e answer
  local trimmed
  trimmed=$(echo "$answer" | tr -s ' ' | sed 's/^ //;s/ $//')
  case "$trimmed" in
    a|A|all|ALL)
      selected=("${BUILDABLE[@]}")
      ;;
    *)
      if [ -z "$trimmed" ]; then
        err "Nothing selected - aborting."
        exit 1
      fi
      for token in $trimmed; do
        case "$token" in
          *[!0-9]*)
            # Bare service name (e.g. "server") also accepted
            validate_services "$token"
            selected+=("$token")
            ;;
          *)
            idx=$((token - 1))
            if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#BUILDABLE[@]}" ]; then
              selected+=("${BUILDABLE[$idx]}")
            else
              err "Invalid number: $token"
              exit 1
            fi
            ;;
        esac
      done
      # De-duplicate while keeping order
      selected=($(printf '%s\n' "${selected[@]}" | awk '!seen[$0]++'))
      ;;
  esac
  echo ""
  echo "  Selected: ${selected[*]}"
  echo ""
  read -r -p "  Proceed? [Y/n] " confirm
  case "$confirm" in
    n|N|no) echo "  Aborted."; exit 0 ;;
  esac
  SERVICES=("${selected[@]}")
}

# ──────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────────────────────────────────────

SERVICES=()
SKIP_CONFIRM=0

while [ $# -gt 0 ]; do
  case "$1" in
    --all|-a)
      SERVICES=("${BUILDABLE[@]}")
      ;;
    -y)
      SKIP_CONFIRM=1
      ;;
    --)
      shift
      SERVICES+=("$@")
      break
      ;;
    *)
      SERVICES+=("$1")
      ;;
  esac
  shift
done

if [ ${#SERVICES[@]} -gt 0 ]; then
  validate_services "${SERVICES[@]}"
  SERVICES=($(printf '%s\n' "${SERVICES[@]}" | awk '!seen[$0]++'))
else
  pick_services
fi

FULL_REBUILD=0
if [ "${#SERVICES[@]}" -eq "${#BUILDABLE[@]}" ]; then
  FULL_REBUILD=1
fi

# ──────────────────────────────────────────────────────────────────────────────
# Rebuild & deploy
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "================================================"
echo " CallPilot AI - Rebuild & Deploy"
echo "================================================"
if [ "$FULL_REBUILD" -eq 1 ]; then
  echo " Target: ALL services (full --no-cache rebuild)"
else
  echo " Target: ${SERVICES[*]}"
fi
echo "================================================"

echo ""
echo "[1/3] Stopping containers that will be rebuilt..."
for svc in "${SERVICES[@]}"; do
  if docker compose ps -q "$svc" 2>/dev/null | grep -q .; then
    docker compose rm -sf "$svc" 2>/dev/null || true
    ok "Stopped + removed $svc"
  else
    ok "$svc not running - nothing to stop"
  fi
done

echo ""
echo "[2/3] Building images..."
if [ "$FULL_REBUILD" -eq 1 ]; then
  docker compose build --no-cache
else
  docker compose build "${SERVICES[@]}"
fi

echo ""
echo "[3/3] Starting services..."
docker compose up -d "${SERVICES[@]}"

# ──────────────────────────────────────────────────────────────────────────────
# Disk hygiene - every rebuild leaves the previous image layers behind as
# dangling images + build cache. Prune them so space doesn't grow unbounded.
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[cleanup] Pruning leftover images/cache..."
docker image prune -f > /dev/null 2>&1 && ok "Dangling images pruned"

if [ "$SKIP_CONFIRM" -eq 0 ]; then
  read -r -p "  Also prune the Docker build cache (frees more space, but the next build re-downloads base layers)? [y/N] " prune_cache
  case "$prune_cache" in
    y|Y|yes)
      docker builder prune -f > /dev/null 2>&1 && ok "Build cache pruned"
      ;;
  esac
else
  # Non-interactive (-y): only prune the build cache on a full rebuild,
  # where the whole image stack is being rebuilt anyway.
  if [ "$FULL_REBUILD" -eq 1 ]; then
    docker builder prune -f > /dev/null 2>&1 && ok "Build cache pruned"
  fi
fi

echo ""
echo "Waiting for services to be healthy..."
sleep 5

HEALTHY=0
for svc in "${SERVICES[@]}"; do
  url="$(health_url_for "$svc")"
  if [ -z "$url" ]; then
    ok "$svc started (no health endpoint)"
    HEALTHY=$((HEALTHY + 1))
    continue
  fi
  for i in {1..12}; do
    if curl -sf "$url" > /dev/null 2>&1; then
      ok "$svc healthy"
      HEALTHY=$((HEALTHY + 1))
      break
    fi
    sleep 5
  done
  if ! curl -sf "$url" > /dev/null 2>&1; then
    err "$svc not healthy yet - check 'docker compose ps'"
  fi
done

echo ""
echo "================================================"
if [ "$HEALTHY" -eq "${#SERVICES[@]}" ]; then
  echo " All rebuilt services running"
else
  echo " $HEALTHY/${#SERVICES[@]} rebuilt services healthy - check docker compose ps"
fi
echo ""
if [ "$FULL_REBUILD" -eq 0 ]; then
  echo " Note: other services are still running from before."
  echo "       Restart them later with: docker compose up -d"
fi
echo ""
echo " Dashboard: http://localhost:3000"
echo " Server:    http://localhost:5001"
echo " AI Engine: http://localhost:8001"
echo "================================================"
