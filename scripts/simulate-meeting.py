#!/usr/bin/env python3
"""
CallPilot AI — End-to-End Meeting Simulation

Simulates a live sales meeting by feeding a sample conversation through the
full CallPilot pipeline: Transcripts → Event Detection → Recommendations.

Usage:
    python3 scripts/simulate-meeting.py

Requirements:
    - CallPilot Server running on http://localhost:5000
    - AI Engine running on http://localhost:8001
    - PostgreSQL running (for persistence)
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

SERVER = os.environ.get("CALLPILOT_SERVER", "http://localhost:5000")
AI_ENGINE = os.environ.get("CALLPILOT_AI", "http://localhost:8001")
EMAIL = "demo@callpilot.dev"
PASSWORD = "TestPass123!"

# ── helpers ──────────────────────────────────────────────────────────────────

def api(method, path, body=None, token=None):
    url = f"{SERVER}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  API ERROR {e.code}: {body[:200]}")
        return None


def ai_events(text):
    url = f"{AI_ENGINE}/api/v1/ai/events"
    data = json.dumps({"text": text}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return {"events": [], "count": 0}


def process_text(token, meeting_id, text):
    """Send text through the full pipeline: event detection + recommendation generation."""
    data = json.dumps({"text": text}).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    url = f"{SERVER}/api/v1/meetings/{meeting_id}/process"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  Process error {e.code}: {body[:200]}")
        return None


def upload_document(token, filepath):
    import http.client
    import mimetypes

    boundary = "----FormBoundary7MA4YWxkTrZu0gW"
    filename = os.path.basename(filepath)
    content_type = mimetypes.guess_type(filepath)[0] or "application/octet-stream"

    with open(filepath, "rb") as f:
        file_data = f.read()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{SERVER}/api/v1/knowledge/upload",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  Upload error {e.code}: {e.read().decode()[:200]}")
        return None


def color(text, code):
    colors = {
        "green": "\033[92m", "blue": "\033[94m", "yellow": "\033[93m",
        "red": "\033[91m", "cyan": "\033[96m", "bold": "\033[1m",
        "reset": "\033[0m",
    }
    return f"{colors.get(code, '')}{text}{colors['reset']}"


def divider(char="─", width=70):
    print(color(char * width, "cyan"))


# ── conversation script ─────────────────────────────────────────────────────

CONVERSATION = [
    ("Customer", "Hi Alex, thanks for taking the time today. We've been using Salesforce for about 3 years now, but I'll be honest — the pricing has started to become a real concern for us."),
    ("Salesperson", "Thanks for sharing that, Sarah. Pricing is actually one of the top reasons companies reach out to us. Can you tell me more about what's changed?"),
    ("Customer", "Well, we just crossed 50 users and our annual bill jumped to nearly $90,000. For a company our size, that's starting to feel really expensive. We're evaluating alternatives right now — we've also been looking at HubSpot."),
    ("Salesperson", "That makes total sense. Many of our customers were in the exact same position. Let me ask — besides pricing, what are the key things you need from a CRM solution?"),
    ("Customer", "We need solid pipeline management, good reporting, and something our reps will actually use. Our team finds Salesforce really complex. Also, I need something that integrates with our existing tools — we use Slack heavily and we have Jira for our engineering team."),
    ("Salesperson", "Those are all areas where we can help. On the complexity point — our customers typically see 40% higher adoption rates because the interface is much simpler. And we have native Slack and Jira integrations."),
    ("Customer", "That's interesting. What about security? We're SOC 2 and our security team will need to review anything we bring in. Do you support SAML for SSO?"),
    ("Salesperson", "Great question. Yes, we're SOC 2 Type II certified and we fully support SAML, OAuth, and RBAC. We can set up a call with our security team to walk through the details."),
    ("Customer", "Okay, that's reassuring. What would migration look like? I'm a bit worried about switching costs and data migration from Salesforce. We have a lot of historical data in there."),
    ("Salesperson", "Migration typically takes about a week. We have a dedicated migration team that handles the entire process, including data mapping and validation. Most customers are fully transitioned within 5 business days with zero data loss."),
    ("Customer", "That sounds promising. Can you send me pricing for a team of around 55 users? And what would the timeline look like if we wanted to move forward?"),
    ("Salesperson", "Absolutely, I'll send you a detailed proposal today. For 55 users, our Professional plan would be $79 per user per month, which comes out to about $52,000 annually — that's roughly 40% less than what you're paying now. And we can typically have you up and running within 2 weeks."),
    ("Customer", "Wow, that's a significant savings. We need this soon — our Salesforce renewal is coming up in about 6 weeks. Can we schedule a demo for my team next week?"),
    ("Salesperson", "I'd love to. How about Tuesday at 2pm? I'll bring our solutions engineer so we can walk through the technical questions as well."),
    ("Customer", "Tuesday works. Send me the invite and the pricing proposal. I'm excited to see what you can do."),
]


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print()
    print(color("╔══════════════════════════════════════════════════════════════════════╗", "bold"))
    print(color("║        CallPilot AI — End-to-End Meeting Simulation                  ║", "bold"))
    print(color("╚══════════════════════════════════════════════════════════════════════╝", "bold"))
    print()
    print(f"  Server:   {SERVER}")
    print(f"  AI Engine: {AI_ENGINE}")
    print()

    # ── Step 1: Check services ───────────────────────────────────────────────
    divider()
    print(color("STEP 1: Checking services", "bold"))
    divider()

    try:
        resp = urllib.request.urlopen(f"{SERVER}/health", timeout=5)
        print(f"  {color('✓', 'green')} Server healthy: {json.loads(resp.read())['status']}")
    except Exception as e:
        print(f"  {color('✗', 'red')} Server not reachable: {e}")
        print(f"  Start with: dotnet run --project src/CallPilot.Server/CallPilot.Server.Api")
        sys.exit(1)

    try:
        resp = urllib.request.urlopen(f"{AI_ENGINE}/health", timeout=5)
        data = json.loads(resp.read())
        print(f"  {color('✓', 'green')} AI Engine healthy (model_loaded={data.get('model_loaded')})")
    except Exception as e:
        print(f"  {color('✗', 'red')} AI Engine not reachable: {e}")
        print(f"  Start with: cd src/callpilot-ai-engine && source .venv/bin/activate && uvicorn engine.main:app --port 8001")
        sys.exit(1)

    # ── Step 2: Auth ─────────────────────────────────────────────────────────
    divider()
    print(color("STEP 2: Authentication", "bold"))
    divider()

    # Try login first, if fails, register then login
    login_resp = api("POST", "/api/v1/auth/login", {"email": EMAIL, "password": PASSWORD})
    if login_resp is None:
        print(f"  Registering new user: {EMAIL}")
        api("POST", "/api/v1/auth/register", {"email": EMAIL, "password": PASSWORD, "confirmPassword": PASSWORD})
        login_resp = api("POST", "/api/v1/auth/login", {"email": EMAIL, "password": PASSWORD})

    token = login_resp["accessToken"]
    print(f"  {color('✓', 'green')} Authenticated as {EMAIL}")

    # ── Step 3: Upload knowledge documents ────────────────────────────────────
    divider()
    print(color("STEP 3: Uploading knowledge base", "bold"))
    divider()

    sample_dir = os.path.join(os.path.dirname(__file__), "..", "samples")
    docs = ["product-overview.md", "salesforce-battle-card.md", "objection-handling-guide.md"]

    for doc in docs:
        path = os.path.join(sample_dir, doc)
        if os.path.exists(path):
            result = upload_document(token, path)
            if result:
                status = result.get("processingStatus", "unknown")
                print(f"  {color('✓', 'green')} {doc} → {status}")
            else:
                print(f"  {color('✗', 'red')} {doc} — upload failed")
        else:
            print(f"  {color('✗', 'yellow')} {doc} — file not found (run from repo root)")

    time.sleep(2)  # Wait for embeddings to be generated

    # ── Step 4: Create meeting ───────────────────────────────────────────────
    divider()
    print(color("STEP 4: Creating meeting", "bold"))
    divider()

    meeting = api("POST", "/api/v1/meetings", token=token)
    meeting_id = meeting["meetingId"]
    print(f"  {color('✓', 'green')} Meeting created: {meeting_id[:8]}... (Status: {meeting['status']})")

    # ── Step 5: Simulate conversation ────────────────────────────────────────
    divider()
    print(color("STEP 5: Simulating live conversation", "bold"))
    divider()
    print()

    total_events = 0
    total_recommendations = 0

    for i, (speaker, text) in enumerate(CONVERSATION, 1):
        speaker_color = "blue" if speaker == "Salesperson" else "yellow"
        print(f"  [{i:2d}] {color(speaker, speaker_color)}: {text[:90]}{'...' if len(text) > 90 else ''}")

        # Full pipeline: event detection + recommendation generation
        result = process_text(token, meeting_id, text)

        if result:
            for evt in result.get("events", []):
                total_events += 1
                event_type = evt["eventType"]
                entity = evt.get("entityName", "")
                conf = evt["confidence"]
                entity_str = f" ({entity})" if entity else ""
                print(f"       {color('⚡ EVENT', 'green')}: {event_type}{entity_str} (confidence: {conf:.0%})")

            for rec in result.get("recommendations", []):
                total_recommendations += 1
                title = rec.get("title", "Recommendation")
                print(f"       {color('💡 REC', 'cyan')}: {title}")

        # Small delay to simulate real-time
        time.sleep(0.3)

    # ── Step 6: Fetch persisted results ──────────────────────────────────────
    divider()
    print()
    divider()
    print(color("STEP 6: Results from server", "bold"))
    divider()

    events_list = api("GET", f"/api/v1/meetings/{meeting_id}/transcripts", token=token)
    recs_list = api("GET", f"/api/v1/meetings/{meeting_id}/recommendations", token=token)

    if recs_list:
        print(f"\n  {color('Recommendations Generated:', 'bold')} {len(recs_list)}")
        print()
        for rec in recs_list:
            print(f"  ┌─ {color(rec['title'], 'bold')}")
            print(f"  │  Type: {rec['type']}")
            print(f"  │  Confidence: {rec['confidence']:.0%}")
            print(f"  │  Provider: {rec.get('provider', 'rule-based')}")

            summary = rec['summary'][:200]
            print(f"  │  Summary: {summary}")
            print(f"  └─ References: {', '.join(rec.get('references', []))}")
            print()

    # ── Step 7: Diagnostics ──────────────────────────────────────────────────
    divider()
    print(color("STEP 7: Meeting diagnostics", "bold"))
    divider()

    diag = api("GET", f"/api/v1/diagnostics/meetings/{meeting_id}")
    if diag:
        print(f"  Events detected:  {diag.get('eventCount', 0)}")
        print(f"  Recommendations:  {diag.get('recommendationCount', 0)}")
        print(f"  Transcripts:      {diag.get('transcriptCount', 0)}")
        print(f"  Retries:          {diag.get('retryCount', 0)}")
        by_type = diag.get("eventsByType", {})
        if by_type:
            print(f"  Events by type:")
            for etype, count in by_type.items():
                print(f"    - {etype}: {count}")

    # ── Summary ──────────────────────────────────────────────────────────────
    divider()
    print()
    print(color("══════════════════════════════════════════════════════════════════════", "bold"))
    print(f"  {color('SIMULATION COMPLETE', 'green')}")
    print(f"  Meeting ID:      {meeting_id}")
    print(f"  Sentences:       {len(CONVERSATION)}")
    print(f"  Events:          {total_events}")
    print(f"  Recommendations: {len(recs_list) if recs_list else 0}")
    print(f"  Dashboard URL:   {color(SERVER.replace('5000', '3000'), 'cyan')}/meeting/{meeting_id}")
    print(color("══════════════════════════════════════════════════════════════════════", "bold"))
    print()


if __name__ == "__main__":
    main()
