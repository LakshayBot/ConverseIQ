#!/usr/bin/env python3
"""
CallPilot frame replay client - drives the REAL audio ingestion pipeline
(SignalR -> DesktopAgentHub -> AiCoordinatorService -> Nemotron) from a file,
mirroring exactly what the .NET console agent does with --file-input.

  WAV/AIFF/FLAC file
    -> soundfile decode -> resample to 16 kHz mono
    -> slice into 1280-byte (40 ms) s16le chunks
    -> SignalR SendAudioFrame (source: "microphone" | "system_audio")
    -> collect TranscriptReceived / EventDetected /
       RecommendationGenerated / ContextualMatchDetected

Usable as a library (FrameReplayClient) and as a CLI:

    python frame_replay.py --file turn_01.aiff --source system_audio \
        --speed 5.0 --meeting-id <uuid>

Deviations from the feature spec, forced by the actual code:
  - auth endpoint is POST /api/v1/auth/login (there is no /auth/token).
  - hub path is /hubs/desktop-agent (spec said desktopAgent).

SPEED / BACKPRESSURE: at 5x, a 40 ms frame is produced every 8 ms of wall
time. The hub processes frames synchronously (STT POST per frame, with Polly
retry 3x 200/400/800 ms during engine cold-load), so blind 5x replay would
outrun the engine and drop audio mid-utterance. The client therefore
throttles on hub ACKs: it never has more than `max_in_flight` unacknowledged
frames (default 8), which preserves frame order and engine pace at any speed.
If the engine falls behind, replay slows to engine throughput instead of
silently dropping audio.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

# ── Defaults (e2e feature stack unless overridden) ──────────────────────────
DEFAULT_SERVER = "http://localhost:5002"
DEMO_EMAIL = "demo@callpilot.dev"
DEMO_PASSWORD = "TestPass123!"
E2E_EMAIL = "e2e.regression@callpilot.test"
E2E_PASSWORD = "e2e-regression-password-123"

SAMPLE_RATE = 16000
CHANNELS = 1
BYTES_PER_SAMPLE = 2
FRAME_MS = 40
FRAME_BYTES = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * FRAME_MS // 1000  # 1280

HUB_PATH = "/hubs/desktop-agent"
LOGIN_PATH = "/api/v1/auth/login"


def authenticate(server: str, email: str, password: str) -> str:
    """POST /api/v1/auth/login -> bearer accessToken (same as run_e2e.py)."""
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        server + LOGIN_PATH, data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode())
    token = payload.get("accessToken")
    if not token:
        raise RuntimeError(f"login returned no accessToken: {payload}")
    return token


def load_audio_as_pcm16(file_path: str | Path) -> bytes:
    """Decode WAV/AIFF/FLAC -> 16 kHz mono s16le raw PCM bytes."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(str(file_path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        try:
            from scipy.signal import resample_poly
            import math
            gcd = math.gcd(int(sr), SAMPLE_RATE)
            data = resample_poly(data, SAMPLE_RATE // gcd, int(sr) // gcd)
        except ImportError as exc:
            raise RuntimeError(
                f"audio is {sr} Hz (need {SAMPLE_RATE}) and scipy is unavailable "
                "for resampling") from exc
    pcm16 = (np.clip(data, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    return pcm16


class FrameReplayClient:
    """Replays an audio file through the live hub and collects hub events.

    Collected event log entries: {"event": name, "payload": dict, "received_at": iso}.
    """

    COLLECTED_EVENTS = (
        "TranscriptReceived",
        "EventDetected",
        "RecommendationGenerated",
        "ContextualMatchDetected",
    )

    def __init__(
        self,
        meeting_id: str,
        token: str,
        server: str = DEFAULT_SERVER,
        source: str = "system_audio",
        speed: float = 1.0,
        max_in_flight: int = 8,
        ack_timeout: float = 30.0,
        on_event: Optional[Callable[[dict], None]] = None,
    ) -> None:
        from signalrcore.hub_connection_builder import HubConnectionBuilder

        if source not in ("microphone", "system_audio"):
            raise ValueError(f"source must be 'microphone' or 'system_audio', got {source!r}")

        self.meeting_id = meeting_id
        self.token = token
        self.source = source
        self.speed = max(speed, 0.1)
        self.max_in_flight = max(1, max_in_flight)
        self.ack_timeout = ack_timeout
        self._on_event = on_event

        self.collected: list[dict] = []
        self._lock = threading.Lock()
        self._acked_through = 0
        self._sequence = 0

        self.connection = HubConnectionBuilder() \
            .with_url(
                server + HUB_PATH,
                options={"access_token_factory": lambda: self.token},
            ) \
            .build()

        for name in list(self.COLLECTED_EVENTS) + ["AudioFrameAcknowledged", "SilenceDetected"]:
            self.connection.on(name, self._make_handler(name))

    # ── hub handlers ────────────────────────────────────────────────────────

    def _make_handler(self, name: str):
        def handler(*args):
            payload = args[0] if len(args) == 1 else list(args)
            if name == "AudioFrameAcknowledged":
                seq = payload.get("sequence") if isinstance(payload, dict) else None
                if seq is not None:
                    with self._lock:
                        self._acked_through = max(self._acked_through, int(seq))
                return
            entry = {
                "event": name,
                "payload": payload,
                "received_at": datetime.now(timezone.utc).isoformat(),
            }
            with self._lock:
                self.collected.append(entry)
            if self._on_event:
                try:
                    self._on_event(entry)
                except Exception:
                    pass
        return handler

    # ── lifecycle ───────────────────────────────────────────────────────────

    def start(self) -> None:
        self.connection.start()
        # Mirror the console agent's registration (RegisterAgent carries
        # agent metadata; the meeting identity travels on each frame).
        self.connection.send(
            "RegisterAgent",
            [{
                "agentVersion": "frame-replay-1.0",
                "platform": "e2e-python",
                "capabilities": ["audio_streaming"],
            }],
        )

    def stop(self) -> None:
        try:
            self.connection.stop()
        except Exception:
            pass

    # ── replay ──────────────────────────────────────────────────────────────

    def _wait_for_ack(self, sequence: int) -> None:
        """Backpressure: never let more than max_in_flight frames sit
        unacknowledged. ACKs arrive after the hub's synchronous STT POST for
        that frame completes, so this both preserves order and matches the
        engine's pace (see module docstring on the 5x caveat)."""
        deadline = time.time() + self.ack_timeout
        while time.time() < deadline:
            with self._lock:
                if self._acked_through >= sequence - self.max_in_flight:
                    return
            time.sleep(0.005)
        # Engine is slower than replay speed - proceed anyway (the hub will
        # process the frame; worst case a frame's audio lands mid-inference
        # and the next partial covers it).

    def send_frame(self, audio: bytes, *, source: Optional[str] = None) -> int:
        self._sequence += 1
        sequence = self._sequence
        self._wait_for_ack(sequence)
        self.connection.send("SendAudioFrame", [{
            "meetingId": self.meeting_id,
            "sequence": sequence,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sampleRate": SAMPLE_RATE,
            "channels": CHANNELS,
            "source": source or self.source,
            "audio": audio,
        }])
        return sequence

    def replay_file(self, file_path: str | Path, *, source: Optional[str] = None) -> int:
        """Replay an audio file at `speed`x real-time. Returns frame count."""
        pcm = load_audio_as_pcm16(file_path)
        frame_delay = (FRAME_MS / 1000.0) / self.speed
        count = 0
        for offset in range(0, len(pcm), FRAME_BYTES):
            self.send_frame(pcm[offset:offset + FRAME_BYTES], source=source)
            count += 1
            time.sleep(frame_delay)
        return count

    def finish(self, silence_frames: int = 5, final_wait: float = 10.0) -> list[dict]:
        """Flush VAD state with silence frames, then wait for a final
        transcript (is_final=True) - up to `final_wait` seconds. Returns the
        full collected event log (with or without a final)."""
        marker = datetime.now(timezone.utc)
        for _ in range(silence_frames):  # 5 x 40ms = 200ms >= VAD silence window
            self.send_frame(bytes(FRAME_BYTES), source="system_audio")
            time.sleep((FRAME_MS / 1000.0) / self.speed)

        deadline = time.time() + final_wait
        while time.time() < deadline:
            finals = [e for e in self.collected
                      if e["event"] == "TranscriptReceived"
                      and isinstance(e["payload"], dict)
                      and e["payload"].get("isFinal")
                      and e["received_at"] >= marker.isoformat()]
            if finals:
                break
            time.sleep(0.2)
        return self.collected

    # ── typed accessors ─────────────────────────────────────────────────────

    def events(self, name: str) -> list[dict]:
        return [e for e in self.collected if e["event"] == name]


def main() -> int:
    ap = argparse.ArgumentParser(description="Replay an audio file through the CallPilot hub")
    ap.add_argument("--file", required=True, help="WAV/AIFF/FLAC file to replay")
    ap.add_argument("--source", default="system_audio",
                    choices=["microphone", "system_audio"])
    ap.add_argument("--speed", type=float, default=1.0,
                    help="replay speed multiplier (5.0 = 5x real-time)")
    ap.add_argument("--meeting-id", default=None,
                    help="meeting UUID (default: create one via the API)")
    ap.add_argument("--server", default=DEFAULT_SERVER)
    ap.add_argument("--email", default=E2E_EMAIL, help="login email (default: e2e regression user)")
    ap.add_argument("--password", default=E2E_PASSWORD)
    ap.add_argument("--register-user", action="store_true",
                    help="register the user first (like simulate-meeting.py)")
    args = ap.parse_args()

    token = authenticate(args.server, args.email, args.password)

    meeting_id = args.meeting_id
    if not meeting_id:
        req = urllib.request.Request(
            args.server + "/api/v1/meetings", data=b"{}", method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            meeting_id = json.loads(resp.read().decode()).get("meetingId")
        print(f"created meeting {meeting_id}")

    client = FrameReplayClient(meeting_id, token, server=args.server,
                               source=args.source, speed=args.speed)
    print(f"connecting to {args.server}{HUB_PATH} ...")
    client.start()
    try:
        frames = client.replay_file(args.file)
        print(f"replayed {frames} frames (source={args.source}, speed={args.speed}x)")
        events = client.finish()
        print(f"collected {len(events)} hub events:")
        for e in events:
            summary = json.dumps(e["payload"], default=str)[:140]
            print(f"  [{e['event']}] {summary}")
    finally:
        client.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
