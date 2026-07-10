from pydantic import BaseModel
from typing import Optional


class AudioChunkRequest(BaseModel):
    meeting_id: str
    sequence: int
    timestamp: str
    sample_rate: int = 16000
    channels: int = 1
    audio: bytes
    source: str = "microphone"


class TranscriptSegment(BaseModel):
    speaker: str
    text: str
    confidence: float
    start: str
    end: str
    is_final: bool
    meeting_id: str
    sequence: int


class SpeechTaskResult(BaseModel):
    task_id: str
    success: bool
    transcript: Optional[TranscriptSegment] = None
    error: Optional[str] = None
    duration_ms: float = 0.0
    silence_detected: bool = False
