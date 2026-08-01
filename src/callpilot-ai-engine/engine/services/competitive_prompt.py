"""Competitive intelligence prompt builder.

Generates sharp, specific talking points for sales reps during live calls.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TalkingPointsResult:
    talking_points: list[str] = field(default_factory=list)
    confidence: str = "low"  # "high" | "medium" | "low"


async def generate_talking_points(
    competitor: str,
    transcript_snippet: str,
    your_chunks: list[str],
    web_summary: str,
    company_name: str = "",
    llm_client=None,
) -> TalkingPointsResult:
    """Generate competitive talking points for a live sales call.

    Args:
        competitor: The competing product/company name
        transcript_snippet: What the prospect said
        your_chunks: Relevant product knowledge chunks from pgvector
        web_summary: Summary of what's known about the competitor
        company_name: Your company name
        llm_client: Optional async LLM callable
    """
    # ── Determine confidence ───────────────────────────────────────────
    has_web = bool(web_summary and len(web_summary) > 100)
    has_your = bool(your_chunks)

    if has_web and has_your:
        confidence = "high"
    elif has_web or has_your:
        confidence = "medium"
    else:
        confidence = "low"

    # ── Build prompt ───────────────────────────────────────────────────
    company_context = f" for {company_name}" if company_name else ""

    your_context = (
        "\n".join(f"- {c[:300]}" for c in your_chunks[:3])
        if your_chunks
        else "No product documentation available."
    )

    if llm_client is None:
        # Rule-based fallback - no LLM available
        points = _build_fallback_points(
            competitor, transcript_snippet, your_chunks, web_summary
        )
        return TalkingPointsResult(talking_points=points, confidence="low")

    prompt = (
        f"You are a real-time sales coach{company_context}."
        f" Your job is to help the sales rep respond instantly to competitive "
        f"challenges during a live call. Be sharp, specific, and honest. "
        f"Never fabricate features or capabilities. If uncertain, say so.\n\n"
        f"The prospect just said: \"{transcript_snippet}\"\n\n"
        f"They are comparing us to: {competitor}\n\n"
        f"Our product's relevant information:\n{your_context}\n\n"
        f"What is known about {competitor}:\n{web_summary or 'No public information available.'}\n\n"
        f"Give the sales rep exactly 2-3 talking points they can use "
        f"RIGHT NOW in the conversation.\n\n"
        f"Format:\n"
        f"- Each point max 20 words\n"
        f"- Lead with our strength, not their weakness\n"
        f"- If there is a genuine gap where {competitor} is better, "
        f"acknowledge it and redirect to our strengths\n"
        f"- Bullet points only, no preamble"
    )

    try:
        response = await llm_client(prompt)
        points = _parse_bullet_points(response)
        if not points:
            points = _build_fallback_points(
                competitor, transcript_snippet, your_chunks, web_summary
            )
            confidence = "low"
        return TalkingPointsResult(talking_points=points, confidence=confidence)
    except Exception as exc:
        logger.warning("LLM talking points generation failed: %s", exc)
        points = _build_fallback_points(
            competitor, transcript_snippet, your_chunks, web_summary
        )
        return TalkingPointsResult(talking_points=points, confidence="low")


def _parse_bullet_points(text: str) -> list[str]:
    """Extract bullet points from LLM response."""
    points = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if line.startswith("-") or line.startswith("*") or line.startswith("•"):
            cleaned = line.lstrip("- *•.").strip()
            if len(cleaned) > 5:
                points.append(cleaned)
    return points[:3]


def _build_fallback_points(
    competitor: str,
    transcript_snippet: str,
    your_chunks: list[str],
    web_summary: str,
) -> list[str]:
    """Template-based fallback when LLM is unavailable."""
    points = []

    if your_chunks:
        first_chunk = your_chunks[0][:150] if your_chunks[0] else ""
        if first_chunk:
            points.append(f"Highlight our key capabilities: {first_chunk[:100]}...")

    if web_summary and len(web_summary) > 50:
        points.append(f"Key context about {competitor}: {web_summary[:120]}...")

    points.append(
        f"The prospect mentioned '{competitor}' -"
        f" ask what specific features they need and address those directly."
    )

    return points[:3]
