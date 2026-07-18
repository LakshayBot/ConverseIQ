"""Tests for the live-call event detector.

The detector combines:
  * Aho-Corasick trie matches from the seed list / uploaded documents
  * Regex-based pricing / buying-signal / objection / technical-question /
    negative-signal detection

These tests focus on the parts that don't require GLiNER (which is the
ingest-time extractor — tested separately in test_entity_extractor).

The old `detect_competitors` API was replaced by the trie.  Tests that
referenced the old API have been removed.
"""

import pytest
from engine.event_engine.event_detector import EventDetector
from engine.services.trie_scanner import build_trie
from engine.services.seed_entities import get_seed_entities


@pytest.fixture(autouse=True)
def _seed_trie():
    """Populate the trie with the Secure Meters product portfolio before
    every test, so trie-based detection is deterministic.
    """
    build_trie(get_seed_entities())
    yield
    build_trie([])  # reset


class TestRegexDetectors:
    def setup_method(self):
        self.detector = EventDetector()

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


class TestTrieEntityDetection:
    def setup_method(self):
        self.detector = EventDetector()

    def test_prodigy_detected(self):
        events = self.detector.detect_trie_entities("We recommend Prodigy for that use case.")
        names = [e["entityName"] for e in events]
        assert "prodigy" in names

    def test_apex_100_detected(self):
        events = self.detector.detect_trie_entities("Look at the Apex 100 for transmission.")
        names = [e["entityName"] for e in events]
        assert "apex 100" in names

    def test_apex_one_hundred_spoken(self):
        # The spoken form is canonicalized before matching.
        events = self.detector.detect_trie_entities("Apex One Hundred handles that.")
        names = [e["entityName"] for e in events]
        assert "apex 100" in names

    def test_sprint_210_spoken(self):
        events = self.detector.detect_trie_entities("What about the Sprint Two Hundred and Ten?")
        names = [e["entityName"] for e in events]
        assert "sprint 210" in names

    def test_dlms_cosem_from_delisk(self):
        events = self.detector.detect_trie_entities("Our solution is fully Delisk compliant.")
        names = [e["entityName"] for e in events]
        assert "dlms cosem" in names

    def test_han_does_not_fire(self):
        # Aho-Corasick substring would match "han" inside "hand" — but the
        # trie has a min-length gate that drops "han" at insert time, so it
        # can't even get into the trie.  Verify "hand" alone does not fire.
        events = self.detector.detect_trie_entities("Please hand the brochure to the customer.")
        names = [e["entityName"] for e in events]
        assert "han" not in names

    def test_john_hancock_no_false_positive(self):
        # "hancock" is a long word.  Even if it were in the trie, the
        # word-boundary check would only fire for the standalone "hancock".
        events = self.detector.detect_trie_entities("Johnson Hancock signed off on it.")
        names = [e["entityName"] for e in events]
        # No "han" — that was the original bug.  No false "apex 100" or other
        # unrelated brand either.
        assert "han" not in names
        assert "prodigy" not in names
        assert "apex 100" not in names

    def test_duplicate_dedup(self):
        # Same product mentioned twice in the same text — event should
        # appear once, not twice.
        events = self.detector.detect_trie_entities(
            "Prodigy is great. We really like Prodigy."
        )
        names = [e["entityName"] for e in events]
        assert names.count("prodigy") == 1

    def test_supporting_transcript_set(self):
        events = self.detector.detect_all("Prodigy is the right fit.")
        # Every event should carry the supporting transcript.
        for e in events:
            assert e.get("supportingTranscript") == "Prodigy is the right fit."


class TestDetectAllComprehensive:
    def setup_method(self):
        self.detector = EventDetector()

    def test_pricing_buying_tech(self):
        text = "What is the pricing model? We need a better solution. Do you support SSO?"
        events = self.detector.detect_all(text)
        types = [e["eventType"] for e in events]
        assert "PricingQuestion" in types
        assert "PositiveBuyingSignal" in types
        assert "TechnicalQuestion" in types

    def test_no_events_in_plain_text(self):
        events = self.detector.detect_all("Uh, let me think about that for a moment.")
        # No trie matches and no regex matches in filler text.
        assert events == []


class TestSecureMetersSalesScript:
    """End-to-end integration test against the Secure Meters sales script.

    Asserts that every product mentioned in the script is detected (at least
    once across the script), and that no false-positive products (like "han")
    are emitted.
    """

    SCRIPTS = [
        # (mention-spoken, canonical-key) — what we expect the detector to find
        ("prodigy is a three phase CT operated meter", "prodigy"),
        ("apex 100 is the high end precision meter", "apex 100"),
        ("apex one hundred handles that for you", "apex 100"),
        ("sprint 210 with pluggable GPRS", "sprint 210"),
        ("sprint two hundred and ten for residential", "sprint 210"),
        ("i credit five ten is the slide out module", "i-credit 510"),
        ("i-credit 510 is single phase", "i-credit 510"),
        ("liberty+ for token less single phase", "liberty+"),
        ("liberty 310 is the three phase equivalent", "liberty 310"),
        ("pipit 500 is the in home display", "pipit 500"),
        ("enerlyser is the AT&C loss tool", "enerlyser"),
        ("fully dlms cosem compliant", "dlms cosem"),
        ("delisk compliant solution", "dlms cosem"),
        # NOTE: competitors (Landis+Gyr, etc.) intentionally NOT here — they
        # are not in the trie.  The trie_scanner.build_trie() skips
        # entity_type=="competitor" because competitors go through the
        # Phase-2 competitor_orchestrator (heuristic + LLM + Tavily).
        # The normalizer has aliases for them, but they only fire via the
        # orchestrator path, which is exercised by a different test.
    ]

    def setup_method(self):
        self.detector = EventDetector()

    def test_every_script_line_detects_the_brand(self):
        failures = []
        for spoken, expected in self.SCRIPTS:
            events = self.detector.detect_trie_entities(spoken)
            names = [e["entityName"] for e in events]
            if expected not in names:
                failures.append((spoken, expected, names))
        assert not failures, (
            "These script lines failed to detect their product:\n"
            + "\n".join(f"  '{s}' expected '{e}', got {n}" for s, e, n in failures)
        )

    def test_no_han_in_misc_transcript(self):
        # The full script as a single blob should not contain 'han' as a
        # product.  (It might appear in conversational words like 'hand',
        # 'hands', etc., but the trie's min-length gate drops it.)
        full = " ".join(line for line, _ in self.SCRIPTS)
        full += " please hand the brochure to the customer"
        events = self.detector.detect_trie_entities(full)
        names = [e["entityName"] for e in events]
        assert "han" not in names

    def test_product_event_has_confidence(self):
        events = self.detector.detect_trie_entities("Prodigy handles that.")
        prodigy = [e for e in events if e["entityName"] == "prodigy"]
        assert len(prodigy) == 1
        assert prodigy[0]["confidence"] > 0
        assert prodigy[0]["category"] == "product"
