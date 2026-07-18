"""Spoken-name normalization for the trie scanner and seed entities.

Speech-to-text frequently spells numbers and brand punctuation.  The knowledge
base (and seed list) is keyed on canonical short forms ("apex 100"), but the
transcript arrives as natural speech ("apex one hundred", "apex 1 hundred").
This module maps both directions so trie matching and alias generation stay
in sync.

The table is intentionally small and explicit.  Each entry has:
  - ``canonical``: the trie key, what GLiNER extracted and what gets stored
  - ``aliases``:    every spoken / typed form we want to match back

To extend: add a row, run pytest, restart the engine.
"""

from __future__ import annotations

import re
from typing import Dict, List, Set

# ──────────────────────────────────────────────────────────────────────────────
# Spoken digits — keep small and explicit.  Anything not in this table is left
# alone by the number rewriter (we don't try to be clever with arbitrary
# ordinals like "two thousand and fifteen").
# ──────────────────────────────────────────────────────────────────────────────
_SPOKEN_DIGITS: Dict[str, str] = {
    "zero": "0", "oh": "0", "nil": "0",
    "one": "1", "won": "1",
    "two": "2", "to": "2", "too": "2",
    "three": "3",
    "four": "4", "for": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8", "ate": "8",
    "nine": "9", "niner": "9",
    "ten": "10", "tenn": "10",
    "eleven": "11",
    "twelve": "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen": "15",
    "sixteen": "16",
    "seventeen": "17",
    "eighteen": "18",
    "nineteen": "19",
    "twenty": "20",
    "thirty": "30",
    "forty": "40",
    "fifty": "50",
    "sixty": "60",
    "seventy": "70",
    "eighty": "80",
    "ninety": "90",
}
# "hundred" and "thousand" are not standalone digits — they are multipliers
# handled by `_collapse_hundred_thousand` below.

# After "hundred" the optional "and <tail>" is constrained to short numbers
# (< 100) so that "hundred and sprint two hundred ten" doesn't get its
# "hundred and sprint" portion collapsed into garbage.
_TAIL_NUM_RE = (
    r"(\d+|" + "|".join(sorted(_SPOKEN_DIGITS.keys(), key=len, reverse=True)) + r")"
)
_HUNDRED_RE = re.compile(r"\b(\d+|\w+)\s+hundred(?:\s+and\s+(" + _TAIL_NUM_RE + r"))?\b", re.IGNORECASE)
_THOUSAND_RE = re.compile(r"\b(\d+|\w+)\s+thousand(?:\s+and\s+(" + _TAIL_NUM_RE + r"))?\b", re.IGNORECASE)
_SPOKEN_NUM_RE = re.compile(r"\b(" + "|".join(sorted(_SPOKEN_DIGITS.keys(), key=len, reverse=True)) + r")\b", re.IGNORECASE)


def _word_to_int(w: str) -> int | None:
    w = w.lower()
    if w.isdigit():
        return int(w)
    if w in _SPOKEN_DIGITS:
        return int(_SPOKEN_DIGITS[w])
    return None


def _is_small_number(w: str) -> bool:
    """True if w represents a number below 100 — used to gate the optional
    "and <tail>" portion of "hundred and forty" so it doesn't greedily eat
    the next phrase (e.g. "hundred and sprint two hundred ten").
    """
    n = _word_to_int(w)
    return n is not None and 0 <= n < 100


def _collapse_hundred_thousand(text: str) -> str:
    """Rewrite "five hundred and forty" → "540", "two thousand ten" → "2010".

    The "and <tail>" portion only matches when tail is a small number.  This
    stops the regex from greedy-matching across phrase boundaries like
    "hundred and sprint two hundred ten".
    """
    def _hm(m: re.Match[str]) -> str:
        head = _word_to_int(m.group(1)) or 0
        tail_str = m.group(2)
        if tail_str and _is_small_number(tail_str):
            tail = _word_to_int(tail_str) or 0
        else:
            tail = 0
        return str(head * 100 + tail)
    def _tm(m: re.Match[str]) -> str:
        head = _word_to_int(m.group(1)) or 0
        tail_str = m.group(2)
        if tail_str and _is_small_number(tail_str):
            tail = _word_to_int(tail_str) or 0
        else:
            tail = 0
        return str(head * 1000 + tail)
    text = _THOUSAND_RE.sub(_tm, text)
    text = _HUNDRED_RE.sub(_hm, text)
    return text


def _rewrite_spoken_digits(text: str) -> str:
    """Rewrite bare spoken digits ("five ten") to numeric form ("5 10")."""
    def _rep(m: re.Match[str]) -> str:
        return _SPOKEN_DIGITS[m.group(1).lower()]
    return _SPOKEN_NUM_RE.sub(_rep, text)


def numbers_to_digits(text: str) -> str:
    """Top-level: collapse "five hundred forty" → "540", "one hundred" → "100"."""
    text = _collapse_hundred_thousand(text)
    text = _rewrite_spoken_digits(text)
    # Collapse whitespace
    return re.sub(r"\s+", " ", text).strip()


