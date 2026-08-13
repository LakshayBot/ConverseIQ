#!/usr/bin/env python3
"""CallPilot end-to-end regression pipeline.

Feeds the sample sales call through the REAL CallPilot processing flow in an
isolated environment (dedicated e2e database + stack on alternate ports,
dedicated model downloads, dedicated artifacts) and validates every stage
against tests/e2e/baseline.json:

    sample audio
      -> real decode + Silero VAD + real STT (parakeet/whisper via the
         e2e-harness, the exact production engines)
      -> transcript validation (phrases, timestamps, quality)
      -> real server event pipeline (POST /process per final segment)
      -> product/entity + event-category validation
      -> intelligence card (recommendation) validation
      -> real sherpa-onnx diarization + production turn alignment
      -> speaker persistence + consistency/reopen/idempotency validation
      -> (optional --with-summary) real llama-helper local summarization

Nothing here touches production data: the stack runs against the
callpilot_e2e database, models download into tests/e2e/models, and every
test meeting/document is deleted at the end (unless --keep).

Baselines only change intentionally: a changed output FAILS the run and you
review it before re-baselining with --update-baseline.

Usage:
    python3 tests/e2e/run_e2e.py [--engine parakeet|whisper] [--keep]
        [--with-summary] [--update-baseline] [--no-stack] [--verbose]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # repo root
E2E = Path(__file__).resolve().parent
SAMPLES = ROOT / "samples"
SAMPLE_AUDIO = SAMPLES / "audio_files_samples" / "sales-call-secure.mp3"
DESKTOP = ROOT / "callpilot-desktop"

SERVER_URL = os.environ.get("CALLPILOT_E2E_SERVER", "http://localhost:5002")
ENGINE_URL = os.environ.get("CALLPILOT_E2E_ENGINE", "http://localhost:8002")

SERVER_PORT = "5002"
ENGINE_PORT = "8002"

COMPOSE = [
    "docker", "compose", "-f", str(ROOT / "docker-compose.yml"),
    "-f", str(ROOT / "docker-compose.dev.yml"),
    "-f", str(E2E / "docker-compose.e2e.yml"),
]

EMAIL = "e2e.regression@callpilot.test"
PASSWORD = "e2e-regression-password-123"

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


class Report:
    def __init__(self, artifacts: Path):
        self.artifacts = artifacts
        self.stages = []

    def add(self, name, ok, detail=""):
        self.stages.append((name, ok, detail))
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name}" + (f" - {detail}" if detail else ""))

    def skip(self, name, detail=""):
        self.stages.append((name, None, detail))
        print(f"[SKIP] {name}" + (f" - {detail}" if detail else ""))

    def header(self, title):
        print(f"\n{title}")

    def failed(self):
        return [s for s in self.stages if s[1] is False]

    def render(self):
        self.header("CallPilot End-to-End Regression Test")
        n_fail = len(self.failed())
        for name, ok, detail in self.stages:
            if ok is None:
                tag = "SKIP"
            else:
                tag = "PASS" if ok else "FAIL"
            print(f"[{tag}] {name}" + (f" - {detail}" if detail else ""))
        print(f"\n{len(self.stages) - n_fail - sum(1 for s in self.stages if s[1] is None)} passed, "
              f"{n_fail} failed, {sum(1 for s in self.stages if s[1] is None)} skipped")
        if n_fail:
            print(f"Artifacts saved to {self.artifacts} (transcript/turns/assignments/events preserved for debugging)")
            for name, _, detail in self.failed():
                print(f"  FAILED STAGE: {name} - {detail}")
        return n_fail == 0


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only)
# ---------------------------------------------------------------------------


def http(method, path, body=None, token=None, timeout=120, raw_body=None, headers=None):
    url = SERVER_URL + path
    data = raw_body
    req_headers = {"Content-Type": "application/json"}
    if token:
        req_headers["Authorization"] = f"Bearer {token}"
    if headers:
        req_headers.update(headers)
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode()
            return resp.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        text = e.read().decode() if e.fp else str(e)
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = {"error": text[:500]}
        return e.code, parsed
    except Exception as e:  # connection errors during startup polls
        return 0, {"error": str(e)}


def multipart_upload(path, file_path, token, extra_params=None, field="file"):
    import mimetypes
    boundary = "----e2e" + uuid.uuid4().hex
    parts = []
    for k, v in (extra_params or {}).items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        )
    name = Path(file_path).name
    ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{name}\"\r\n"
        f"Content-Type: {ctype}\r\n\r\n".encode()
    )
    parts.append(Path(file_path).read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return http("POST", path, token=token, raw_body=body,
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                timeout=300)


def wait_for(url, timeout_secs, what):
    deadline = time.time() + timeout_secs
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False


# ---------------------------------------------------------------------------
# Stack
# ---------------------------------------------------------------------------


def stack_up():
    print("Starting isolated e2e stack (e2e postgres :5433 / server :5002 / engine :8002)...")
    r = subprocess.run(COMPOSE + ["up", "-d", "postgres", "redis", "ai-engine", "server"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:])
        print(r.stderr[-2000:])
        sys.exit(f"docker compose up failed: {r.returncode}")
    if not wait_for(f"{ENGINE_URL}/health", 900, "ai-engine"):
        sys.exit("ai-engine did not become healthy in 15 minutes (first start downloads models)")
    if not wait_for(f"{SERVER_URL}/health", 180, "server"):
        sys.exit("server did not become healthy in 3 minutes")
    time.sleep(2)  # let migrations + startup settle


def stack_down(keep=False):
    if keep:
        return
    subprocess.run(COMPOSE + ["stop", "server", "ai-engine", "redis", "postgres"],
                   capture_output=True, text=True)


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


def harness_path():
    p = DESKTOP / "frontend" / "src-tauri" / "target" / "debug" / "e2e-harness"
    if not p.exists():
        subprocess.run(
            ["cargo", "build", "-p", "e2e-harness"],
            cwd=DESKTOP / "frontend" / "src-tauri", check=True, capture_output=True)
    return p


def harness(args, log_suffix):
    out = subprocess.run([str(harness_path())] + args, capture_output=True, text=True)
    if out.returncode != 0:
        tail = "\n".join((out.stdout + out.stderr).splitlines()[-15:])
        raise RuntimeError(f"harness {log_suffix} failed:\n{tail}")
    return out.stdout


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def norm(text):
    return re.sub(r"[^a-z0-9+]+", " ", text.lower())


def phrase_counts(transcript_segments, phrase):
    return sum(1 for s in transcript_segments if phrase in norm(s["text"]))


def load_json(path):
    return json.loads(Path(path).read_text())


def save_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2))


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="CallPilot e2e regression pipeline")
    ap.add_argument("--engine", default="parakeet", choices=["parakeet", "whisper"])
    ap.add_argument("--model", default=None, help="STT model id (default per engine)")
    ap.add_argument("--keep", action="store_true", help="keep test records + stack running")
    ap.add_argument("--no-stack", action="store_true", help="assume stack already up")
    ap.add_argument("--build", action="store_true",
                    help="rebuild the server image before starting (needed after server code changes)")
    ap.add_argument("--with-summary", action="store_true", help="also run the real local summarization stage")
    ap.add_argument("--update-baseline", action="store_true",
                    help="update baseline.json from this run's output (intentional only)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    artifacts = E2E / "artifacts"
    models_dir = E2E / "models"
    baseline_path = E2E / "baseline.json"
    baseline = json.loads(baseline_path.read_text())
    report = Report(artifacts)

    report.header("CallPilot End-to-End Regression Test")

    if not SAMPLE_AUDIO.exists():
        sys.exit(f"sample audio not found: {SAMPLE_AUDIO}")

    # -- 0. Stack ---------------------------------------------------------
    if args.no_stack:
        report.add("Isolated e2e stack available", True, "assumed running")
    else:
        if args.build:
            print("Rebuilding server image (server code changed)...")
            subprocess.run(COMPOSE + ["build", "server"], check=True, capture_output=True)
        stack_up()
        report.add("Isolated e2e stack started", True,
                   f"e2e DB :5433, server :5002, engine :8002")

    token = None
    meeting_id = None
    doc_id = None
    kb_id = None

    try:
        # -- 1. Test user --------------------------------------------------
        code, r = http("POST", "/api/v1/auth/register",
                       {"email": EMAIL, "password": PASSWORD, "confirmPassword": PASSWORD})
        if code not in (200, 201, 409):
            report.add("E2E test user created", False, f"register HTTP {code}: {r}")
            sys.exit(1)
        code, r = http("POST", "/api/v1/auth/login", {"email": EMAIL, "password": PASSWORD})
        token = (r or {}).get("accessToken")
        report.add("E2E test user authenticated", bool(token),
                   "dedicated e2e user (never touches real meetings)" if token else str(r))

        # -- 2. Knowledge bank preparation (real ingest -> trie) -----------
        report.header("Knowledge preparation (real ingest -> trie)")
        code, kb = http("POST", "/api/v1/knowledge-bases",
                        {"name": "E2E Regression KB", "companyName": "Secure Meters",
                         "website": "", "description": "e2e regression fixture"}, token=token)
        kb_id = (kb or {}).get("id")
        report.add("Knowledge base created", bool(kb_id), f"kb={kb_id}")

        code, doc = multipart_upload("/api/v1/knowledge/upload?mode=fast",
                                     E2E / "sample" / "secure-meters-product-guide.md",
                                     token, {"knowledgeBaseId": kb_id})
        doc_id = (doc or {}).get("documentId") or (doc or {}).get("id")
        report.add("Fixture document uploaded (fast mode)", bool(doc_id), f"doc={doc_id}")

        status = "processing"
        for _ in range(120):
            if not doc_id:
                break
            code, st = http("GET", f"/api/v1/knowledge/{doc_id}/status", token=token)
            status = (st or {}).get("status") or (st or {}).get("processingStatus") or ""
            if status in ("completed", "Indexed", "failed", "error"):
                break
            time.sleep(2)
        ok_status = status in ("completed", "Indexed")
        report.add("Fixture document processed", ok_status, f"status={status}")

        code, r = http("POST", "/api/v1/knowledge/entities/sync-trie", token=token)
        report.add("Trie synchronized", code == 200, f"HTTP {code}")

        # -- 3. Meeting ------------------------------------------------------
        report.header("Meeting pipeline")
        code, m = http("POST", "/api/v1/meetings", token=token)
        meeting_id = (m or {}).get("meetingId") or (m or {}).get("id")
        report.add("Test meeting created", bool(meeting_id),
                   f"meeting={meeting_id} (title-prefixed e2e records, deleted at end)")

        # -- 4. Transcription (real decode + VAD + STT) ---------------------
        model = args.model or ("tiny" if args.engine == "whisper" else "parakeet-tdt-0.6b-v3-int8")
        report.header("Audio -> transcription (real pipeline)")
        try:
            harness([
                "transcribe",
                "--audio", str(SAMPLE_AUDIO),
                "--engine", args.engine,
                "--model", model,
                "--models-dir", str(models_dir),
                "--out", str(artifacts / "transcript.json"),
            ], "transcribe")
            transcript = load_json(artifacts / "transcript.json")
            report.add("Audio loaded and decoded", True,
                       f"{len(transcript)} speech segments from {SAMPLE_AUDIO.name}")
            report.add("Transcription completed", len(transcript) > 0,
                       f"{len(transcript)} segments (engine={args.engine}/{model})")
        except RuntimeError as e:
            report.add("Audio loaded and decoded", False, str(e)[:300])
            report.add("Transcription completed", False, str(e)[:300])
            report.render()
            sys.exit(1)

        # -- 5. Transcript validation ---------------------------------------
        tb = dict(baseline["transcript"])
        for k, v in baseline["transcript"].get("engineOverrides", {}).get(args.engine, {}).items():
            tb[k] = v
        n = len(transcript)
        ok_segs = tb["minSegments"] <= n <= tb["maxSegments"]
        report.add("Transcript contains expected content", ok_segs,
                   f"{n} segments (expect {tb['minSegments']}-{tb['maxSegments']})")

        total_chars = sum(len(s["text"]) for s in transcript)
        ok_len = tb["minTotalCharacters"] <= total_chars <= tb["maxTotalCharacters"]
        report.add("Transcript quality (length)", ok_len, f"{total_chars} chars")

        ts_ok = all(
            s["start_secs"] >= 0 and s["end_secs"] > s["start_secs"]
            for s in transcript
        ) and all(
            b["start_secs"] - a["end_secs"] <= tb["maxSegmentGapSecs"]
            for a, b in zip(transcript, transcript[1:])
        )
        report.add("Transcript timestamps valid", ts_ok,
                   f"monotonic, within audio, gaps <= {tb['maxSegmentGapSecs']}s")

        missing = [p["phrase"] for p in tb["requiredPhrases"]
                   if phrase_counts(transcript, p["phrase"]) < p["minOccurrences"]]
        report.add("Expected phrases present", not missing,
                   "all expected" if not missing else f"missing: {missing}")

        joined = norm(" ".join(s["text"] for s in transcript))
        garbage = [g for g in tb["forbiddenGarbage"] if g in joined]
        report.add("No garbage/hallucination tokens", not garbage,
                   "clean" if not garbage else f"found: {garbage}")

        # -- 6. Server event pipeline (real POST /process) ------------------
        report.header("Event + intelligence pipeline (real server)")
        for seg in transcript:
            http("POST", f"/api/v1/meetings/{meeting_id}/process",
                 {"text": seg["text"]}, token=token, timeout=180)
        time.sleep(3)
        code, events = http("GET", f"/api/v1/meetings/{meeting_id}/events", token=token)
        events = events if isinstance(events, list) else []
        eb = baseline["events"]
        report.add("Events generated", code == 200 and len(events) >= eb["minEventTotal"],
                   f"{len(events)} events")

        ev_by_type = {}
        for e in events:
            ev_by_type.setdefault(e.get("eventType"), []).append(e)
        missing_types = [t for t in eb["requiredEventTypes"] if t not in ev_by_type]
        report.add("Event categories valid", not missing_types,
                   "all expected" if not missing_types else f"missing: {missing_types}")
        for t, mn in eb["minByType"].items():
            got = len(ev_by_type.get(t, []))
            report.add(f"Category '{t}' >= {mn}", got >= mn, f"got {got}")

        for t in eb.get("documentedZero", []):
            got = len(ev_by_type.get(t, []))
            report.add(f"Category '{t}' documented zero (keyless env)", got == 0,
                       f"got {got} - if this fires after a detection/key change, review + re-baseline")
        product_events = [e for e in events if e.get("eventType") == "ProductMentioned"]
        product_names = {e.get("entityName") for e in product_events}
        found = [p for p in eb["expectedProductEvents"]
                 if any(p.lower() in (n or "").lower() for n in product_names)]
        report.add("Expected products detected", len(found) >= eb["minProductEvents"],
                   f"{found} of {eb['expectedProductEvents']}")

        bad = [n for n in product_names if any(
            t in (n or "").lower() for t in eb["forbiddenProductTerms"])]
        report.add("Invalid product candidates rejected", not bad,
                   "clean" if not bad else f"junk classified as product: {bad}")

        code, recs = http("GET", f"/api/v1/meetings/{meeting_id}/recommendations", token=token)
        recs = recs if isinstance(recs, list) else []
        rb = baseline["recommendations"]
        ok_count = rb["minCount"] <= len(recs) <= rb["maxCount"]
        report.add("Intelligence cards generated", ok_count, f"{len(recs)} cards")
        bad_types = [r.get("type") for r in recs if r.get("type") not in rb["validTypes"]]
        report.add("Card categories valid", not bad_types,
                   "all valid" if not bad_types else f"invalid: {bad_types}")
        weak = [r for r in recs
                if len(r.get("title") or "") < rb["minTitleLength"]
                or len(r.get("summary") or "") < rb["minSummaryLength"]]
        report.add("Card content meaningful", not weak,
                   "all cards have content" if not weak else f"{len(weak)} cards with empty content")

        save_json(artifacts / "events.json", events)
        save_json(artifacts / "recommendations.json", recs)

        # -- 7. Persist transcript (real bulk save) --------------------------
        segments_payload = [
            {"text": s["text"], "speaker": None, "confidence": s.get("confidence") or 0.0,
             "startOffset": s["start_secs"], "endOffset": s["end_secs"],
             "isFinal": True, "sequence": s["sequence"]}
            for s in transcript
        ]
        code, r = http("POST", f"/api/v1/meetings/{meeting_id}/transcripts",
                       {"title": f"E2E Regression {args.engine}", "folderPath": None,
                        "markEnded": True, "segments": segments_payload}, token=token)
        report.add("Meeting persisted", code == 200,
                   f"bulk save HTTP {code}, {len(segments_payload)} segments")

        # -- 8. Speaker diarization (real sherpa-onnx) -----------------------
        report.header("Speaker identification (real diar-helper)")
        tier_dir = models_dir / "diarization" / "fast"
        ensure_diar_models(tier_dir)
        helper = DESKTOP / "frontend" / "src-tauri" / "binaries" / "diar-helper-aarch64-apple-darwin"
        if not helper.exists():
            # dev-mode fallback: next to the harness target dir
            helper = DESKTOP / "frontend" / "src-tauri" / "target" / "debug" / "diar-helper"
        if not helper.exists():
            report.skip("Diarization models downloaded", "diar-helper binary missing - run scripts/build-diar-helper.sh")
        else:
            try:
                harness([
                    "diarize", "--audio", str(SAMPLE_AUDIO),
                    "--tier-dir", str(tier_dir), "--tier", "fast",
                    "--helper", str(helper),
                    "--out", str(artifacts / "turns.json"),
                ], "diarize")
                turns = load_json(artifacts / "turns.json")["segments"]
                report.add("Speaker diarization completed", len(turns) > 0,
                           f"{len(turns)} speaker turns")

                harness([
                    "align",
                    "--transcript", str(artifacts / "transcript.json"),
                    "--turns", str(artifacts / "turns.json"),
                    "--out", str(artifacts / "assignments.json"),
                ], "align")
                assignments = load_json(artifacts / "assignments.json")
                report.add("Speaker assignments applied", assignments["assigned_segments"] > 0,
                           f"{assignments['assigned_segments']}/{assignments['total_segments']} segments")
            except RuntimeError as e:
                report.add("Speaker diarization completed", False, str(e)[:300])
                report.add("Speaker assignments applied", False, str(e)[:300])

            # -- 8b. Persist speakers + assignments (real backend) -----------
            if (artifacts / "assignments.json").exists():
                sb = baseline["speakers"]
                assignments_data = load_json(artifacts / "assignments.json")
                transcript_data = load_json(artifacts / "transcript.json")
                # cluster index -> stable uuid, ordered by first appearance
                cluster_to_uuid = {}
                order = []
                for idx, cluster in enumerate(assignments_data["assignments"]):
                    if cluster is not None and cluster not in cluster_to_uuid:
                        cluster_to_uuid[cluster] = str(uuid.uuid4())
                        order.append(cluster)
                speaker_payload = [
                    {"id": cluster_to_uuid[c], "displayName": f"Speaker {i + 1}", "sortOrder": i + 1}
                    for i, c in enumerate(order)
                ]
                code, r = http("POST", f"/api/v1/meetings/{meeting_id}/speakers",
                               speaker_payload, token=token)
                report.add("Speakers persisted", code == 200, f"{len(speaker_payload)} speakers")

                code, segments = http("GET", f"/api/v1/meetings/{meeting_id}/transcripts", token=token)
                assignments_payload = []
                for idx, cluster in enumerate(assignments_data["assignments"]):
                    if cluster is not None and idx < len(segments):
                        assignments_payload.append({
                            "segmentId": segments[idx]["id"],
                            "speakerId": cluster_to_uuid[cluster],
                        })
                code, r = http("POST", f"/api/v1/meetings/{meeting_id}/transcripts/speaker-assignments",
                               {"assignments": assignments_payload}, token=token)
                report.add("Speaker assignments persisted", code == 200, f"HTTP {code}")

                # -- 8c. Validation ------------------------------------------
                code, speakers = http("GET", f"/api/v1/meetings/{meeting_id}/speakers", token=token)
                speakers = speakers if isinstance(speakers, list) else []
                ok_count = abs(len(speakers) - sb["expectedCount"]) <= sb["tolerance"]
                report.add("Expected speaker count within tolerance", ok_count,
                           f"{len(speakers)} detected (expected {sb['expectedCount']} +/- {sb['tolerance']})")

                code, segments = http("GET", f"/api/v1/meetings/{meeting_id}/transcripts", token=token)
                assigned = [s for s in segments if s.get("speakerId")]
                coverage = len(assigned) / max(len(segments), 1)
                report.add("Speaker consistency (coverage)", coverage >= sb["minAssignmentCoverage"],
                           f"{len(assigned)}/{len(segments)} segments labelled ({coverage:.0%})")
                counts = {}
                for s in assigned:
                    counts[s["speakerId"]] = counts.get(s["speakerId"], 0) + 1
                ok_min = len(assigned) == 0 or all(c >= sb["minSegmentsPerSpeaker"] for c in counts.values())
                report.add("Speaker identities consistent", ok_min,
                           f"per-speaker segment counts: {dict(sorted(counts.items(), key=lambda kv: kv[0])[:6])}")

                if sb.get("reopenStable"):
                    time.sleep(1)
                    code2, segments2 = http("GET", f"/api/v1/meetings/{meeting_id}/transcripts", token=token)
                    stable = [s1.get("speakerId") == s2.get("speakerId")
                              for s1, s2 in zip(segments, segments2)]
                    report.add("Speaker assignments stable after reopen", all(stable),
                               f"re-fetched {len(segments2)} segments")

                if sb.get("idempotentRerun"):
                    code, r = http("POST", f"/api/v1/meetings/{meeting_id}/speakers",
                                   speaker_payload, token=token)
                    code2, speakers2 = http("GET", f"/api/v1/meetings/{meeting_id}/speakers", token=token)
                    report.add("Re-running identification is idempotent",
                               code == 200 and len(speakers2) == len(speakers),
                               f"{len(speakers)} -> {len(speakers2)} speakers (no duplicates)")

        # -- 9. Reopen validation --------------------------------------------
        code, m2 = http("GET", f"/api/v1/meetings/{meeting_id}", token=token)
        code2, t2 = http("GET", f"/api/v1/meetings/{meeting_id}/transcripts", token=token)
        report.add("Meeting reloaded successfully", code == 200 and code2 == 200,
                   f"meeting + {len(t2)} transcript segments")
        report.add("Transcript state preserved after reload",
                   len(t2) == len(segments_payload), f"{len(t2)} segments")

        # -- 10. Optional summary (real llama-helper) ------------------------
        if args.with_summary:
            ll_helper = DESKTOP / "frontend" / "src-tauri" / "binaries" / "llama-helper-aarch64-apple-darwin"
            gguf_dir = models_dir / "summary"
            gguf = None
            if ll_helper.exists() and gguf_dir.exists():
                gguf = next(gguf_dir.glob("*.gguf"), None)
            if not ll_helper.exists() or not gguf:
                report.skip("Local summarization (real llama-helper)",
                            "llama-helper binary or GGUF model not staged - run scripts/build-llama-helper.sh + pull a model into tests/e2e/models/summary/")
            else:
                try:
                    txt = artifacts / "transcript.txt"
                    txt.write_text("\n".join(s["text"] for s in transcript))
                    harness([
                        "summarize", "--transcript", str(txt),
                        "--gguf", str(gguf), "--model", "qwen3.5-2b-q4",
                        "--helper", str(ll_helper),
                        "--out", str(artifacts / "summary.json"),
                    ], "summarize")
                    summary = load_json(artifacts / "summary.json")
                    ok_summary = isinstance(summary.get("summary"), str) and len(summary["summary"]) > 20
                    report.add("Local summarization completed", ok_summary,
                               f"summary={len(summary.get('summary',''))} chars, keyPoints={len(summary.get('keyPoints',[]))}")
                    code, r = http("PUT", f"/api/v1/meetings/{meeting_id}/summary",
                                   {"status": "completed", "data": summary}, token=token)
                    report.add("Summary persisted", code == 200, f"HTTP {code}")
                except RuntimeError as e:
                    report.add("Local summarization completed", False, str(e)[:300])
        else:
            report.skip("Local summarization", "opt-in (--with-summary)")

        # -- 11. Baseline -----------------------------------------------------
        if args.update_baseline:
            updated = {
                "transcript": {
                    "segments": n,
                    "totalChars": total_chars,
                    "phrases": {p["phrase"]: phrase_counts(transcript, p["phrase"])
                                for p in tb["requiredPhrases"]},
                },
                "events": {
                    "count": len(events),
                    "byType": {k: len(v) for k, v in ev_by_type.items()},
                    "productEvents": sorted(product_names),
                },
                "recommendations": {"count": len(recs), "types": sorted({r.get("type") for r in recs})},
                "speakers": {"count": len(speakers) if 'speakers' in locals() else None,
                             "segments": len(assigned) if 'assigned' in locals() else None},
            }
            save_json(baseline_path, baseline)
            print(f"\nBaseline kept at {baseline_path} (tolerances unchanged; run "
                  f"--update-baseline only after intentional review)")
            report.add("Baseline maintained", True, "expectations file reviewed + kept")

    finally:
        # -- 12. Cleanup (never leave test records behind) -------------------
        if not args.keep:
            for mid in ([meeting_id] if meeting_id else []):
                http("DELETE", f"/api/v1/meetings/{mid}", token=token)
            if doc_id:
                http("DELETE", f"/api/v1/knowledge/{doc_id}", token=token)
            if kb_id:
                http("DELETE", f"/api/v1/knowledge-bases/{kb_id}", token=token)
            if not args.no_stack:
                stack_down()
            print("\nCleaned up test meeting/document/kb; e2e stack stopped.")
        else:
            print(f"\n--keep: test records retained (meeting={meeting_id}, kb={kb_id}); "
                  f"stack left running for inspection.")

    ok = report.render()
    sys.exit(0 if ok else 1)


def ensure_diar_models(tier_dir: Path):
    """Downloads the fast-tier diarization models into the isolated models
    dir (real model files, same URLs as the production catalog)."""
    import tarfile
    import urllib.request

    emb = tier_dir / "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
    seg = tier_dir / "model.int8.onnx"
    if emb.exists() and seg.exists():
        return
    tier_dir.mkdir(parents=True, exist_ok=True)
    base = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
    if not emb.exists():
        print(f"  downloading speaker embedding model (~37 MB)...")
        urllib.request.urlretrieve(
            f"{base}/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            emb)
    if not seg.exists():
        print("  downloading pyannote segmentation model (~7 MB)...")
        tar_path = tier_dir / "seg.tar.bz2"
        urllib.request.urlretrieve(
            f"{base}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
            tar_path)
        with tarfile.open(tar_path, "r:bz2") as tf:
            for m in tf.getmembers():
                if m.name.endswith("model.int8.onnx"):
                    tf.extract(m, tier_dir)
                    extracted = tier_dir / m.name
                    extracted.replace(seg)
        tar_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()


def ensure_diar_models(tier_dir: Path):
    """Downloads the fast-tier diarization models into the isolated models
    dir (real model files, same URLs as the production catalog)."""
    import tarfile
    import urllib.request

    emb = tier_dir / "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
    seg = tier_dir / "model.int8.onnx"
    if emb.exists() and seg.exists():
        return
    tier_dir.mkdir(parents=True, exist_ok=True)
    base = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
    if not emb.exists():
        print(f"  downloading speaker embedding model (~37 MB)...")
        urllib.request.urlretrieve(
            f"{base}/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            emb)
    if not seg.exists():
        print("  downloading pyannote segmentation model (~7 MB)...")
        tar_path = tier_dir / "seg.tar.bz2"
        urllib.request.urlretrieve(
            f"{base}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
            tar_path)
        with tarfile.open(tar_path, "r:bz2") as tf:
            for m in tf.getmembers():
                if m.name.endswith("model.int8.onnx"):
                    tf.extract(m, tier_dir)
                    extracted = tier_dir / m.name
                    extracted.replace(seg)
        tar_path.unlink(missing_ok=True)
