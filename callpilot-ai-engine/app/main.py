import logging
import time

from fastapi import FastAPI, HTTPException

from app.models.models import AiTask, AiResponse
from app.workers.embedding_worker import EmbeddingWorker
from app.workers.entity_worker import EntityWorker
from app.workers.intent_worker import IntentWorker
from app.workers.recommendation_worker import RecommendationWorker
from app.workers.speech_worker import SpeechWorker
from app.workers.speaker_worker import SpeakerWorker

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="CallPilot AI Engine")

_workers = {
    "TranscribeAudio": SpeechWorker(),
    "DetectSpeakers": SpeakerWorker(),
    "ExtractEntities": EntityWorker(),
    "DetectEvents": IntentWorker(),
    "GenerateRecommendations": RecommendationWorker(),
    "GenerateEmbeddings": EmbeddingWorker(),
}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/api/v1/tasks", response_model=AiResponse)
async def execute_task(task: AiTask):
    worker = _workers.get(task.task_type)
    if worker is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task type: {task.task_type}. Supported: {list(_workers.keys())}",
        )

    logger.info("Executing task: %s [%s]", task.task_type, task.task_id)
    return await worker.run(task)
