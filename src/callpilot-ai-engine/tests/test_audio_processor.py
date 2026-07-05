import io
import wave

import numpy as np
import pytest

from engine.audio import AudioProcessor


def generate_sine_wav(duration_sec=1.0, sample_rate=16000, freq=440) -> bytes:
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    audio = (np.sin(2 * np.pi * freq * t) * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio.tobytes())
    return buf.getvalue()


class TestAudioProcessor:
    def test_normalize_mono_returns_array(self):
        processor = AudioProcessor()
        wav_bytes = generate_sine_wav(duration_sec=0.5)

        result = processor.normalize("test-meeting", wav_bytes, sample_rate=16000, channels=1)

        assert result is not None
        assert result.dtype == np.float32
        assert len(result) > 0

    def test_normalize_stereo_converts_to_mono(self):
        t = np.linspace(0, 0.5, 8000, endpoint=False)
        left = np.sin(2 * np.pi * 440 * t) * 32767
        right = np.sin(2 * np.pi * 880 * t) * 32767
        stereo = np.column_stack([left, right]).astype(np.int16)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(stereo.tobytes())

        processor = AudioProcessor()
        result = processor.normalize("test", buf.getvalue())

        assert result is not None
        assert result.ndim == 1

    def test_buffer_accumulates_chunks(self):
        processor = AudioProcessor()
        processor.add_to_buffer("m1", b"hello")
        processor.add_to_buffer("m1", b"world")

        assert processor.get_buffer("m1") == b"helloworld"
        assert processor.get_buffer("m1") == b""

    def test_clear_buffer_removes_meeting(self):
        processor = AudioProcessor()
        processor.add_to_buffer("m1", b"data")
        processor.clear_buffer("m1")
        assert processor.get_buffer("m1") == b""
