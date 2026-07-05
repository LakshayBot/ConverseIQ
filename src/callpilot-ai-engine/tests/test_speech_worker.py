from engine.models import SpeechTaskResult
from engine.workers.speech_worker import SpeechWorker


class TestSpeechWorker:
    def test_worker_initializes(self):
        worker = SpeechWorker(model_size="tiny", device="cpu", compute_type="int8")
        assert worker.pipeline is not None

    def test_reset_meeting(self):
        worker = SpeechWorker(model_size="tiny", device="cpu", compute_type="int8")
        worker.reset_meeting("test-meeting")

        assert "test-meeting" not in worker.pipeline._last_transcript_time
