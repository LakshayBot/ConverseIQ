"""Tests for the spoken-name text normalizer."""

import pytest
from engine.services.text_normalizer import (
    numbers_to_digits,
    canonicalize,
    aliases_for,
    expand_with_aliases,
    CANONICAL_TO_ALIASES,
)


class TestNumbersToDigits:
    def test_hundred_collapse(self):
        assert numbers_to_digits("five hundred") == "500"

    def test_hundred_and_collapse(self):
        assert numbers_to_digits("five hundred and forty") == "540"

    def test_hundred_spelled_then_digit(self):
        assert numbers_to_digits("one hundred 50") == "100 50"

    def test_thousand_collapse(self):
        assert numbers_to_digits("two thousand and ten") == "2010"

    def test_bare_digit_words(self):
        assert numbers_to_digits("five ten") == "5 10"

    def test_no_numbers(self):
        assert numbers_to_digits("Prodigy meter") == "Prodigy meter"

    def test_empty(self):
        assert numbers_to_digits("") == ""


class TestCanonicalize:
    def test_apex_one_hundred(self):
        assert canonicalize("Apex One Hundred is great") == "apex 100 is great"

    def test_apex_one_hundred_digit(self):
        # "Apex 100" stays "apex 100" (already canonical, the alias for it is itself)
        assert canonicalize("Apex 100 is great") == "apex 100 is great"

    def test_sprint_two_hundred_ten(self):
        assert canonicalize("Sprint Two Hundred Ten") == "sprint 210"

    def test_sprint_two_hundred_and_ten(self):
        assert canonicalize("Sprint Two Hundred and Ten") == "sprint 210"

    def test_landis_plus_gyr(self):
        result = canonicalize("We use Landis Plus Gyr currently")
        assert "landis+ gyr" in result
        assert "Landis" not in result.replace("landis+ gyr", "")

    def test_liberty_plus(self):
        assert canonicalize("Liberty Plus is our entry tier") == "liberty+ is our entry tier"

    def test_dlms_cosem_from_delisk(self):
        # "Delisk compliant" should map to "dlms cosem"
        result = canonicalize("Our Delisk compliant solution")
        assert "dlms cosem" in result

    def test_i_credit_spoken(self):
        result = canonicalize("i Credit Five Ten is slide-out")
        assert "i-credit 510" in result

    def test_pipit_five_hundred(self):
        assert canonicalize("Pipit Five Hundred") == "pipit 500"

    def test_acronyms_preserved(self):
        # Acronyms that are below MIN_ENTITY_LEN stay as-is.
        assert canonicalize("AMI is required") == "ami is required"

    def test_multiple_brands_in_one_string(self):
        result = canonicalize("Apex One Hundred and Sprint Two Hundred Ten")
        assert "apex 100" in result
        assert "sprint 210" in result

    def test_case_insensitive(self):
        assert canonicalize("APEX ONE HUNDRED") == "apex 100"
        assert canonicalize("apex one hundred") == "apex 100"

    def test_no_match_passthrough(self):
        assert canonicalize("hello world") == "hello world"

    def test_empty(self):
        assert canonicalize("") == ""


class TestExpandWithAliases:
    def test_known_canonical_returns_all_aliases(self):
        aliases = expand_with_aliases("apex 100")
        # Must include canonical + at least the spoken form
        assert "apex 100" in aliases
        assert "apex one hundred" in aliases

    def test_unknown_canonical_returns_itself(self):
        assert expand_with_aliases("random brand xyz") == {"random brand xyz"}

    def test_liberty_plus(self):
        aliases = expand_with_aliases("liberty+")
        assert "liberty+" in aliases
        assert "liberty plus" in aliases

    def test_i_credit(self):
        aliases = expand_with_aliases("i-credit 510")
        assert "i-credit 510" in aliases
        assert "i credit 510" in aliases


class TestAliasesFor:
    def test_apex_100(self):
        aliases = aliases_for("apex 100")
        assert "apex 100" in aliases
        assert "apex one hundred" in aliases

    def test_unknown_returns_empty(self):
        assert aliases_for("completely unknown brand") == []


class TestCanonicalToAliases:
    """Sanity-check the table is non-empty and well-formed."""

    def test_table_has_expected_brands(self):
        # The Secure Meters product portfolio must all be in the table.
        for required in [
            "prodigy", "apex 100", "apex 150", "apex 540",
            "sprint 210", "sprint 350",
            "i-credit 510", "liberty+", "liberty 170", "liberty 200",
            "liberty 310", "liberty 500", "liberty eg4v",
            "pipit 500", "ecd 210", "ecd 310", "integrator", "enerlyser",
        ]:
            assert required in CANONICAL_TO_ALIASES, f"Missing canonical: {required}"

    def test_all_aliases_lowercase(self):
        for canonical, aliases in CANONICAL_TO_ALIASES.items():
            for alias in aliases:
                assert alias == alias.lower(), f"Alias {alias!r} in {canonical!r} is not lowercase"
