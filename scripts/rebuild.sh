#!/bin/bash
set -e

echo "================================================"
echo " CallPilot AI - Rebuild & Deploy"
echo "================================================"

echo ""
echo "[1/3] Stopping existing containers..."
docker compose down --remove-orphans 2>/dev/null || true

echo ""
echo "[2/3] Building fresh images..."
docker compose build --no-cache

echo ""
echo "[3/3] Starting services..."
docker compose up -d

echo ""
echo "Waiting for services to be healthy..."
sleep 5

# Check each service
HEALTHY=0
for i in {1..12}; do
    if curl -sf http://localhost:5001/health > /dev/null 2>&1; then
        echo "  ✓ Server healthy"
        HEALTHY=$((HEALTHY + 1))
        break
    fi
    sleep 5
done

for i in {1..12}; do
    if curl -sf http://localhost:8001/health > /dev/null 2>&1; then
        echo "  ✓ AI Engine healthy"
        HEALTHY=$((HEALTHY + 1))
        break
    fi
    sleep 5
done

if curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null | grep -q 200; then
    echo "  ✓ Dashboard healthy"
    HEALTHY=$((HEALTHY + 1))
fi

echo ""
echo "================================================"
if [ $HEALTHY -eq 3 ]; then
    echo " All services running"
else
    echo " $HEALTHY/3 services healthy - check docker compose ps"
fi
echo ""
echo " Dashboard: http://localhost:3000"
echo " Server:    http://localhost:5001"
echo " AI Engine: http://localhost:8001"
echo "================================================"
