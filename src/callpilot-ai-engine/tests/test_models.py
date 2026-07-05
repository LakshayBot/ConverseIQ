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


def test_worker_models():
    from engine.workers.models import WorkerTask, WorkerResult

    task = WorkerTask(
        task_id="t1",
        task_type="TranscribeAudio",
        meeting_id="m1",
        payload={"audio": [1, 2, 3]},
    )

    assert task.task_type == "TranscribeAudio"

    result = WorkerResult(
        task_id="t1",
        success=True,
        result={"transcript": "hello"},
        duration_ms=150.0,
        confidence=0.92,
    )

    assert result.success
    assert result.confidence == 0.92
