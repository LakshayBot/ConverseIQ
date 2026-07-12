import pytest


def test_models_can_be_imported():
    from engine.models import AudioChunkRequest, TranscriptSegment, SpeechTaskResult

    segment = TranscriptSegment(
        speaker="Test",
        text="hello world",
        confidence=0.95,
        start="0.00",
        end="1.00",
        is_final=True,
        meeting_id="m1",
        sequence=1,
    )

    assert segment.speaker == "Test"
    assert segment.confidence == 0.95


def test_speech_task_result():
    from engine.models import SpeechTaskResult, TranscriptSegment

    segment = TranscriptSegment(
        speaker="Test",
        text="hello world",
        confidence=0.95,
        start="0.00",
        end="1.00",
        is_final=True,
        meeting_id="m1",
        sequence=1,
    )

    result = SpeechTaskResult(
        task_id="r1",
        success=True,
        transcript=segment,
        duration_ms=150.0,
    )

    assert result.task_id == "r1"
    assert result.success
    assert result.transcript is not None
    assert result.transcript.text == "hello world"
