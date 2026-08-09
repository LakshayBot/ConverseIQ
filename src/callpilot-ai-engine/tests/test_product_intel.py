"""Tests for the product intelligence research pipeline (product_intel.py)."""

import json

from engine.services.product_intel import (
    _build_search_query,
    _classify_source_type,
    _compute_confidence,
    _is_generic,
    _sanitize_product,
    _sanitize_sources,
    _strip_json_fence,
    _website_host,
    identify_products,
    research_product,
)


def test_build_search_query_contextual():
    q = _build_search_query("prodigy", "secure meters", "smart meter")
    assert "prodigy" in q
    assert "secure meters" in q
    assert "smart meter" in q


def test_build_search_query_minimal():
    q = _build_search_query("apex 100", "", "")
    assert "apex 100" in q
    assert "specifications" in q


def test_classify_source_type():
    assert _classify_source_type("Apex 100 datasheet", "https://x.com/a") == "datasheet"
    assert _classify_source_type("User manual", "https://x.com/a.pdf") == "documentation"
    assert _classify_source_type("Press release", "https://news.example.com") == "publication"
    assert _classify_source_type("Random page", "https://example.com") == "search"


def test_sanitize_sources_ranks_official_first():
    results = [
        {"title": "Random aggregator", "url": "https://shop.example.com/prodigy", "content": "abc"},
        {"title": "Secure Meters Prodigy page", "url": "https://secure-meters.com/prodigy", "content": "def"},
    ]
    sources = _sanitize_sources(results, manufacturer="Secure Meters")
    assert sources[0]["source_type"] == "official"
    assert sources[0]["url"].endswith("secure-meters.com/prodigy")
    assert len(sources) == 2


def test_strip_json_fence():
    raw = '```json\n{"canonicalName": "Prodigy"}\n```'
    assert _strip_json_fence(raw) == '{"canonicalName": "Prodigy"}'
    assert _strip_json_fence('prefix {"a": 1} suffix') == '{"a": 1}'


def test_sanitize_product_coerces_malformed():
    raw = {
        "canonicalName": "Prodigy",
        "manufacturer": "Secure Meters",
        "keyFeatures": ["one", "", "two"],
        "keySpecifications": {"Phase": "Three-phase", "Accuracy": "0.2s"},
        "useCases": "not a list",
        "description": "  A great meter  ",
    }
    p = _sanitize_product(raw)
    assert p["canonicalName"] == "Prodigy"
    assert p["keyFeatures"] == ["one", "two"]
    assert "Phase: Three-phase" in p["keySpecifications"]
    assert p["useCases"] == ["not a list"]
    assert p["description"] == "A great meter"


def test_sanitize_product_handles_missing():
    p = _sanitize_product({})
    assert p["canonicalName"] == ""
    assert p["manufacturer"] is None
    assert p["keyFeatures"] == []


def test_compute_confidence():
    product = {"manufacturer": "Secure Meters", "description": "desc", "keyFeatures": ["a"]}
    assert _compute_confidence(product, 3) == 0.9
    assert _compute_confidence(product, 0) == 0.3
    assert _compute_confidence({}, 0) == 0.0


def test_research_product_no_tavily_key(monkeypatch):
    """Without TAVILY_API_KEY the pipeline fails gracefully - never raises."""
    monkeypatch.setenv("TAVILY_API_KEY", "")
    from engine.services import competitor_intel

    monkeypatch.setattr(competitor_intel, "TAVILY_API_KEY", "")
    result = None
    try:
        import asyncio

        result = asyncio.run(research_product("prodigy", llm_client=lambda p: json.dumps({"canonicalName": "prodigy"})))
    except Exception as exc:  # pragma: no cover
        result = {"status": "failed", "error": str(exc)}
    assert result["status"] == "failed"
    assert result["sources"] == []


# ── Product identification (ingest-time) ────────────────────────────────────

def test_is_generic():
    assert _is_generic("ami")
    assert _is_generic("smart metering")
    assert _is_generic("three phase")
    assert _is_generic("meter")
    assert _is_generic("dlms")
    assert not _is_generic("prodigy")
    assert not _is_generic("sprint 210")
    assert not _is_generic("i-credit 510")


def test_website_host():
    assert _website_host("https://secure-meters.com/products") == "secure-meters.com"
    assert _website_host("http://www.example.org") == "example.org"
    assert _website_host("") == ""


def test_identify_products_llm_filters_generics():
    async def run():
        text = "We make the Prodigy, PRODIGY meter, Apex 100 and Sprint 210. AMI and DLMS compliance."
        async def llm(prompt):
            return json.dumps({
                "entities": [
                    {"canonical": "Prodigy", "aliases": ["prodigy meter"], "entityType": "PRODUCT", "confidence": 0.96, "evidence": "We make the Prodigy"},
                    {"canonical": "Apex 100", "aliases": [], "entityType": "PRODUCT", "confidence": 0.94, "evidence": "Apex 100"},
                    {"canonical": "AMI", "aliases": [], "entityType": "FEATURE", "confidence": 0.8, "evidence": "AMI compliance"},
                    {"canonical": "meter", "aliases": [], "entityType": "PRODUCT", "confidence": 0.5, "evidence": "meter"},
                ]
            })
        return await identify_products(text, company_name="Secure Meters", llm_client=llm)

    import asyncio
    entities = asyncio.run(run())
    by_name = {e["canonical"]: e for e in entities}
    assert by_name["Prodigy"]["entityType"] == "product"
    assert by_name["Prodigy"]["confidence"] == 0.96
    assert by_name["Prodigy"]["aliases"] == ["prodigy meter"]
    assert by_name["Apex 100"]["entityType"] == "product"
    # Generic backstop: "meter" mislabeled PRODUCT is demoted to OTHER.
    assert by_name["meter"]["entityType"] == "other"
    # Non-product entities are kept with their category.
    assert by_name["AMI"]["entityType"] == "feature"


def test_identify_products_fail_open():
    async def run():
        async def llm(prompt):
            raise RuntimeError("boom")
        return await identify_products("Prodigy is a meter.", company_name="X", llm_client=llm)

    import asyncio
    assert asyncio.run(run()) == []


def test_build_search_query_with_company():
    q = _build_search_query("sprint 210", manufacturer="", category="", boost="", company="Secure Meters")
    assert q.startswith("Secure Meters")
    assert "sprint 210" in q


def test_sanitize_sources_prefers_website_domain():
    results = [
        {"title": "Sprint 210 page", "url": "https://secure-meters.com/sprint-210", "content": "abc"},
        {"title": "Random shop", "url": "https://shop.example.com/sprint", "content": "def"},
    ]
    sources = _sanitize_sources(results, manufacturer="", website="https://secure-meters.com")
    assert sources[0]["source_type"] == "official"
    assert sources[0]["domain"] == "secure-meters.com"
