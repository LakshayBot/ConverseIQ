from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_prefix": "AI_ENGINE_"}

    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    diarization_enabled: bool = False
    max_audio_duration: int = 30


settings = Settings()
