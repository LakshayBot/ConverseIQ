CallPilot AI Engine

A stateless Python service providing:
- Streaming Speech Recognition
- Speaker Diarization
- Event Detection
- Knowledge Retrieval (RAG)
- Recommendation Generation

This service communicates exclusively with the CallPilot Server via HTTP.
It never stores user data, never accesses PostgreSQL directly, and
never authenticates users.

## Development

```bash
pip install -e .
uvicorn engine.main:app --reload --port 8001
```
