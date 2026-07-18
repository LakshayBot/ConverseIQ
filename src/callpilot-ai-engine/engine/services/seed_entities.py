"""Hardcoded product / standard seed list for the live-call trie.

Loaded into the trie on AI-engine startup **only** if the .NET server
``/internal/knowledge/entities`` endpoint returns an empty list (e.g. the
operator hasn't uploaded a brochure yet, or the .NET container isn't
reachable).  Once a real document has been ingested the seed list is
overwritten with the GLiNER-extracted entities.

Each entry has:
  - ``entity_text``  the canonical trie key (lowercase, short form)
  - ``entity_type``  one of product | feature | integration | pricing
  - ``document_id``  empty string for seeds — the UI shows "Seed knowledge base"

Source: ``samples/sales-call-script-secure.txt`` and the Secure Meters product
brochure.  Add a row here when a brand is missing from a freshly-deployed
engine and a live call misses a known product.
"""

from __future__ import annotations

from typing import List

# A short description for the seed rows — shown in the product details card
# when the only source is the seed list.  The card reads this verbatim so
# keep it under 200 chars and salesperson-friendly.
SEED_DESCRIPTIONS: dict[str, str] = {
    "prodigy": (
        "Three-phase CT-operated meter with built-in current transformers. "
        "No external CTs or accessories — cable passes directly through the meter."
    ),
    "apex 100": (
        "High-end class 0.2S precision meter for transmission and bulk power "
        "transfer points. Full four-quadrant import/export metering with total "
        "harmonic distortion measurement; ICS DLMS by default."
    ),
    "apex 150": (
        "Class 0.2S precision meter variant in the Apex family. Built for "
        "transmission and bulk power applications with ICS DLMS support."
    ),
    "apex 540": (
        "Top-tier Apex precision meter with enhanced harmonic measurement "
        "and four-quadrant metering. Class 0.2S accuracy."
    ),
    "sprint 210": (
        "Modular three-phase meter with pluggable GPRS and mesh radio modules. "
        "Fully DLMS COSEM compliant — communication modules swap in the field "
        "without factory recalibration."
    ),
    "sprint 350": (
        "Cost-competitive direct-connected three-phase meter in the Sprint "
        "family. DLMS COSEM compliant with pluggable communications."
    ),
    "i-credit 510": (
        "Single-phase meter with slide-out communication module. Field-"
        "replaceable comms — no recalibration, no factory return."
    ),
    "liberty+": (
        "Single-phase token-less smart meter. Encrypted vend codes, no keypad."
    ),
    "liberty 170": (
        "Single-phase token-less smart meter, Liberty family entry tier."
    ),
    "liberty 200": (
        "Single-phase token-less smart meter, mid-tier Liberty family member."
    ),
    "liberty 310": (
        "Three-phase token-less equivalent of Liberty+. Encrypted vend codes "
        "for commercial and small industrial users."
    ),
    "liberty 500": (
        "High-end single-phase token-less smart meter in the Liberty family."
    ),
    "liberty eg4v": (
        "Gas meter with ZigBee communications, part of the Liberty ecosystem."
    ),
    "pipit 500": (
        "In-home display that shows consumption in rupees per hour. ZigBee "
        "connected to the meter."
    ),
    "ecd 210": (
        "GSM/GPRS modem for retrofitting existing installations with cellular "
        "communications."
    ),
    "ecd 310": (
        "GSM/GPRS modem — three-phase variant for industrial installations."
    ),
    "integrator": (
        "Web-based Head-End System (HES) for multi-vendor meter reading. "
        "Supports DLMS and Modbus protocols."
    ),
    "enerlyser": (
        "AT&C loss analysis software — aggregates billing and feeder data to "
        "pinpoint loss pockets in the distribution network."
    ),
}


def _seed(name: str, etype: str = "product") -> dict:
    return {
        "entity_text": name,
        "entity_type": etype,
        "document_id": "",
        "document_ids": [],
        "is_seed": True,
        "description": SEED_DESCRIPTIONS.get(name, ""),
    }


# Order: most-mentioned first, so the most useful matches surface in the UI.
SEED_ENTITIES: List[dict] = [
    _seed("prodigy"),
    _seed("apex 100"),
    _seed("apex 150"),
    _seed("apex 540"),
    _seed("sprint 210"),
    _seed("sprint 350"),
    _seed("i-credit 510"),
    _seed("liberty+"),
    _seed("liberty 170"),
    _seed("liberty 200"),
    _seed("liberty 310"),
    _seed("liberty 500"),
    _seed("liberty eg4v"),
    _seed("pipit 500"),
    _seed("ecd 210"),
    _seed("ecd 310"),
    _seed("integrator"),
    _seed("enerlyser"),
    # Common standards / protocols (feature-type) — frequently mentioned in
    # sales calls when discussing compliance.
    _seed("dlms cosem", etype="integration"),
    _seed("ami", etype="feature"),
    _seed("dlms", etype="integration"),
    _seed("cosem", etype="integration"),
    _seed("ct", etype="feature"),
    _seed("hes", etype="feature"),
    _seed("at&c", etype="feature"),
    _seed("zigbee", etype="integration"),
]


def get_seed_entities() -> List[dict]:
    """Return a fresh copy of :data:`SEED_ENTITIES`."""
    return [dict(e) for e in SEED_ENTITIES]