# ──────────────────────────────────────────────────────────────────────────────
# Brand-specific alias table.  Two roles:
#   1. CANONICAL_TO_ALIASES: when inserting a product into the trie, also
#      insert every alias (so "apex 100" can be matched by speech
#      "apex one hundred").
#   2. ALIAS_TO_CANONICAL: when scanning text, rewrite each alias in the
#      spoken transcript back to its canonical form before running the trie.
# ──────────────────────────────────────────────────────────────────────────────
CANONICAL_TO_ALIASES: Dict[str, List[str]] = {
    # Secure Meters product portfolio (see samples/sales-call-script-secure.txt)
    "prodigy": ["prodigy"],
    "apex 100": ["apex 100", "apex one hundred", "apex 1 hundred", "apex a hundred"],
    "apex 150": ["apex 150", "apex one fifty", "apex 1 fifty", "apex a fifty"],
    "apex 540": ["apex 540", "apex five forty", "apex 5 40", "apex five four zero"],
    "sprint 210": ["sprint 210", "sprint two hundred ten", "sprint two hundred and ten",
                    "sprint 2 hundred 10", "sprint two ten", "sprint two hundred 10"],
    "sprint 350": ["sprint 350", "sprint three fifty", "sprint 3 fifty"],
    "i-credit 510": ["i-credit 510", "i credit 510", "icredit 510",
                      "i-credit five ten", "i credit five ten",
                      "i-credit 5 10", "i credit 5 10", "icredit 5 10",
                      "i-credit five 10", "i credit five 10"],
    "liberty+": ["liberty+", "liberty plus", "liberty +"],
    "liberty 170": ["liberty 170", "liberty one seventy", "liberty 1 70"],
    "liberty 200": ["liberty 200", "liberty two hundred", "liberty 2 hundred"],
    "liberty 310": ["liberty 310", "liberty three ten", "liberty 3 10"],
    "liberty 500": ["liberty 500", "liberty five hundred"],
    "liberty eg4v": ["liberty eg4v", "liberty eg 4v", "liberty eg four v", "eg4v"],
    "pipit 500": ["pipit 500", "pipit five hundred"],
    "ecd 210": ["ecd 210", "ecd two ten"],
    "ecd 310": ["ecd 310", "ecd three ten"],
    "integrator": ["integrator"],
    "enerlyser": ["enerlyser", "energiser", "energizer"],

    # Competitor brand spellings (for trie matching only — still classified as
    # competitor, but consistent surface form helps the live call)
    "landis+ gyr": ["landis+ gyr", "landis plus gyr", "landis and gyr",
                    "landis n gyr", "landis & gyr"],
    "hpl": ["hpl"],

    # Standards / protocols often spoken in meetings
    "dlms cosem": ["dlms cosem", "dlms-cosem", "delisk", "delisk compliant",
                   "dlms cosum"],
    "ami": ["ami"],
    "ct": ["ct"],
    "hes": ["hes"],
    "ics": ["ics"],
    "at&c": ["at&c", "at and c", "at & c"],
    "gsm": ["gsm"],
    "gprs": ["gprs"],
    "rms": ["rms"],
    "dlms": ["dlms"],
    "cosem": ["cosem"],
}


def _build_alias_index() -> Dict[str, str]:
    """Return a dict from every alias → its canonical form (lowercased)."""
    idx: Dict[str, str] = {}
    for canonical, aliases in CANONICAL_TO_ALIASES.items():
        for alias in aliases:
            idx[alias.lower()] = canonical.lower()
    return idx


_ALIAS_TO_CANONICAL: Dict[str, str] = _build_alias_index()


def aliases_for(canonical: str) -> List[str]:
    """Return every alias (including the canonical itself) for *canonical*."""
    canonical_lc = canonical.lower()
    return [a for a, c in _ALIAS_TO_CANONICAL.items() if c == canonical_lc]


def canonicalize(text: str) -> str:
    """Rewrite spoken aliases in *text* to their canonical short form.

    Example:
        "we evaluated the Apex One Hundred and Sprint Two Hundred Ten"
        → "we evaluated the apex 100 and sprint 210"

    Order matters: longer aliases first so "apex one hundred" beats "hundred".
    Aliases are looked up against the original text so entries like
    "i credit five ten" are recognised before number-rewriting can split
    "five ten" into "5 10".  Any leftover numbers are then collapsed.
    """
    if not text:
        return text

    # Build a single regex from all alias keys, sorted longest-first.
    keys = sorted(_ALIAS_TO_CANONICAL.keys(), key=len, reverse=True)
    if keys:
        pattern = re.compile(
            r"\b(" + "|".join(re.escape(k) for k in keys) + r")\b",
            re.IGNORECASE,
        )

        def _rep(m: re.Match[str]) -> str:
            return _ALIAS_TO_CANONICAL[m.group(1).lower()]

        text = pattern.sub(_rep, text)

    # After alias substitution, collapse any remaining spoken numbers so
    # "five hundred" → "500" etc.
    text = numbers_to_digits(text)
    return text


def expand_with_aliases(canonical_text: str) -> Set[str]:
    """Return the canonical entry plus every alias for it.

    Used by ``build_trie`` to insert every spoken form of a product, so the
    automaton can match transcripts without any runtime normalizer call.
    """
    canonical_lc = canonical_text.strip().lower()
    if canonical_lc in CANONICAL_TO_ALIASES:
        out = {canonical_lc}
        for alias in CANONICAL_TO_ALIASES[canonical_lc]:
            out.add(alias.lower())
        return out
    return {canonical_lc}
