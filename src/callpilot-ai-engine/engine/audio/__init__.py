import io
import logging

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


class AudioProcessor:
    def __init__(self, target_sample_rate: int = 16000, target_channels: int = 1):
        self.target_sample_rate = target_sample_rate
        self.target_channels = target_channels
        self._audio_buffer: dict[str, bytearray] = {}

    def normalize(
        self, meeting_id: str, audio_bytes: bytes, sample_rate: int = 16000, channels: int = 1
    ) -> np.ndarray | None:
        try:
            audio_array, input_sr = sf.read(
                io.BytesIO(audio_bytes),
                dtype="int16",
                always_2d=False,
            )
        except Exception as e:
            logger.warning(f"Failed to decode audio for meeting {meeting_id}: {e}")
            return None

        if audio_array.ndim > 1 and audio_array.shape[1] > 1:
            audio_array = audio_array.mean(axis=1)

        audio_float = audio_array.astype(np.float32) / 32768.0

        if input_sr != self.target_sample_rate:
            try:
                import scipy.signal
                num_samples = int(len(audio_float) * self.target_sample_rate / input_sr)
                audio_float = scipy.signal.resample(audio_float, num_samples)
            except ImportError:
                logger.warning("scipy not available for resampling; using raw sample rate")

        return audio_float.astype(np.float32)

    def add_to_buffer(self, meeting_id: str, chunk: bytes) -> None:
        if meeting_id not in self._audio_buffer:
            self._audio_buffer[meeting_id] = bytearray()
        self._audio_buffer[meeting_id].extend(chunk)

    def get_buffer(self, meeting_id: str) -> bytes:
        buf = self._audio_buffer.get(meeting_id, bytearray())
        self._audio_buffer[meeting_id] = bytearray()
        return bytes(buf)

    def clear_buffer(self, meeting_id: str) -> None:
        self._audio_buffer.pop(meeting_id, None)
