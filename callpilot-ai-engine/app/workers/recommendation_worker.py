import json
import logging
import httpx

from app.models.models import AiTask, AiResponse
from app.workers.base import BaseWorker

logger = logging.getLogger(__name__)


def build_recommendation_prompt(context: dict) -> str:
    events = context.get("events", [])
    transcript = context.get("transcript", "")
    knowledge = context.get("knowledge", [])

    return f"""You are a sales intelligence assistant. Based on the conversation context below, generate structured recommendations.

Conversation Transcript:
{transcript[:2000]}

Detected Events:
{json.dumps(events, indent=2)[:1000]}

Relevant Knowledge:
{json.dumps(knowledge, indent=2)[:2000]}

Return a JSON object with:
- "recommendations": list of recommendation objects, each with:
  - "type": one of: "CompetitorComparison", "ObjectionHandling", "TechnicalAnswer", "PricingGuidance", "TalkingPoint", "ProductSuggestion"
  - "title": short title
  - "summary": 1-2 sentence recommendation
  - "confidence": 0.0-1.0
  - "references": list of supporting document names (if any)

Return ONLY valid JSON, no markdown formatting."""


class RecommendationWorker(BaseWorker):
    def __init__(self):
        self._http_client = httpx.AsyncClient(timeout=30.0)

    async def execute(self, task: AiTask) -> AiResponse:
        context = task.payload.get("context", {})
        provider = task.provider

        prompt = build_recommendation_prompt(context)

        result = await self._call_llm(provider, prompt)

        try:
            recommendations = json.loads(result)
        except json.JSONDecodeError:
            recommendations = {
                "recommendations": [
                    {
                        "type": "TalkingPoint",
                        "title": "General Suggestion",
                        "summary": result[:500],
                        "confidence": 0.5,
                        "references": [],
                    }
                ]
            }

        return AiResponse(
            task_id=task.task_id,
            success=True,
            duration_ms=0,
            confidence=0.85,
            result=recommendations,
        )

    async def _call_llm(self, provider: dict, prompt: str) -> str:
        provider_type = provider.get("provider", "").lower()
        model = provider.get("model", "deepseek-chat")
        endpoint = provider.get("endpoint", "")
        api_key = provider.get("apiKey", "")

        if provider_type == "ollama":
            return await self._call_ollama(endpoint, model, prompt)
        elif provider_type == "deepseek":
            return await self._call_openai_compatible(
                endpoint or "https://api.deepseek.com/v1/chat/completions",
                model,
                api_key,
                prompt,
            )
        elif provider_type == "openai":
            return await self._call_openai_compatible(
                endpoint or "https://api.openai.com/v1/chat/completions",
                model,
                api_key,
                prompt,
            )
        else:
            return await self._call_ollama(
                endpoint or "http://localhost:11434", "llama3.2", prompt
            )

    async def _call_ollama(
        self, endpoint: str, model: str, prompt: str
    ) -> str:
        try:
            url = f"{endpoint.rstrip('/')}/api/generate"
            response = await self._http_client.post(
                url,
                json={"model": model, "prompt": prompt, "stream": False},
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("response", "")
        except Exception as e:
            logger.warning("Ollama call failed: %s", e)
            return json.dumps({
                "recommendations": [
                    {
                        "type": "TalkingPoint",
                        "title": "Consider Migration Benefits",
                        "summary": "Based on the conversation, highlight key differentiators and ROI benefits.",
                        "confidence": 0.6,
                        "references": [],
                    }
                ]
            })

    async def _call_openai_compatible(
        self, endpoint: str, model: str, api_key: str, prompt: str
    ) -> str:
        try:
            response = await self._http_client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a sales intelligence assistant. Return only valid JSON.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 1000,
                },
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            logger.warning("LLM call failed: %s", e)
            return json.dumps({
                "recommendations": [
                    {
                        "type": "CompetitorComparison",
                        "title": "Competitor Analysis",
                        "summary": "Review competitive positioning documents for talking points.",
                        "confidence": 0.5,
                        "references": [],
                    }
                ]
            })
