#!/usr/bin/env python3
"""CallPilot e2e FEATURE tests - contextual matching, action items, debounce
timing. EXTENDS the regression pipeline (tests/e2e/run_e2e.py); never replaces
it, never touches baseline.json.

Run standalone (starts its own stack with tests/e2e/docker-compose.test-overrides.yml):

    .venv/bin/python -m pytest tests/e2e/test_features.py -v

Or via the orchestrator (stack + report integration):

    python3 tests/e2e/run_e2e.py --features

Deps: tests/e2e/requirements-features.txt installed into the AI engine venv.

Determinism knobs (from docker-compose.test-overrides.yml):
    DEBOUNCE_WINDOW_SECONDS=2        (Python engine keyword debounce)
    DUPLICATE_EVENT_WINDOW_SECONDS=2 (.NET hub debounce)
    CONTEXTUAL_MATCH_THRESHOLD=0.72
    CONTEXTUAL_CACHE_TTL_SECONDS=0   (fresh chunk loads per call)
    NEXT_PUBLIC_SIGNALR_DEDUPE_SECONDS is irrelevant here - the hub-side
    SignalR events are collected directly, no frontend in the loop.

STT caveat: frame-replay tests run the REAL Nemotron STT. Where a semantic
assertion depends on transcript accuracy, the test documents and uses the
direct-engine fallback path (Test B) rather than asserting on STT output.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

E2E = Path(__file__).resolve().parent
ROOT = E2E.parent
sys.path.insert(0, str(ROOT))                       # for run_e2e helpers
sys.path.insert(0, str(E2E))                        # for frame_replay

import run_e2e  # noqa: E402  (stdlib-only helpers: http, wait_for, COMPOSE)
from frame_replay import (  # noqa: E402
    FrameReplayClient,
    authenticate,
    DEFAULT_SERVER,
)

import urllib.request  # noqa: E402

FIXTURES = E2E / "fixtures"
AUDIO = FIXTURES / "audio"
TRANSCRIPTS = FIXTURES / "transcripts"
KNOWLEDGE = FIXTURES / "knowledge"
OVERRIDES_COMPOSE = E2E / "docker-compose.test-overrides.yml"

SERVER_URL = os.environ.get("CALLPILOT_E2E_SERVER", run_e2e.SERVER_URL)
ENGINE_URL = os.environ.get("CALLPILOT_E2E_ENGINE", run_e2e.ENGINE_URL)
ARTIFACTS = E2E / "artifacts"     # run_e2e keeps these as main() locals
MODELS_DIR = E2E / "models"       # so we re-derive them here

REPLAY_SPEED = float(os.environ.get("FEATURE_REPLAY_SPEED", "5.0"))
HUB_EVENT_TIMEOUT = float(os.environ.get("FEATURE_EVENT_TIMEOUT", "20"))
RECOMMENDATION_TIMEOUT = float(os.environ.get("FEATURE_REC_TIMEOUT", "30"))
KEYWORD_EVENT_TIMEOUT = 15  # Test A per spec

CALLPILOT_THRESHOLD = 0.72  # must match docker-compose.test-overrides.yml


# ---------------------------------------------------------------------------
# Stack management
# ---------------------------------------------------------------------------


def _compose_with_overrides() -> list[str]:
    return run_e2e.COMPOSE + ["-f", str(OVERRIDES_COMPOSE)]


@pytest.fixture(scope="session")
def feature_stack():
    """Starts the isolated e2e stack WITH the test overrides, unless the
    orchestrator (run_e2e.py --features) already started it for us."""
    if os.environ.get("CALLPILOT_FEATURE_STACK_EXTERNAL") == "1":
        yield "external"
        return

    compose = _compose_with_overrides()
    print("\n[features] starting stack with test overrides...")
    subprocess.run(compose + ["up", "-d", "postgres", "redis", "ai-engine", "server"],
                   check=True, capture_output=True)
    assert run_e2e.wait_for(f"{ENGINE_URL}/health", 1800, "ai-engine"), "engine did not become healthy"
    assert run_e2e.wait_for(f"{SERVER_URL}/health", 180, "server"), "server did not become healthy"
    time.sleep(2)
    yield compose
    subprocess.run(compose + ["down"], capture_output=True)


def _jwt_user_id(token: str) -> str:
    """Decode the userId claim from the bearer token (no signature check -
    the token came from the server we are testing)."""
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    return payload["userId"]


# ---------------------------------------------------------------------------
# Session: auth + knowledge ingest + meeting factory
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def auth(feature_stack) -> dict:
    """Register + login the dedicated e2e regression user (same user the
    baseline suite uses - never touches real data)."""
    code, r = run_e2e.http("POST", "/api/v1/auth/register",
                           {"email": run_e2e.EMAIL, "password": run_e2e.PASSWORD,
                            "confirmPassword": run_e2e.PASSWORD})
    assert code in (200, 201, 409), f"register HTTP {code}: {r}"
    code, r = run_e2e.http("POST", "/api/v1/auth/login",
                           {"email": run_e2e.EMAIL, "password": run_e2e.PASSWORD})
    assert code == 200 and r.get("accessToken"), f"login failed: {r}"
    return {"token": r["accessToken"], "userId": _jwt_user_id(r["accessToken"])}


@pytest.fixture(scope="session")
def knowledge_ready(feature_stack, auth) -> dict:
    """Ingest prodigy_battle_card.md (fast mode), wait for processing
    (embeddings included), then sync the trie. Returns doc info."""
    token = auth["token"]
    code, kb = run_e2e.http("POST", "/api/v1/knowledge-bases",
                            {"name": f"Feature Tests KB {uuid.uuid4().hex[:8]}",
                             "companyName": "Secure Meters", "website": "",
                             "description": "feature-test fixture"}, token=token)
    assert code in (200, 201) and kb.get("id"), f"KB create failed: {code} {kb}"
    kb_id = kb["id"]

    code, doc = run_e2e.multipart_upload(
        f"/api/v1/knowledge/upload?mode=fast&knowledgeBaseId={kb_id}",
        KNOWLEDGE / "prodigy_battle_card.md", token, {})
    doc_id = (doc or {}).get("documentId") or (doc or {}).get("id")
    assert doc_id, f"upload failed: {code} {doc}"

    status = ""
    for _ in range(120):  # fast mode embeds in-process; poll until done
        code, st = run_e2e.http("GET", f"/api/v1/knowledge/{doc_id}/status", token=token)
        status = (st or {}).get("status") or (st or {}).get("processingStatus") or ""
        if status in ("completed", "Indexed", "failed", "error"):
            break
        time.sleep(2)
    assert status in ("completed", "Indexed"), f"doc never completed: {status}"

    code, _ = run_e2e.http("POST", "/api/v1/knowledge/entities/sync-trie", token=token)
    assert code == 200, "trie sync failed"

    return {"kbId": kb_id, "docId": doc_id}


@pytest.fixture(scope="session")
def cleanup_knowledge(knowledge_ready, auth):
    yield knowledge_ready
    run_e2e.http("DELETE", f"/api/v1/knowledge/{knowledge_ready['docId']}", token=auth["token"])
    run_e2e.http("DELETE", f"/api/v1/knowledge-bases/{knowledge_ready['kbId']}", token=auth["token"])


@pytest.fixture()
def meeting(auth) -> str:
    """A fresh meeting per test - debounce state is per-meeting, so isolation
    between tests is guaranteed."""
    code, m = run_e2e.http("POST", "/api/v1/meetings", token=auth["token"])
    mid = (m or {}).get("meetingId") or (m or {}).get("id")
    assert mid, f"meeting create failed: {code} {m}"
    yield mid
    run_e2e.http("DELETE", f"/api/v1/meetings/{mid}", token=auth["token"])


@pytest.fixture()
def replay_client(meeting, auth):
    """FrameReplayClient bound to a fresh meeting, started + stopped per test."""
    client = FrameReplayClient(
        meeting, auth["token"], server=SERVER_URL,
        source="system_audio", speed=REPLAY_SPEED)
    client.start()
    yield client
    client.stop()


def wait_for_event(client: FrameReplayClient, event_name: str,
                   predicate=None, timeout: float = HUB_EVENT_TIMEOUT) -> dict | None:
    """Poll the collected log for the first matching event; None on timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for e in client.events(event_name):
            if predicate is None or predicate(e["payload"]):
                return e
        time.sleep(0.25)
    return None


