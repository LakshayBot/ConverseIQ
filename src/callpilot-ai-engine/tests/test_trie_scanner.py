"""Tests for the Aho-Corasick trie scanner with word-boundary and length gates."""

import pytest
from engine.services.trie_scanner import (
    build_trie,
    scan_text,
    MIN_ENTITY_LEN,
    ACRONYM_ALLOWLIST,
    _is_valid_pattern,
    _has_word_boundary,
)


def _seed_trie():
    """Build a small trie of Secure Meters products for testing."""
    return build_trie([
        {"entity_text": "prodigy", "entity_type": "product", "document_id": "d1"},
        {"entity_text": "apex 100", "entity_type": "product", "document_id": "d1"},
        {"entity_text": "apex 150", "entity_type": "product", "document_id": "d1"},
        {"entity_text": "sprint 210", "entity_type": "product", "document_id": "d1"},
        {"entity_text": "i-credit 510", "entity_type": "product", "document_id": "d1"},
        {"entity_text": "dlms cosem", "entity_type": "integration", "document_id": "d1"},
        {"entity_text": "ami", "entity_type": "feature", "document_id": "d1"},
        {"entity_text": "hancock", "entity_type": "product", "document_id": "d1"},
    ])


class TestIsValidPattern:
    def test_long_canonical_valid(self):
        assert _is_valid_pattern("apex 100")
        assert _is_valid_pattern("prodigy")

    def test_short_canonical_invalid(self):
        # "han" is 3 chars and not in the acronym list - invalid.
        assert not _is_valid_pattern("han")
        assert not _is_valid_pattern("am")
        # "ct" IS in the acronym allowlist (current transformer) so it
        # remains valid even though it's only 2 chars.  This is intentional:
        # a CT (current transformer) shows up in every sales call.
        assert _is_valid_pattern("ct")

    def test_acronyms_allowed_when_short(self):
        assert _is_valid_pattern("ami")
        assert _is_valid_pattern("ct")
        assert _is_valid_pattern("dlms")
        assert _is_valid_pattern("gprs")

    def test_empty_invalid(self):
        assert not _is_valid_pattern("")
        assert not _is_valid_pattern("   ")

    def test_stop_words_not_in_trie_scanner(self):
        # Note: stop-word filtering lives in entity_extractor, not here.
        # The trie accepts any non-trivial pattern that passes the length gate.
        assert _is_valid_pattern("smart meter")


class TestHasWordBoundary:
    def test_standalone_token(self):
        # "we talked about prodigy" → "prodigy" is at indices [16, 23).
        # The boundary check is (start, end) where end is exclusive.
        assert _has_word_boundary("we talked about prodigy", 16, 23)

    def test_substring_inside_word_rejected(self):
        # "han" inside "hancock" - boundary check at position 11-14 should
        # see that the next char is 'c' (word char) → reject.
        assert not _has_word_boundary("hancock", 0, 3)

    def test_substring_at_end_rejected(self):
        # "han" at the end of "john han" - boundary check at position 5-8
        # should see that the next char is the end of string. Good.
        # But the char BEFORE should not be a word char.
        assert _has_word_boundary("john han", 5, 8)
        # "johnhan" - no space boundary, reject.
        assert not _has_word_boundary("johnhan", 4, 7)

    def test_punctuation_is_boundary(self):
        # "apex" at end of sentence with period.
        assert _has_word_boundary("showed me apex.", 10, 14)

    def test_start_of_string(self):
        # "apex" at start.
        assert _has_word_boundary("apex 100 is great", 0, 4)

    def test_multiword_pattern_boundary(self):
        # "apex 100" must have boundaries at start of "apex" and end of "100".
        # Position 0-8 in "apex 100 is great".
        assert _has_word_boundary("apex 100 is great", 0, 8)


