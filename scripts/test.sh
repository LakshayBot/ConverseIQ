#!/bin/bash
set -e

echo "================================================"
echo " CallPilot AI - Test Runner"
echo "================================================"

FAILED=0

# .NET tests
echo ""
echo "--- Running .NET Tests ---"
dotnet test src/CallPilot.slnx --configuration Release --verbosity minimal || FAILED=1

# Python tests
echo ""
echo "--- Running Python Tests ---"
cd src/callpilot-ai-engine
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi
python -m pytest tests/ -v || FAILED=1
cd ../..

# Dashboard build check
echo ""
echo "--- Building Dashboard ---"
cd src/callpilot-dashboard
npm run build --silent || FAILED=1
cd ../..

echo ""
if [ $FAILED -eq 0 ]; then
    echo "================================================"
    echo " All Tests Passed!"
    echo "================================================"
else
    echo "================================================"
    echo " Some Tests Failed!"
    echo "================================================"
    exit 1
fi