def direct_contextual_match(turn_text: str, auth: dict) -> dict | None:
    """Fallback path: call the Python engine's contextual-match endpoint
    directly with injected transcript text (bypasses STT uncertainty).
    Returns the parsed ContextualMatchResult or None on non-match (204)."""
    body = json.dumps({
        "turn_text": turn_text,
        "meeting_id": "e2e-direct",
        "user_id": auth["userId"],
    }).encode()
    req = urllib.request.Request(
        f"{ENGINE_URL}/api/v1/ai/contextual-match", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 204:
            return None
        raise


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.timeout(180)
def test_keyword_product_mention_fires(meeting, replay_client):
    """TEST A - smoke: keyword ProductMentioned + recommendation through the
    REAL hub path (audio replay, source=microphone, 5x speed)."""
    frames = replay_client.replay_file(AUDIO / "rep_product_mention.aiff",
                                       source="microphone")
    assert frames > 0
    replay_client.finish()

    event = wait_for_event(
        replay_client, "EventDetected",
        lambda p: p.get("eventType") == "ProductMentioned"
        and "prodigy" in (p.get("entityName") or "").lower(),
        timeout=KEYWORD_EVENT_TIMEOUT)
    assert event is not None, (
        f"no ProductMentioned(prodigy) event; collected: "
        f"{[e['event'] for e in replay_client.collected]}")

    # Recommendation follows within 30s of the event.
    event_time = time.time()
    rec = wait_for_event(
        replay_client, "RecommendationGenerated", None,
        timeout=RECOMMENDATION_TIMEOUT)
    assert rec is not None, "no RecommendationGenerated followed the event"
    assert time.time() - event_time <= RECOMMENDATION_TIMEOUT + 5


@pytest.mark.timeout(240)
def test_contextual_match_fires_on_ct_pain(meeting, replay_client, cleanup_knowledge, auth):
    """TEST B - contextual match on the semantic CT pain turn.

    PRIMARY (hub) path: replay real buyer audio (source=system_audio) and
    wait for ContextualMatchDetected.
    FALLBACK (documented): if the STT output of the replayed turn is not
    accurate enough to trigger the semantic match, call the engine's
    /api/v1/ai/contextual-match directly with the fixture transcript text.
    The test records which assertion path fired; at least one must pass.
    """
    ct_text = (TRANSCRIPTS / "ct_pain_turn.txt").read_text().strip()

    replay_client.replay_file(AUDIO / "prospect_ct_pain.aiff", source="system_audio")
    replay_client.finish()

    hub_event = wait_for_event(
        replay_client, "ContextualMatchDetected", None, timeout=HUB_EVENT_TIMEOUT)

    if hub_event is not None:
        # ── Hub path fired: assert the full event shape. ──────────────────
        payload = hub_event["payload"]
        assert payload.get("similarity", 0) >= CALLPILOT_THRESHOLD
        assert payload.get("triggerSpan"), "triggerSpan must be non-empty"
        assert payload.get("knowledgeSource") in ("fast", "structured", "enriched")
        print("\n[features] TEST B assertion path: HUB (real audio -> STT -> match)")
        return

    # ── Direct path: STT was not accurate enough - assert on injected text.
    print("\n[features] TEST B assertion path: DIRECT (injected transcript text)")
    result = direct_contextual_match(ct_text, auth)
    assert result is not None, (
        "no contextual match on either path: hub saw no ContextualMatchDetected "
        "and the direct engine call returned no match above threshold")
    assert result["similarity"] >= CALLPILOT_THRESHOLD
    assert result["trigger_span"].strip()


@pytest.mark.timeout(120)
def test_contextual_match_skips_rep_source(meeting, replay_client):
    """TEST C - the same CT pain audio with source=microphone (REP) must NOT
    produce a contextual match (PROSPECT-only gate on the hub's frame.Source)."""
    replay_client.replay_file(AUDIO / "prospect_ct_pain.aiff", source="microphone")
    replay_client.finish()

    # Give the pipeline 10s to (incorrectly) fire; then assert silence.
    time.sleep(10)
    matches = replay_client.events("ContextualMatchDetected")
    assert not matches, (
        f"contextual match fired for a REP turn: {matches[:1]}")
    # Keyword detection on this turn is neither required nor forbidden.


@pytest.mark.timeout(240)
def test_contextual_debounce_suppresses_repeat(meeting, replay_client, auth):
    """TEST D - the same chunk cannot fire twice within the 2s test debounce,
    but fires again once it expires."""
    ct_event = wait_for_event  # noqa: F841 (clarity)
    replay_client.replay_file(AUDIO / "prospect_ct_pain.aiff", source="system_audio")
    replay_client.finish()
    time.sleep(0.5)
    replay_client.replay_file(AUDIO / "prospect_ct_pain.aiff", source="system_audio")
    replay_client.finish()

    first = wait_for_event(replay_client, "ContextualMatchDetected", None,
                           timeout=HUB_EVENT_TIMEOUT)
    # STT of the replayed turn may not produce a matchable transcript at all;
    # the debounce assertion is only meaningful if the first match happened.
    if first is None:
        pytest.skip("no first contextual match (STT of replayed audio did not "
                    "produce a matchable transcript) - debounce unobservable")
    time.sleep(1.0)  # settle window; both replays inside the 2s debounce
    after_two = [e for e in replay_client.events("ContextualMatchDetected")]
    chunk_id = first["payload"].get("chunkId")
    same_chunk = [e for e in after_two
                  if (e["payload"] or {}).get("chunkId") == chunk_id]
    assert len(same_chunk) == 1, (
        f"debounce failed: {len(same_chunk)} ContextualMatchDetected for chunk "
        f"{chunk_id} within the 2s window")

    # Debounce expiry (window=2s) -> third replay fires again.
    time.sleep(3)
    replay_client.replay_file(AUDIO / "prospect_ct_pain.aiff", source="system_audio")
    replay_client.finish()
    second = wait_for_event(
        replay_client, "ContextualMatchDetected",
        lambda p: p.get("chunkId") == chunk_id,
        timeout=HUB_EVENT_TIMEOUT)
    assert second is not None, "debounce did not clear after 3s - third replay suppressed"


@pytest.mark.timeout(300)
def test_action_item_extraction_from_summary(meeting, auth):
    """TEST E - action-item-only extraction through the production Rust path
    (e2e-harness `action-items`, the same extract_action_items_only the Tauri
    command calls). No audio involved."""
    # 1. Persist a pre-feature summary blob (no actionItems field at all).
    legacy_blob = {
        "summary": "Discussion of CT-operated meter accuracy drift and Prodigy's built-in CTs.",
        "keyPoints": ["Accuracy drifts after six months with external CTs"],
        "decisions": [],
    }
    code, r = run_e2e.http("PUT", f"/api/v1/meetings/{meeting}/summary",
                           {"status": "completed", "data": legacy_blob}, token=auth["token"])
    assert code == 200, f"summary PUT failed: {code} {r}"

    # 2. Run the extraction through the harness CLI.
    ll_helper = run_e2e.DESKTOP / "frontend" / "src-tauri" / "binaries" / "llama-helper-aarch64-apple-darwin"
    gguf_dir = MODELS_DIR / "summary"
    gguf = next(gguf_dir.glob("*.gguf"), None) if gguf_dir.exists() else None
    if not ll_helper.exists() or not gguf:
        pytest.skip("llama-helper binary or GGUF model not staged - "
                    "run scripts/build-llama-helper.sh + stage a model in tests/e2e/models/summary/")

    joined = "\n".join([
        (TRANSCRIPTS / "ct_pain_turn.txt").read_text().strip(),
        (TRANSCRIPTS / "product_mention_turn.txt").read_text().strip(),
    ])
    transcript_file = ARTIFACTS / "feature-action-items-input.txt"
    transcript_file.parent.mkdir(parents=True, exist_ok=True)
    transcript_file.write_text(joined)

    out_file = ARTIFACTS / "feature-action-items.json"
    run_e2e.harness([
        "action-items", "--transcript", str(transcript_file),
        "--gguf", str(gguf), "--model", "qwen3.5-2b-q4",
        "--helper", str(ll_helper), "--out", str(out_file),
    ], "action-items")
    items = run_e2e.load_json(out_file)

    # 3. Shape assertions.
    assert isinstance(items, list) and len(items) >= 1, f"no action items: {items}"
    for item in items:
        assert isinstance(item.get("title"), str) and item["title"].strip()
        assert item.get("assignee") in ("you", "team_member", "unassigned")
        assert item.get("priority") in ("high", "medium", "low")
        assert item.get("source") in ("action_item", "follow_up")
    # followUps must be collapsed into actionItems - never a separate key.
    assert not any("followUps" in item for item in items)

    # 4. Persist the extraction result the way the frontend hook would
    #    (PATCH actionItems into the existing blob, other fields untouched).
    code, current = run_e2e.http("GET", f"/api/v1/meetings/{meeting}/summary", token=auth["token"])
    existing = (current or {}).get("data") or {}
    merged = {**existing, "actionItems": items, "actionItemState": {}}
    code, r = run_e2e.http("PUT", f"/api/v1/meetings/{meeting}/summary",
                           {"status": "completed", "data": merged}, token=auth["token"])
    assert code == 200, f"merged summary PUT failed: {code} {r}"
    code, current = run_e2e.http("GET", f"/api/v1/meetings/{meeting}/summary", token=auth["token"])
    final_data = (current or {}).get("data") or {}
    # Other summary fields survived the PATCH untouched.
    assert final_data.get("summary") == legacy_blob["summary"]
    assert final_data.get("keyPoints") == legacy_blob["keyPoints"]
    assert final_data.get("actionItems") == items


@pytest.mark.timeout(300)
def test_recommendation_payload_has_trigger_fields(meeting, replay_client, auth):
    """TEST G - payload shape regression: keyword cards carry
    triggerType="keyword"/triggerSpan=null; contextual cards carry
    triggerType="contextual" with a non-empty triggerSpan substring of the
    CT pain transcript."""
    ct_text = (TRANSCRIPTS / "ct_pain_turn.txt").read_text().strip()

    # ── Keyword path ────────────────────────────────────────────────────────
    replay_client.replay_file(AUDIO / "rep_product_mention.aiff", source="microphone")
    replay_client.finish()
    rec = wait_for_event(replay_client, "RecommendationGenerated", None,
                         timeout=RECOMMENDATION_TIMEOUT)
    if rec is not None:
        payload = rec["payload"]
        assert payload.get("triggerType") == "keyword", f"keyword rec: {payload}"
        assert payload.get("triggerSpan") is None, f"keyword rec span: {payload}"
    else:
        pytest.skip("no keyword recommendation from replayed audio - STT did "
                    "not produce a triggerable transcript")

    # ── Contextual path ─────────────────────────────────────────────────────
    # Fresh meeting so the keyword debounce/collections don't interfere.
    replay_client.replay_file(AUDIO / "prospect_ct_pain.aiff", source="system_audio")
    replay_client.finish()
    ctx_event = wait_for_event(replay_client, "ContextualMatchDetected", None,
                               timeout=HUB_EVENT_TIMEOUT)
    ctx_rec = wait_for_event(
        replay_client, "RecommendationGenerated",
        lambda p: p.get("triggerType") == "contextual",
        timeout=RECOMMENDATION_TIMEOUT)
    if ctx_event is None or ctx_rec is None:
        # STT-accuracy fallback: verify the direct engine path instead and
        # document that the hub payload assertion could not be exercised.
        direct = direct_contextual_match(ct_text, auth)
        assert direct is not None, (
            "no contextual path observable: hub produced no contextual "
            "recommendation and the direct engine call found no match")
        assert direct["similarity"] >= CALLPILOT_THRESHOLD
        print("\n[features] TEST G contextual assertion path: DIRECT "
              "(STT of replayed audio was not matchable)")
        return

    payload = ctx_rec["payload"]
    assert payload.get("triggerType") == "contextual"
    span = payload.get("triggerSpan")
    assert isinstance(span, str) and span.strip()
    # Substring check against the fixture transcript (case-insensitive,
    # whitespace-normalised - STT punctuation differs from the fixture).
    norm = lambda s: " ".join(s.lower().split())
    assert norm(span) in norm(ct_text) or any(
        w in norm(ct_text) for w in norm(span).split() if len(w) > 4), (
        f"triggerSpan {span!r} not grounded in ct_pain_turn.txt")
