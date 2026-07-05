import re
from typing import Optional


COMPETITORS = {
    "salesforce": ["Salesforce", "CRM"],
    "hubspot": ["HubSpot", "CRM"],
    "zendesk": ["Zendesk", "Support"],
    "freshdesk": ["Freshdesk", "Support"],
    "intercom": ["Intercom", "Messaging"],
    "zoho": ["Zoho", "CRM"],
    "pipedrive": ["Pipedrive", "CRM"],
    "microsoft dynamics": ["Microsoft Dynamics", "CRM"],
    "sap": ["SAP", "ERP"],
    "oracle": ["Oracle", "Database"],
    "servicenow": ["ServiceNow", "ITSM"],
    "jira": ["Jira", "Project Management"],
    "asana": ["Asana", "Project Management"],
    "monday.com": ["Monday.com", "Project Management"],
    "notion": ["Notion", "Knowledge Base"],
    "confluence": ["Confluence", "Knowledge Base"],
    "slack": ["Slack", "Communication"],
    "teams": ["Microsoft Teams", "Communication"],
    "zoom": ["Zoom", "Video Conferencing"],
    "google meet": ["Google Meet", "Video Conferencing"],
    "gong": ["Gong", "Sales Intelligence"],
    "chorus": ["Chorus", "Sales Intelligence"],
}

PRICING_PATTERNS = [
    r"\b(pric(e|ing)|cost|budget|expensive|cheap|affordable|discount)\b",
    r"\b(how much|what(\s+is|\s+are)?\s+the\s+(pric|cost))\b",
    r"\b(pricing\s+(plan|tier|model|option)|enterprise\s+pricing)\b",
    r"\b(annual|monthly|per\s+seat|per\s+user|license\s+(fee|cost))\b",
]

BUYING_SIGNAL_PATTERNS = [
    r"\b(need\s+this|want\s+this|interested|let.s\s+move\s+forward)\b",
    r"\b(need\s+a\s+better|looking\s+for\s+(a\s+)?(better|new)|evaluating)\b",
    r"\b(send\s+(me|us)\s+(pricing|a\s+proposal|a\s+quote))\b",
    r"\b(when\s+can\s+we\s+start|how\s+soon|timeline|next\s+steps)\b",
    r"\b(would\s+like\s+a\s+demo|schedule\s+a\s+(demo|call))\b",
    r"\b(what\s+would\s+migration\s+look\s+like|how\s+does\s+onboarding\s+work)\b",
    r"\b(sounds?\s+(good|great|interesting|promising|exactly\s+what))\b",
    r"\b(this\s+is\s+(exactly|just)\s+what\s+we)\b",
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


class EventDetector:
    def detect_competitors(self, text: str) -> list[dict]:
        text_lower = text.lower()
        results = []
        for key, (name, category) in COMPETITORS.items():
            if key in text_lower:
                if not any(r["entityName"] == name for r in results):
                    results.append({
                        "eventType": "CompetitorMentioned",
                        "entityName": name,
                        "confidence": 0.95,
                        "category": category,
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

    def detect_buying_signals(self, text: str) -> list[dict]:
        results = []
        for pattern in BUYING_SIGNAL_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                results.append({
                    "eventType": "PositiveBuyingSignal",
                    "entityName": None,
                    "confidence": 0.82,
                })
                break
        return results

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

    def detect_negative_signals(self, text: str) -> Optional[dict]:
        negative_patterns = [
            r"\b(not\s+interested|don'?t\s+need|not\s+for\s+us|not\s+a\s+fit)\b",
            r"\b(happy\s+with\s+current|sticking\s+with|no\s+plans\s+to\s+switch)\b",
        ]
        for pattern in negative_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return {
                    "eventType": "NegativeBuyingSignal",
                    "entityName": None,
                    "confidence": 0.80,
                }
        return None

    def detect_all(self, text: str) -> list[dict]:
        events: list[dict] = []

        events.extend(self.detect_competitors(text))

        pricing = self.detect_pricing(text)
        if pricing:
            events.append(pricing)

        events.extend(self.detect_buying_signals(text))
        events.extend(self.detect_objections(text))

        tech = self.detect_technical_questions(text)
        if tech:
            events.append(tech)

        neg = self.detect_negative_signals(text)
        if neg:
            events.append(neg)

        for event in events:
            event["supportingTranscript"] = text

        return events
