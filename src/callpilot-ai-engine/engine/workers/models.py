from enum import Enum
from typing import Any

from pydantic import BaseModel


class WorkerStatus(str, Enum):
    IDLE = "idle"
    PROCESSING = "processing"
    ERROR = "error"


class WorkerTask(BaseModel):
    task_id: str
    task_type: str
    meeting_id: str
    payload: dict[str, Any]
    provider_config: dict[str, Any] | None = None


class WorkerResult(BaseModel):
    task_id: str
    success: bool
    result: dict[str, Any] | None = None
    error: str | None = None
    duration_ms: float = 0.0
    confidence: float | None = None
