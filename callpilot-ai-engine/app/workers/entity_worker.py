import re
import logging

from app.models.models import AiTask, AiResponse
from app.workers.base import BaseWorker

logger = logging.getLogger(__name__)

COMPETITORS = [
    "salesforce", "hubspot", "sap", "oracle", "microsoft", "google",
    "aws", "azure", "servicenow", "adobe", "zoho", "pipedrive",
    "slack", "zoom", "atlassian", "jira", "confluence", "datadog",
    "new relic", "dynatrace", "splunk", "sumo logic", "elastic",
    "mongodb", "redis", "databricks", "snowflake", "teradata",
    "ibm", "dell", "cisco", "vmware", "red hat", "hashicorp",
]

PRODUCT_KEYWORDS = {
    "crm": ["salesforce", "hubspot", "zoho", "pipedrive", "freshsales"],
    "cloud": ["aws", "azure", "gcp", "google cloud", "oracle cloud"],
    "observability": ["datadog", "dynatrace", "splunk", "new relic", "grafana"],
    "database": ["mongodb", "postgresql", "mysql", "snowflake", "databricks"],
    "security": ["crowdstrike", "palo alto", "okta", "cyberark", "splunk"],
}


class EntityWorker(BaseWorker):
    async def execute(self, task: AiTask) -> AiResponse:
        segments = task.payload.get("segments", [])
        text = " ".join(s.get("text", "") for s in segments).lower()

        detected_competitors = []
        for comp in COMPETITORS:
            if comp in text:
                detected_competitors.append({
                    "name": comp.title(),
                    "confidence": 0.95,
                    "mentions": text.count(comp),
                })

        detected_products = []
        for category, products in PRODUCT_KEYWORDS.items():
            for product in products:
                if product in text:
                    detected_products.append({
                        "name": product.title(),
                        "category": category,
                        "confidence": 0.90,
                        "mentions": text.count(product),
                    })

        return AiResponse(
            task_id=task.task_id,
            success=True,
            duration_ms=0,
            confidence=0.90,
            result={
                "competitors": detected_competitors,
                "products": detected_products,
                "text_length": len(text),
            },
        )
