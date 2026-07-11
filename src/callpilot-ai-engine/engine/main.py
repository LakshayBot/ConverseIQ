import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request

from engine.models import SpeechTaskResult
from engine.knowledge_engine.embedding_service import EmbeddingService
from engine.event_engine.event_detector import EventDetector
from engine.workers.speech_worker import SpeechWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("callpilot.ai")

speech_worker: SpeechWorker | None = None
embedding_service: EmbeddingService | None = None
event_detector: EventDetector | None = None


def get_model_config():
    return {
        "model_size": os.getenv("WHISPER_MODEL_SIZE", "medium.en"),
        "device": os.getenv("WHISPER_DEVICE", "cpu"),
        "compute_type": os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global speech_worker, embedding_service, event_detector
    config = get_model_config()
    logger.info(
        f"Loading Whisper model: {config['model_size']} on {config['device']}/{config['compute_type']}"
    )
    speech_worker = SpeechWorker(
        model_size=config["model_size"],
        device=config["device"],
        compute_type=config["compute_type"],
    )

    embedding_service = EmbeddingService()
    embedding_service.load_model()

    event_detector = EventDetector()

    logger.info("AI Engine ready")
    yield
    logger.info("AI Engine shutting down")


app = FastAPI(
    title="CallPilot AI Engine",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai-engine",
        "model_loaded": speech_worker is not None,
        "config": get_model_config(),
    }


@app.post("/api/v1/ai/transcribe", response_model=SpeechTaskResult)
async def transcribe_audio(
    request: Request,
    meeting_id: str = Query(...),
    sequence: int = Query(0),
    sample_rate: int = Query(16000),
    channels: int = Query(1),
    source: str = Query("microphone"),
):
    if speech_worker is None:
        raise HTTPException(status_code=503, detail="Speech worker not initialized")

    body = await request.body()

    result = await speech_worker.process_audio(
        meeting_id=meeting_id,
        audio_bytes=body,
        sequence=sequence,
        sample_rate=sample_rate,
        channels=channels,
        source=source,
    )

    return result


@app.post("/api/v1/ai/transcribe/json", response_model=SpeechTaskResult)
async def transcribe_audio_json(request: dict):
    if speech_worker is None:
        raise HTTPException(status_code=503, detail="Speech worker not initialized")

    audio_bytes = request.get("audio")
    if isinstance(audio_bytes, str):
        import base64
        audio_bytes = base64.b64decode(audio_bytes)

    meeting_id = request.get("meeting_id", "unknown")
    sequence = request.get("sequence", 0)
    sample_rate = request.get("sample_rate", 16000)
    channels = request.get("channels", 1)
    source = request.get("source", "microphone")

    if isinstance(audio_bytes, list):
        audio_bytes = bytes(audio_bytes)

    result = await speech_worker.process_audio(
        meeting_id=str(meeting_id),
        audio_bytes=bytes(audio_bytes) if audio_bytes else b"",
        sequence=int(sequence),
        sample_rate=int(sample_rate),
        channels=int(channels),
        source=str(source),
    )

    return result


@app.post("/api/v1/meetings/{meeting_id}/reset")
async def reset_meeting(meeting_id: str):
    if speech_worker is None:
        raise HTTPException(status_code=503, detail="Speech worker not initialized")

    speech_worker.reset_meeting(meeting_id)
    return {"status": "reset", "meeting_id": meeting_id}


@app.post("/api/v1/ai/events")
async def detect_events(request: dict):
    if event_detector is None:
        raise HTTPException(status_code=503, detail="Event detector not initialized")

    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    events = event_detector.detect_all(text)
    return {"events": events, "count": len(events)}


@app.post("/api/v1/ai/embeddings")
async def generate_embedding(request: dict):
    if embedding_service is None:
        raise HTTPException(status_code=503, detail="Embedding service not initialized")

    text = request.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    embedding = embedding_service.generate(text)
    return {"embedding": embedding, "model": embedding_service.model_name, "dimensions": len(embedding)}
