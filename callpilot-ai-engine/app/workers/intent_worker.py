import re
import logging

from app.models.models import AiTask, AiResponse
from app.workers.base import BaseWorker

logger = logging.getLogger(__name__)

PRICING_PATTERNS = [
    r"how much", r"what.*(?:cost|price|pricing|rate)", r"pricing.*(?:plan|tier|model)",
    r"budget", r"expensive", r"cheap", r"affordable", r"cost.*(?:effective|saving)",
    r"roi", r"subscription", r"license.*(?:cost|fee)", r"monthly.*(?:fee|cost)",
    r"annual.*(?:fee|cost)", r"per.*(?:user|seat|month)",
]

OBJECTION_PATTERNS = [
    r"too.*(?:expensive|costly|much)", r"not.*(?:sure|convinced|interested)",
    r"happy.*(?:with|using)", r"current.*(?:solution|vendor|provider)",
    r"locked.*in", r"vendor.*lock.?in", r"migration.*(?:risk|difficult|hard)",
    r"implementation.*(?:time|effort|complex)", r"training.*(?:time|cost)",
    r"security.*(?:concern|issue|risk)", r"compliance.*(?:issue|problem)",
    r"support.*(?:quality|slow|bad)", r"no.*(?:budget|approval|authority)",
    r"evaluating.*(?:other|alternative)", r"not.*(?:ready|now|yet)",
]

BUYING_SIGNAL_PATTERNS = [
    r"need.*(?:this|it|solution)", r"when.*(?:can|start|begin|available)",
    r"send.*(?:pricing|quote|proposal|contract)", r"demo.*(?:request|schedule|book)",
    r"proof.*of.*concept", r"poc", r"trial.*(?:access|version|account)",
    r"migration.*(?:plan|process|strategy)", r"implementation.*(?:plan|timeline)",
    r"next.*(?:step|phase|stage)", r"timeline", r"deadline",
]

TIMELINE_PATTERNS = [
    r"by.*(?:next|this|end)", r"q[1-4]", r"quarter", r"this.*(?:year|month|week)",
    r"before.*(?:end|year)", r"launch.*(?:date|timeline|plan)",
    r"release.*(?:date|schedule)", r"roll.?out",
]

FEATURE_REQUEST_PATTERNS = [
    r"can.*(?:you|it).*(?:do|support|integrate|handle)", r"need.*(?:feature|capability|functionality)",
    r"support.*(?:for|integration)", r"api.*(?:access|integration|support)",
    r"single.?sign.?on", r"sso", r"role.?based", r"audit.*(?:log|trail)",
    r"reporting", r"dashboard", r"analytics", r"custom.*(?:report|dashboard)",
]


class IntentWorker(BaseWorker):
    async def execute(self, task: AiTask) -> AiResponse:
        segments = task.payload.get("segments", [])
        text = " ".join(s.get("text", "") for s in segments).lower()

        events = []

        for pattern in PRICING_PATTERNS:
            if re.search(pattern, text):
                events.append({
                    "type": "PricingDiscussion",
                    "confidence": 0.85,
                    "matched": pattern,
                })
                break

        for pattern in OBJECTION_PATTERNS:
            if re.search(pattern, text):
                events.append({
                    "type": "ObjectionRaised",
                    "confidence": 0.80,
                    "matched": pattern,
                })
                break

        for pattern in BUYING_SIGNAL_PATTERNS:
            if re.search(pattern, text):
                events.append({
                    "type": "PositiveBuyingSignal",
                    "confidence": 0.75,
                    "matched": pattern,
                })
                break

        for pattern in TIMELINE_PATTERNS:
            if re.search(pattern, text):
                events.append({
                    "type": "TimelineDiscussion",
                    "confidence": 0.80,
                    "matched": pattern,
                })
                break

        for pattern in FEATURE_REQUEST_PATTERNS:
            if re.search(pattern, text):
                events.append({
                    "type": "FeatureRequest",
                    "confidence": 0.75,
                    "matched": pattern,
                })
                break

        return AiResponse(
            task_id=task.task_id,
            success=True,
            duration_ms=0,
            confidence=0.85 if events else 0.0,
            result={"events": events, "event_count": len(events)},
        )
