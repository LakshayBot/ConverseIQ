import pytest
from engine.event_engine.event_detector import EventDetector


class TestEventDetector:
    def setup_method(self):
        self.detector = EventDetector()

    def test_detect_competitor_salesforce(self):
        events = self.detector.detect_competitors("We currently use Salesforce for our CRM.")
        assert len(events) >= 1
        assert events[0]["eventType"] == "CompetitorMentioned"
        assert events[0]["entityName"] == "Salesforce"

    def test_detect_competitor_hubspot(self):
        events = self.detector.detect_competitors("We're looking at HubSpot as an alternative.")
        assert len(events) >= 1
        assert events[0]["entityName"] == "HubSpot"

    def test_detect_multiple_competitors(self):
        events = self.detector.detect_competitors(
            "We use Salesforce but we're also evaluating HubSpot and Zendesk."
        )
        assert len(events) >= 3

    def test_no_competitor_in_plain_text(self):
        events = self.detector.detect_competitors("The weather is nice today.")
        assert len(events) == 0

    def test_detect_pricing(self):
        event = self.detector.detect_pricing("What is the pricing model for your enterprise plan?")
        assert event is not None
        assert event["eventType"] == "PricingQuestion"

    def test_detect_pricing_cost(self):
        event = self.detector.detect_pricing("This is getting too expensive for us.")
        assert event is not None

    def test_no_pricing_in_plain_text(self):
        event = self.detector.detect_pricing("Let's schedule a follow-up meeting.")
        assert event is None

    def test_detect_buying_signal_need(self):
        events = self.detector.detect_buying_signals("We need this by next quarter.")
        assert len(events) >= 1
        assert events[0]["eventType"] == "PositiveBuyingSignal"

    def test_detect_buying_signal_demo(self):
        events = self.detector.detect_buying_signals("Can you schedule a demo for our team?")
        assert len(events) >= 1

    def test_detect_objection_price(self):
        events = self.detector.detect_objections("This solution is too expensive for our budget.")
        assert len(events) >= 1
        assert any(e["entityName"] == "Price" for e in events)

    def test_detect_objection_security(self):
        events = self.detector.detect_objections("We have some security concerns about data privacy.")
        assert len(events) >= 1

    def test_detect_objection_migration(self):
        events = self.detector.detect_objections("We're worried about migration costs and lock-in.")
        assert len(events) >= 1

    def test_detect_technical_question(self):
        event = self.detector.detect_technical_questions("Do you support SAML for SSO integration?")
        assert event is not None
        assert event["eventType"] == "TechnicalQuestion"

    def test_detect_technical_kubernetes(self):
        event = self.detector.detect_technical_questions("Can this run on Kubernetes?")
        assert event is not None

    def test_detect_negative_signal(self):
        event = self.detector.detect_negative_signals("We're not interested in switching right now.")
        assert event is not None
        assert event["eventType"] == "NegativeBuyingSignal"

    def test_detect_all_comprehensive(self):
        text = "We currently use Salesforce but pricing has become too expensive. We need a better solution. Do you support SSO?"
        events = self.detector.detect_all(text)

        event_types = [e["eventType"] for e in events]
        assert "CompetitorMentioned" in event_types
        assert "PricingQuestion" in event_types
        assert "Objection" in event_types or "PricingQuestion" in event_types
        assert "PositiveBuyingSignal" in event_types
        assert "TechnicalQuestion" in event_types

    def test_detect_all_no_events(self):
        events = self.detector.detect_all("Uh, let me think about that for a moment.")
        assert len(events) == 0

    def test_supporting_transcript_included(self):
        text = "We use HubSpot."
        events = self.detector.detect_all(text)
        assert len(events) >= 1
        assert events[0]["supportingTranscript"] == text