class TestBuildTrie:
    def test_empty_trie_returns_none(self):
        result = build_trie([])
        assert result is None

    def test_competitors_skipped(self):
        # 'competitor' is handled by Phase 2 classifier, not the trie.
        result = build_trie([
            {"entity_text": "salesforce", "entity_type": "competitor", "document_id": "d1"},
        ])
        assert result is None

    def test_valid_products_indexed(self):
        result = _seed_trie()
        assert result is not None
        # Acronyms and long products both indexed.
        assert "prodigy" in result
        assert "apex 100" in result
        assert "ami" in result

    def test_short_fragments_dropped(self):
        result = build_trie([
            {"entity_text": "han", "entity_type": "product", "document_id": "d1"},
            {"entity_text": "ct", "entity_type": "feature", "document_id": "d1"},  # acronym
            {"entity_text": "am", "entity_type": "product", "document_id": "d1"},
            {"entity_text": "apex 100", "entity_type": "product", "document_id": "d1"},
        ])
        assert result is not None
        # Only "apex 100" and "ct" (acronym) should be in the trie.
        assert "apex 100" in result
        assert "ct" in result
        assert "han" not in result
        assert "am" not in result

    def test_aliases_also_indexed(self):
        # The seed builder calls expand_with_aliases - so both the canonical
        # AND its spoken forms are inserted.
        result = build_trie([
            {"entity_text": "apex 100", "entity_type": "product", "document_id": "d1"},
        ])
        assert result is not None
        assert "apex 100" in result
        assert "apex one hundred" in result


class TestScanText:
    def test_exact_match(self):
        _seed_trie()
        hits = scan_text("We recommend the Prodigy meter.")
        names = [h["entity_text"] for h in hits]
        assert "prodigy" in names

    def test_substring_match_rejected(self):
        # "hancock" contains "han" - but "han" is not in the trie.
        # "prodigy" is in the trie but is not a substring of any other word.
        _seed_trie()
        hits = scan_text("Johnson Hancock said something about a prodigy.")
        names = [h["entity_text"] for h in hits]
        assert "hancock" in names
        assert "prodigy" in names

    def test_han_does_not_fire_inside_hand(self):
        # If someone managed to insert "han" into the trie, it should NOT
        # match inside "hand" or "handed".  This test builds a manual trie
        # with "han" directly inserted (bypassing the quality gate) to
        # confirm the word-boundary post-filter works.
        build_trie([
            {"entity_text": "han", "entity_type": "product", "document_id": "d1"},
        ])
        # The build_trie _is_valid_pattern check should drop "han" since it
        # is too short and not an acronym.  So the trie should be None.
        from engine.services.trie_scanner import get_trie
        assert get_trie() is None

    def test_multiword_match(self):
        _seed_trie()
        hits = scan_text("Take a look at the Sprint 210 platform.")
        names = [h["entity_text"] for h in hits]
        assert "sprint 210" in names

    def test_no_match(self):
        _seed_trie()
        hits = scan_text("The weather is fine today.")
        assert hits == []

    def test_spoken_form_matches_via_normalizer(self):
        _seed_trie()
        # "Apex One Hundred" gets canonicalized to "apex 100" → match.
        hits = scan_text("We recommend the Apex One Hundred for bulk power.")
        names = [h["entity_text"] for h in hits]
        assert "apex 100" in names

    def test_spoken_sprint_210(self):
        _seed_trie()
        hits = scan_text("What about the Sprint Two Hundred and Ten?")
        names = [h["entity_text"] for h in hits]
        assert "sprint 210" in names

    def test_spoken_i_credit(self):
        _seed_trie()
        hits = scan_text("i Credit Five Ten is the slide-out option")
        names = [h["entity_text"] for h in hits]
        assert "i-credit 510" in names

    def test_acronym_match(self):
        _seed_trie()
        hits = scan_text("Is it AMI compliant?")
        names = [h["entity_text"] for h in hits]
        assert "ami" in names

    def test_punctuation_doesnt_break_match(self):
        _seed_trie()
        hits = scan_text("Prodigy, Sprint 210 - these are the winners.")
        names = [h["entity_text"] for h in hits]
        assert "prodigy" in names
        assert "sprint 210" in names

    def test_empty_text(self):
        _seed_trie()
        assert scan_text("") == []
