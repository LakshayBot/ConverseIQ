from pydantic import BaseModel
from typing import Optional


class AiTask(BaseModel):
    task_id: str
    task_type: str
    meeting_id: str
    context: dict = {}
    payload: dict = {}
    provider: dict = {}


class AiResponse(BaseModel):
    task_id: str
    success: bool
    duration_ms: float
    confidence: float = 0.0
    result: dict = {}


class TranscriptSegment(BaseModel):
    speaker: Optional[str] = None
    text: str
    confidence: float
    start: float
    end: Optional[float] = None
    is_final: bool = False


class SpeakerSegment(BaseModel):
    speaker: str
    start: float
    end: float
    confidence: float


class AudioChunk(BaseModel):
    meeting_id: str
    sequence: int
    timestamp: str
    sample_rate: int = 16000
    channels: int = 1
    audio: bytes
