import logging
import time
from typing import Optional

import numpy as np

from ..audio import AudioProcessor
from ..models import AudioChunkRequest, TranscriptSegment
from .diarizer import SpeakerDiarizer
from .speech_recognizer import SpeechRecognizer

logger = logging.getLogger(__name__)


class TranscriptPipeline:
    def __init__(
        self,
        model_size: str = "small.en",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en",
    ):
        self.audio_processor = AudioProcessor(target_sample_rate=16000, target_channels=1)
        self.speech_recognizer = SpeechRecognizer(
            model_size=model_size,
            device=device,
            compute_type=compute_type,
            language=language,
        )
        self.diarizer = SpeakerDiarizer()
        self._last_transcript_time: dict[str, float] = {}

    async def process_audio_chunk(
        self, chunk: AudioChunkRequest
    ) -> Optional[TranscriptSegment]:
        start_time = time.time()

        audio_array = self.audio_processor.normalize(
            chunk.meeting_id,
            chunk.audio,
            sample_rate=chunk.sample_rate,
            channels=chunk.channels,
        )

        if audio_array is None or len(audio_array) == 0:
            return None

        audio_rms = float(np.sqrt(np.mean(audio_array ** 2)))
        if chunk.sequence <= 1 or chunk.sequence % 50 == 0:
            logger.info(f"[{chunk.meeting_id}] Audio chunk #{chunk.sequence}: rms={audio_rms:.6f}, samples={len(audio_array)}")
        else:
            logger.debug(f"[{chunk.meeting_id}] Audio chunk: rms={audio_rms:.4f}, samples={len(audio_array)}")

        meeting_id = chunk.meeting_id

        last_time = self._last_transcript_time.get(meeting_id, 0.0)
        duration = len(audio_array) / 16000.0

        transcript = self.speech_recognizer.transcribe(
            meeting_id=meeting_id,
            audio=audio_array,
            source=chunk.source,
        )

        if transcript is None:
            return None

        self.diarizer.identify_speaker(
            meeting_id=meeting_id,
            audio_source=chunk.source,
            start_offset=last_time,
            end_offset=last_time + duration,
        )

        self._last_transcript_time[meeting_id] = last_time + duration

        elapsed = (time.time() - start_time) * 1000
        logger.debug(
            f"[{meeting_id}] Transcript: speaker={transcript.speaker}, "
            f"text={transcript.text[:50]}..., confidence={transcript.confidence:.2f}, "
            f"latency={elapsed:.0f}ms"
        )

        return transcript

    def reset_meeting(self, meeting_id: str) -> None:
        self.speech_recognizer.reset_meeting(meeting_id)
        self.diarizer.reset_meeting(meeting_id)
        self._last_transcript_time.pop(meeting_id, None)
