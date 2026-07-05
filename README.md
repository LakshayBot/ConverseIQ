# ConverseIQ

Real-Time AI Sales Intelligence Platform

ConverseIQ (formerly CallPilot AI) is an open-source, real-time AI sales intelligence platform that assists sales professionals during live customer conversations by continuously analyzing speech, understanding business context, retrieving organizational knowledge, and providing contextual recommendations without interrupting the flow of the meeting.

## Architecture

```
Desktop Agent (.NET 9 CLI)  →  Backend API (.NET 9)  →  AI Engine (Python)
                                                                  ↓
Dashboard (Next.js)  ←  SignalR  ←  Backend API  ←  PostgreSQL + pgvector
```

## Getting Started

```bash
docker compose -f docker/docker-compose.yml up
```

## Development

### Prerequisites

- .NET 10 SDK
- Node.js 22+
- Python 3.13+
- Docker

### Backend

```bash
dotnet build src/CallPilot.slnx
dotnet run --project src/CallPilot.Server.Api
```

### Dashboard

```bash
cd callpilot-dashboard
npm install
npm run dev
```

### AI Engine

```bash
cd callpilot-ai-engine
pip install -r requirements.txt
uvicorn main:app --reload
```

## Documentation

All architecture documentation is in the `.opencode/` directory.

## License

MIT
