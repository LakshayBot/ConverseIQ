# CallPilot AI

**Real-Time AI Sales Intelligence Platform**

CallPilot AI is an open-source, real-time AI sales intelligence platform that assists sales professionals during live customer conversations by continuously analyzing speech, understanding business context, retrieving organizational knowledge, and providing contextual recommendations — without interrupting the flow of the meeting.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-purple.svg)](https://dotnet.microsoft.com)
[![Python](https://img.shields.io/badge/Python-3.13-yellow.svg)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org)

## Features

- **Live Transcription** — Real-time speech-to-text with speaker identification
- **Conversation Intelligence** — Automatic detection of competitors, pricing questions, objections, buying signals
- **Knowledge Retrieval** — Semantic search across uploaded documents (PDF, DOCX, Markdown)
- **AI Recommendations** — Contextual talking points and guidance during live meetings
- **BYOK** — Bring your own AI keys (DeepSeek, Ollama, OpenAI, Claude, Gemini)
- **Self-Hosted** — Full Docker deployment with PostgreSQL + pgvector
- **Vendor Neutral** — Replace any component without architectural changes

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Desktop Agent  │────▶│  CallPilot Server │────▶│   AI Engine     │
│   (.NET CLI)    │Audio│  (ASP.NET Core)   │HTTP │   (Python)      │
│                 │◀────│                   │◀────│                 │
│  Audio Capture  │     │  Orchestration    │     │  STT/Events/RAG │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                          ┌──────▼──────┐     ┌─────────────────┐
                          │  PostgreSQL │     │   Dashboard     │
                          │  + pgvector │     │   (Next.js)     │
                          └─────────────┘     └─────────────────┘
```

**Full architecture documentation**: See `.opencode/` directory (17 design documents, 10 ADRs).

## Quick Start

### Prerequisites
- .NET 10 SDK
- Node.js 22+
- Python 3.13+
- Docker & Docker Compose

### One-Command Setup

```bash
# Start infrastructure
docker compose up -d postgres

# Run setup script
./scripts/setup.sh

# Start all services
./scripts/dev.sh
```

Or manually:

```bash
# 1. Start database
docker compose up -d postgres

# 2. Start server (terminal 1)
dotnet run --project src/CallPilot.Server/CallPilot.Server.Api

# 3. Start AI Engine (terminal 2)
cd src/callpilot-ai-engine
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn engine.main:app --reload --port 8001

# 4. Start Dashboard (terminal 3)
cd src/callpilot-dashboard
npm install && npm run dev

# 5. Open http://localhost:3000
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Backend | ASP.NET Core 10, Entity Framework Core, SignalR |
| AI Engine | Python, FastAPI, Faster Whisper, Sentence Transformers |
| Dashboard | Next.js 15, React 19, TailwindCSS 4 |
| Desktop Agent | .NET 10 CLI, SignalR Client |
| Database | PostgreSQL 17 + pgvector |
| Infrastructure | Docker Compose, Polly, Serilog |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

1. Read the architecture docs in `.opencode/` (in numerical order)
2. Follow the [PR template](.github/pull_request_template.md)
3. All tests must pass
4. Follow the architecture principles (ADR-001 through ADR-010)

## License

MIT License — see [LICENSE](LICENSE) for details.

## Project Status

CallPilot AI is in active development. See the [Implementation Roadmap](.opencode/10_Implementation_Roadmap.md) for the full plan.

| Phase | Status |
|-------|--------|
| Phase 0 — Repository Foundation | Complete |
| Phase 1 — Auth & BYOK | Complete |
| Phase 2 — Desktop CLI | Complete |
| Phase 3 — AI Engine | Complete |
| Phase 4 — Live Dashboard | Complete |
| Phase 5 — Knowledge Management | Complete |
| Phase 6 — Conversation Intelligence | Complete |
| Phase 7 — Recommendation Engine | Complete |
| Phase 8 — Performance & Reliability | Complete |
| Phase 9 — Open Source Readiness | In Progress |
| Phase 10 — Docker & Self Hosting | Pending |
| Phase 11 — Phase 2 Planning | Pending |
