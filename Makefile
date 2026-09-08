.PHONY: test-e2e test-features build-harness

# Baseline regression suite (unchanged behaviour).
test-e2e:
	python3 tests/e2e/run_e2e.py

# Feature suite (contextual matching / action items / debounce timing).
# Starts the e2e stack with docker-compose.test-overrides.yml (2s debounces,
# Nemotron enabled for frame replay), runs the baseline checks, then the
# pytest feature suite. Non-zero exit on any failure.
test-features:
	python3 tests/e2e/run_e2e.py --features

# Build the Rust e2e harness (transcribe/diarize/align/summarize/action-items).
build-harness:
	cd callpilot-desktop/frontend/src-tauri && cargo build -p e2e-harness
