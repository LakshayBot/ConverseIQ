import pytest

from engine.models import AudioChunkRequest, TranscriptSegment
from engine.speech_engine.diarizer import SpeakerDiarizer


class TestSpeakerDiarizer:
    def test_identify_microphone_as_salesperson(self):
        diarizer = SpeakerDiarizer()
        segment = diarizer.identify_speaker("m1", "microphone", 0.0, 1.0)

        assert segment.speaker_id == "Salesperson"
        assert segment.confidence > 0.9

    def test_identify_desktop_as_customer(self):
        diarizer = SpeakerDiarizer()
        segment = diarizer.identify_speaker("m1", "desktop", 5.0, 8.0)

        assert segment.speaker_id == "Customer-1"

    def test_timeline_accumulates_speakers(self):
        diarizer = SpeakerDiarizer()
        diarizer.identify_speaker("m1", "microphone", 0.0, 2.0)
        diarizer.identify_speaker("m1", "desktop", 2.0, 5.0)

        timeline = diarizer.get_speaker_timeline("m1")
        assert len(timeline) == 2

    def test_reset_clears_timeline(self):
        diarizer = SpeakerDiarizer()
        diarizer.identify_speaker("m1", "microphone", 0.0, 1.0)
        diarizer.reset_meeting("m1")

        assert diarizer.get_speaker_timeline("m1") == []
