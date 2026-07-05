import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class SpeakerSegment:
    speaker_id: str
    start_time: float
    end_time: float
    confidence: float
    source: str


class SpeakerDiarizer:
    def __init__(
        self,
        use_ml_diarization: bool = False,
        overlap_threshold: float = 0.3,
    ):
        self.use_ml_diarization = use_ml_diarization
        self.overlap_threshold = overlap_threshold
        self._speaker_timeline: dict[str, list[SpeakerSegment]] = {}

    def identify_speaker(
        self,
        meeting_id: str,
        audio_source: str,
        start_offset: float,
        end_offset: float,
    ) -> SpeakerSegment:
        speaker_id = self._resolve_speaker(audio_source)

        segment = SpeakerSegment(
            speaker_id=speaker_id,
            start_time=start_offset,
            end_time=end_offset,
            confidence=0.95,
            source=audio_source,
        )

        if meeting_id not in self._speaker_timeline:
            self._speaker_timeline[meeting_id] = []
        self._speaker_timeline[meeting_id].append(segment)

        return segment

    def get_speaker_timeline(self, meeting_id: str) -> list[SpeakerSegment]:
        return self._speaker_timeline.get(meeting_id, [])

    def reset_meeting(self, meeting_id: str) -> None:
        self._speaker_timeline.pop(meeting_id, None)

    @staticmethod
    def _resolve_speaker(audio_source: str) -> str:
        source_map = {
            "microphone": "Salesperson",
            "mic": "Salesperson",
            "desktop": "Customer-1",
            "desktop_audio": "Customer-1",
            "system": "Customer-1",
        }
        return source_map.get(audio_source.lower(), f"Speaker-{audio_source}")
