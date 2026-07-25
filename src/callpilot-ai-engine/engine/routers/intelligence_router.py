"""
Intelligence WebSocket endpoint — surfaces live conversation-intelligence
cards (competitors, objections, pricing, technical questions, product matches)
to the desktop app during a recording session.

Endpoints
─────────
  WS /ws/intelligence/{session_id}  — long-lived connection per session. The
                                     .NET Gateway (or, eventually, an internal
                                     pipeline) pushes transcript deltas into
                                     the engine, which runs the event detector
                                     + recommendation engine and emits cards
                                     over this socket to the desktop UI.

Protocol
────────
  Server → Client (on connect):
      {"type": "ready", "session_id": "<uuid>"}

  Server → Client (heartbeat):
      {"type": "ping", "ts": <unix_ms>}

  Server → Client (card):
      {"type": "card",
       "card": {
         "type": "competitor_detected" | "objection" | "buying_signal" |
                 "product_match" | "pricing_discussion" | "technical_question",
         "title": "...",
         "body": "...",
         "severity": "high" | "medium" | "low",
         "chunks": ["..."]
       }}

  Client → Server (heartbeat response):
      {"type": "pong"}

  Close:
      WebSocketDisconnect — desktop stops the recording session and the
      engine cleans up any in-flight detector state for this session_id.

Current scope
─────────────
This router is intentionally minimal: it accepts the connection, sends a
`ready` ack, keeps the socket alive with periodic pings, and answers pongs.
Real card emission is wired separately by the .NET Gateway → engine ingest
pipeline; once that lands, this endpoint will fan out incoming events to
the subscribed clients per session_id.
"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()

# Per-session active sockets. The gateway pushes transcript deltas into
# the engine via a separate ingest endpoint; here we just track which
# desktop clients are listening so we can fan out cards.
_SESSION_SOCKETS: dict[str, set[WebSocket]] = {}
_SESSIONS_LOCK = asyncio.Lock()

# Heartbeat cadence — desktop hook ignores unknown types, so this is
# harmless overhead and keeps proxies/firewalls from idling the socket.
HEARTBEAT_INTERVAL_SEC = 20


async def _register(session_id: str, ws: WebSocket) -> None:
    async with _SESSIONS_LOCK:
        _SESSION_SOCKETS.setdefault(session_id, set()).add(ws)


async def _unregister(session_id: str, ws: WebSocket) -> None:
    async with _SESSIONS_LOCK:
        sockets = _SESSION_SOCKETS.get(session_id)
        if not sockets:
            return
        sockets.discard(ws)
        if not sockets:
            _SESSION_SOCKETS.pop(session_id, None)


async def broadcast_card(session_id: str, card: dict) -> int:
    """Fan-out entry point used by the ingest pipeline.

    Returns the number of clients the card was delivered to. Safe to call
    with an unknown session_id (returns 0).
    """
    payload = {"type": "card", "card": card}
    delivered = 0
    async with _SESSIONS_LOCK:
        sockets = list(_SESSION_SOCKETS.get(session_id, ()))
    for ws in sockets:
        try:
            await ws.send_json(payload)
            delivered += 1
        except Exception as exc:
            logger.warning("intelligence WS send failed for %s: %s", session_id, exc)
    return delivered


@router.websocket("/ws/intelligence/{session_id}")
async def ws_intelligence(ws: WebSocket, session_id: str) -> None:
    await ws.accept()
    await _register(session_id, ws)
    logger.info("intelligence WS connected: session=%s", session_id)

    try:
        await ws.send_json({"type": "ready", "session_id": session_id})
    except Exception as exc:
        logger.warning("intelligence WS failed to send ready: %s", exc)
        await _unregister(session_id, ws)
        return

    async def heartbeat() -> None:
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
                await ws.send_json({"type": "ping", "ts": int(time.time() * 1000)})
        except (asyncio.CancelledError, WebSocketDisconnect):
            return
        except Exception as exc:
            logger.debug("intelligence WS heartbeat stopped: %s", exc)
            return

    hb_task = asyncio.create_task(heartbeat())

    try:
        while True:
            # We don't expect any inbound traffic beyond optional pongs;
            # receive_text keeps the socket alive (auto-replies to ping
            # control frames at the protocol level) and surfaces client
            # disconnects.
            msg = await ws.receive_text()
            if msg and '"type":"pong"' in msg:
                # Heartbeat ack — no-op.
                continue
    except WebSocketDisconnect:
        logger.info("intelligence WS disconnected: session=%s", session_id)
    except Exception as exc:
        logger.exception("intelligence WS unhandled error: %s", exc)
    finally:
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass
        await _unregister(session_id, ws)
