import re
import time
from typing import Optional

from engine.services.trie_scanner import scan_text  # Aho-Corasick trie

# Rolling debounce window: the same (eventType, entity) mentioned again for
# the same meeting within this window is suppressed — no new event, no new card.
DEBOUNCE_WINDOW_SECONDS = 60.0
_debounce: dict[tuple, float] = {}

PRICING_PATTERNS = [
    r"\b(pric(e|ing)|cost|budget|expensive|cheap|affordable|discount)\b",
    r"\b(how much|what(\s+is|\s+are)?\s+the\s+(pric|cost))\b",
    r"\b(pricing\s+(plan|tier|model|option)|enterprise\s+pricing)\b",
    r"\b(annual|monthly|per\s+seat|per\s+user|license\s+(fee|cost))\b",
]

OBJECTION_PATTERNS = {
    "Price": [r"\b(too\s+expensive|over\s+budget|can'?t\s+afford|costs?\s+too\s+much)\b"],
    "Security": [r"\b(security\s+concern|data\s+privacy|compliance|SOC2|GDPR|HIPAA)\b"],
    "Migration": [r"\b(migration\s+(concern|worry|issue|problem)|switching\s+cost|lock.?in)\b"],
    "Integration": [r"\b(integrat(e|ion)\s+(concern|worry|issue)|doesn'?t\s+(work|integrate))\b"],
    "Timeline": [r"\b(not\s+ready|too\s+soon|next\s+quarter|next\s+year|revisit(ing)?)\b"],
    "Competitor": [r"\b(already\s+using|happy\s+with|contracted\s+with|committed\s+to)\b"],
}

TECHNICAL_PATTERNS = [
    r"\b(do\s+you\s+support|does\s+it\s+support|is\s+there\s+support\s+for)\b",
    r"\b(api|integration|SSO|SAML|OAuth|LDAP|RBAC|audit\s+log)\b",
    r"\b(kubernetes|docker|cloud|on.?prem(ise)?|hybrid)\b",
    r"\b(uptime|SLA|latency|throughput|scal(e|ing))\b",
]

# Map trie entity_type → event type
# 'competitor' is NOT here - competitors are handled dynamically via Phase 2 classifier
TRIE_TYPE_EVENT_MAP = {
    "product": "ProductMentioned",
    "integration": "TechnicalQuestion",
    "pricing": "PricingDiscussion",
    "feature": "TechnicalQuestion",
}


class EventDetector:
    def detect_trie_entities(self, text: str) -> list[dict]:
        """Scan text through Aho-Corasick trie for dynamic entities.

        Returns events for competitors, products, integrations, pricing, features
        found via the trie (built from uploaded documents + seed competitors).
        """
        hits = scan_text(text)
        results: list[dict] = []
        seen: set[tuple[str, str]] = set()
        for hit in hits:
            etext = hit["entity_text"]
            etype = hit["entity_type"]
            event_type = TRIE_TYPE_EVENT_MAP.get(etype, "ProductMentioned")
            key = (event_type, etext)
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "eventType": event_type,
                "entityName": etext,
                "confidence": 0.92,
                "category": etype,
            })
        return results

    def detect_pricing(self, text: str) -> Optional[dict]:
        for pattern in PRICING_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return {
                    "eventType": "PricingQuestion",
                    "entityName": None,
                    "confidence": 0.88,
                }
        return None

    def detect_objections(self, text: str) -> list[dict]:
        results = []
        for objection_type, patterns in OBJECTION_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    if not any(r.get("entityName") == objection_type for r in results):
                        results.append({
                            "eventType": "Objection",
                            "entityName": objection_type,
                            "confidence": 0.85,
                        })
        return results

    def detect_technical_questions(self, text: str) -> Optional[dict]:
        for pattern in TECHNICAL_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return {
                    "eventType": "TechnicalQuestion",
                    "entityName": None,
                    "confidence": 0.84,
                }
        return None

    def detect_all(self, text: str, meeting_id: Optional[str] = None) -> list[dict]:
        events: list[dict] = []

        # Dynamic entity detection via Aho-Corasick trie (replaces hardcoded 28 competitors)
        events.extend(self.detect_trie_entities(text))

        pricing = self.detect_pricing(text)
        if pricing:
            events.append(pricing)

        events.extend(self.detect_objections(text))

        tech = self.detect_technical_questions(text)
        if tech:
            events.append(tech)

        for event in events:
            event["supportingTranscript"] = text

        # Suppress repeats of the same trigger within the window. The key is
        # scoped per meeting so parallel meetings don't interfere, and
        # unscoped (meeting_id=None) callers share a global window.
        now = time.monotonic()
        key_base = (meeting_id or "global",)
        fresh: list[dict] = []
        for event in events:
            key = key_base + (event["eventType"], event.get("entityName") or "")
            last = _debounce.get(key)
            if last is not None and now - last < DEBOUNCE_WINDOW_SECONDS:
                continue
            _debounce[key] = now
            fresh.append(event)

        # Occasional prune so the dict never grows unbounded.
        if len(_debounce) > 512:
            for k in [k for k, v in _debounce.items() if now - v >= DEBOUNCE_WINDOW_SECONDS]:
                del _debounce[k]

        return fresh
