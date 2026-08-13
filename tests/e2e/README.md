# CallPilot End-to-End Regression Pipeline

Runs the **real** CallPilot processing flow against the sample sales call
(`samples/audio_files_samples/sales-call-secure.mp3`, Secure Meters / Tata
Power, 2 voices, 17 scripted turns) in a **fully isolated** environment and
validates every stage against `baseline.json`.

This is a regression suite, not a mock: audio enters the same decode → VAD →
STT → events → intelligence → diarization → persistence pipeline the app
uses, executed by the real implementations.

## How to run

```bash
# from the repo root
python3 tests/e2e/run_e2e.py                          # parakeet (default)
python3 tests/e2e/run_e2e.py --engine whisper         # whisper-tiny smoke path
python3 tests/e2e/run_e2e.py --with-summary           # + real llama-helper summary (needs GGUF staged)
python3 tests/e2e/run_e2e.py --build                  # rebuild server image first (after server code changes)
python3 tests/e2e/run_e2e.py --keep                   # keep test records + stack for debugging
```

First run downloads the stack images, engine models (GLiNER etc.), the STT
model (~670 MB parakeet / ~75 MB whisper) and diarization models (~44 MB)
into `tests/e2e/models/` — later runs are fast.

## What it validates (stage by stage)

```
[PASS] Isolated e2e stack started      - own postgres :5433 / server :5002 / engine :8002
[PASS] E2E test user authenticated     - dedicated e2e user, never touches real data
[PASS] Knowledge base created          - real KB + fixture doc ingest (fast mode)
[PASS] Fixture document processed      - real extract/embed/GLiNER pipeline
[PASS] Trie synchronized               - real entity -> trie sync
[PASS] Test meeting created
[PASS] Audio loaded and decoded        - real ffmpeg decode -> 16k mono
[PASS] Transcription completed         - real Silero VAD + Parakeet TDT / whisper engine
[PASS] Transcript contains expected content / quality / timestamps / phrases / no garbage
[PASS] Events generated                - real POST /process -> engine event detection
[PASS] Event categories valid          - per-category counts from baseline
[PASS] Expected products detected      - Prodigy, Apex 100, Sprint 210, i-Credit 510, Liberty+
[PASS] Invalid product candidates rejected
[PASS] Intelligence cards generated    - real recommendations, category + content checks
[PASS] Meeting persisted               - real bulk transcript save (idempotent)
[PASS] Speaker diarization completed   - real sherpa-onnx diar-helper (fast tier)
[PASS] Speaker assignments applied     - real production turn-to-segment alignment
[PASS] Speakers persisted / count / coverage / consistency / reopen-stable / idempotent
[PASS] Meeting reloaded successfully   - transcript + intelligence state preserved
[SKIP] Local summarization             - opt-in (--with-summary)
```

Failures name the exact stage (e.g. product detection) and artifacts
(`tests/e2e/artifacts/{transcript,events,recommendations,turns,assignments}.json`)
are preserved for debugging.

## Baseline

All expectations live in `tests/e2e/baseline.json` — tolerances are
calibrated to the real models (parakeet default, whisper-tiny smoke
overrides). A changed output **fails** the run: re-baseline only after
intentional review with `--update-baseline`. `Objection` and
`CompetitorMentioned` are documented-zero in the keyless e2e environment
(the engine's objection patterns are SaaS-tuned; competitor LLM fallback
needs a GROQ key) — if they start firing, the suite flags it for review.

## Isolation guarantees

- Dedicated database `callpilot_e2e` (own postgres volume, host port 5433)
- Own server/engine/redis containers (ports 5002/8002) — never the dev stack
- Model downloads into `tests/e2e/models/` — never the app's model dirs
- Every test meeting/document/KB deleted at the end (unless `--keep`)
- No production code is required to run it; production changes are limited
  to genuine reuse extractions (see git history)

## Architecture

```
tests/e2e/
  run_e2e.py                  # orchestrator (stdlib-only python)
  baseline.json               # the ONLY place expectations live
  docker-compose.e2e.yml      # isolated stack override (own volumes/ports)
  sample/secure-meters-product-guide.md   # KB fixture (products in the call)
  artifacts/                  # per-run outputs (gitignored)
  models/                     # STT + diarization models (gitignored)

callpilot-desktop/frontend/src-tauri/e2e-harness/   # Rust harness
  transcribe  # real decode -> VAD -> Parakeet/whisper
  diarize     # real diar-helper (sherpa-onnx)
  align       # real production turn alignment
  summarize   # real llama-helper summarization (opt-in)
```

## Extending for new features

Add a stage in `run_e2e.py` in the same pattern: run the real pipeline,
validate against a new `baseline.json` section, emit `[PASS]/[FAIL]` with a
meaningful detail line. Keep expectations in the baseline, never in code.
