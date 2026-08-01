# CallPilot AI

**Real-Time AI Sales Intelligence Platform**

CallPilot AI is an open-source, real-time AI sales intelligence platform that assists sales professionals during live customer conversations by continuously analyzing speech, understanding business context, retrieving organizational knowledge, and providing contextual recommendations - without interrupting the flow of the meeting.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-purple.svg)](https://dotnet.microsoft.com)
[![Python](https://img.shields.io/badge/Python-3.13-yellow.svg)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org)

## Features

- **Live Transcription** - Real-time speech-to-text with speaker identification (Salesperson / Customer)
- **Conversation Intelligence** - Automatic detection of competitors, pricing questions, objections, and buying signals
- **Knowledge Retrieval** - Semantic search across uploaded documents (PDF, DOCX, Markdown)
- **AI Recommendations** - Contextual talking points and guidance during live meetings
- **BYOK** - Bring your own AI keys (DeepSeek, Ollama, OpenAI, Claude, Gemini)
- **Self-Hosted** - Full Docker deployment with PostgreSQL + pgvector
- **Vendor Neutral** - Replace any component without architectural changes

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| .NET SDK | 10.0+ | `dotnet --version` |
| Node.js | 22+ | `node --version` |
| Python | 3.13+ | `python3 --version` |
| Docker | 24+ | `docker --version` |
| FFmpeg | any | `ffmpeg -version` (needed for Desktop Agent audio capture) |

---

## Step-by-Step Setup & Verification

### Step 1: Clone & Start Database

```bash
git clone https://github.com/LakshayBot/ConverseIQ.git
cd ConverseIQ

# Start PostgreSQL (runs in background) - use the dev override so the DB
# is published on host:5432 for local client connections
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres

# Verify it's running
docker compose exec postgres pg_isready -U callpilot
# Expected: /var/run/postgresql:5432 - accepting connections
```

### Step 2: Build & Run the Server (.NET)

Open a new terminal:

```bash
cd ConverseIQ

# Restore dependencies and build
dotnet restore src/CallPilot.slnx
dotnet build src/CallPilot.slnx

# Apply database migrations
dotnet ef database update \
  --project src/CallPilot.Server/CallPilot.Server.Infrastructure \
  --startup-project src/CallPilot.Server/CallPilot.Server.Api

# Start the server
dotnet run --project src/CallPilot.Server/CallPilot.Server.Api

# Verify: server should log "Now listening on: http://[::]:5001"
```

**Verify the server is running** (in another terminal):
```bash
curl http://localhost:5001/health
# Expected: {"status":"Healthy","timestamp":"2026-..."}
```

### Step 3: Set Up & Run the AI Engine (Python)

Open another terminal:

```bash
cd ConverseIQ/src/callpilot-ai-engine

# Create virtual environment (first time only)
python3 -m venv .venv

# Activate it
source .venv/bin/activate

# Install dependencies (first time only, ~2 min)
pip install -e .

# Start the AI Engine (first start downloads models, ~15-30s)
uvicorn engine.main:app --host 0.0.0.0 --port 8001
```

**Verify the AI Engine is running:**
```bash
curl http://localhost:8001/health
# Expected: {"status":"healthy","service":"ai-engine","model_loaded":true,...}
```

### Step 4: Set Up & Run the Dashboard (Next.js)

Open another terminal:

```bash
cd ConverseIQ/src/callpilot-dashboard

# Install dependencies (first time only)
npm install

# Start the dev server
npm run dev

# Verify: should log "Ready in Xs"
```

**Verify the dashboard is running:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
# Expected: 200
```

Or open **http://localhost:3000** in your browser.

### Step 5: Test the Full Flow

**Register a user:**
```bash
curl -X POST http://localhost:5001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@callpilot.dev","password":"TestPass123!","confirmPassword":"TestPass123!"}'
# Expected: {"id":"...","email":"demo@callpilot.dev","createdAt":"..."}
```

**Login:**
```bash
curl -X POST http://localhost:5001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@callpilot.dev","password":"TestPass123!"}'
# Expected: {"accessToken":"eyJ...","refreshToken":"...","accessTokenExpiresAt":"..."}
```

**Create a meeting:**
```bash
# Replace YOUR_TOKEN with the accessToken from login
curl -X POST http://localhost:5001/api/v1/meetings \
  -H "Authorization: Bearer YOUR_TOKEN"
# Expected: {"meetingId":"...","status":"Streaming"}
```

**Upload a knowledge document:**
```bash
echo "# Product Features\n\nFeature 1, Feature 2, Feature 3" > /tmp/test.md

curl -X POST http://localhost:5001/api/v1/knowledge/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/tmp/test.md;type=text/markdown"
# Expected: {"id":"...","fileName":"test.md","processingStatus":"Indexed",...}
```

**Configure an AI Provider (optional for LLM recommendations):**
```bash
curl -X POST http://localhost:5001/api/v1/providers \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"providerType":"Ollama","model":"llama3.2","endpoint":"http://localhost:11434","apiKey":"none","temperature":0.7,"maxTokens":4096,"timeoutSeconds":60}'
```

### Step 6: Use the Dashboard

Open **http://localhost:3000** in your browser:

1. **Login page** - Enter `demo@callpilot.dev` / `TestPass123!`
2. **Dashboard** - Click **"New Meeting"** to create a meeting
3. **Live Meeting view** - Shows real-time transcript as audio streams in
4. **Providers page** - Configure your AI provider (DeepSeek, Ollama, etc.)

---

## Running the Desktop Agent

The Desktop Agent captures microphone audio and streams it to the server:

```bash
cd ConverseIQ

dotnet run --project src/CallPilot.Desktop -- start \
  --email demo@callpilot.dev \
  --password TestPass123! \
  --server-url http://localhost:5001
```

**Requirements:**
- FFmpeg must be installed for audio capture
- Microphone must be connected and accessible

**What happens:**
1. Agent authenticates with the server using JWT
2. Connects via SignalR WebSocket to `/hubs/desktop-agent`
3. Starts capturing microphone audio (PCM 16kHz mono)
4. Streams audio frames to the server every 40ms
5. Server forwards audio to AI Engine for transcription
6. Transcripts appear on the dashboard in real time

---

## Running Tests

```bash
# Run all .NET tests
dotnet test src/CallPilot.slnx

# Run Python AI Engine tests
cd src/callpilot-ai-engine
source .venv/bin/activate
python -m pytest tests/ -v

# Build the dashboard (validates TypeScript)
cd ../callpilot-dashboard
npm run build
```

Or use the test script:
```bash
./scripts/test.sh
```

---

## Docker Deployment

Run the entire platform with a single command:

```bash
# Copy environment file
cp .env.example .env

# Edit .env to set your JWT_SECRET and other values
# vim .env

# Build and start all services (dev - includes Postgres host-port exposure)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Verify all services are healthy
docker compose ps
```

**Dev vs Prod:**
| Command | What changes |
|---|---|
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` | Dev. Postgres is published on host `5432`, ASPNETCORE_ENVIRONMENT=Development, hot-reload volumes mounted, AI engine code mounted for live edits. |
| `docker compose -f docker-compose.yml up` | Production-equivalent. Postgres is **not** published to the host - only reachable from other services on the internal docker network (`Host=postgres`). |

**Services and Ports (dev):**
| Service | Port | Health Check |
|---------|------|-------------|
| PostgreSQL + pgvector | 5432 (dev only) | pg_isready |
| AI Engine | 8001 | GET /health |
| CallPilot Server | 5001 | GET /health |
| Dashboard | 3000 | GET / |

**Local Postgres connection (dev only):**
```
Host:     localhost
Port:     5432
Database: callpilot
User:     callpilot
Password: callpilot_dev
```

**Stop everything:**
```bash
docker compose down
```

---

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

**Pipeline:**
```
Audio → STT → Transcript → Event Detection → Knowledge Retrieval → Recommendation → Dashboard
```

**Technology Stack:**

| Component | Technology |
|-----------|-----------|
| Backend | ASP.NET Core 10, EF Core, SignalR |
| AI Engine | Python, FastAPI, Faster Whisper, Sentence Transformers |
| Dashboard | Next.js 15, React 19, TailwindCSS 4 |
| Desktop Agent | .NET 10 CLI, SignalR Client |
| Database | PostgreSQL 17 + pgvector |
| Infrastructure | Docker Compose, Polly, Serilog |

**Full architecture documentation**: See `.opencode/` directory (17 design documents, 10 ADRs).

---

## API Endpoints

### Authentication
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/api/v1/auth/register` | None |
| POST | `/api/v1/auth/login` | None |
| POST | `/api/v1/auth/refresh` | None |
| POST | `/api/v1/auth/logout` | JWT |

### Meetings
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/api/v1/meetings` | JWT |
| GET | `/api/v1/meetings` | JWT |
| GET | `/api/v1/meetings/{id}/transcripts` | None |
| GET | `/api/v1/meetings/{id}/recommendations` | None |

### Knowledge
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/api/v1/knowledge/upload` | JWT |
| GET | `/api/v1/knowledge` | JWT |
| DELETE | `/api/v1/knowledge/{id}` | JWT |

### Providers
| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/api/v1/providers` | JWT |
| POST | `/api/v1/providers` | JWT |
| DELETE | `/api/v1/providers/{id}` | JWT |

### Health & Diagnostics
| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/health` | None |
| GET | `/health/detailed` | None |
| GET | `/api/v1/diagnostics` | None |
| GET | `/api/v1/diagnostics/meetings/{id}` | None |

### SignalR Hubs
| Hub | Path | Client |
|-----|------|--------|
| DesktopAgentHub | `/hubs/desktop-agent` | Desktop CLI, Dashboard |
| DashboardHub | `/hubs/dashboard` | Dashboard |

---

## Project Structure

```
src/
├── CallPilot.Server/           # .NET Backend (ASP.NET Core 10)
│   ├── CallPilot.Server.Api/   # HTTP endpoints, SignalR hubs
│   ├── CallPilot.Server.Application/  # CQRS handlers, feature slices
│   ├── CallPilot.Server.Domain/       # Domain entities, aggregates
│   ├── CallPilot.Server.Infrastructure/ # DB, AI clients, services
│   ├── CallPilot.Server.Shared/       # Interfaces, abstractions
│   └── CallPilot.Server.Tests/        # xUnit tests (28 tests)
├── CallPilot.Desktop/          # .NET Desktop Agent CLI
├── callpilot-ai-engine/        # Python AI Engine (FastAPI)
│   ├── engine/                 # Core modules
│   │   ├── audio/              # Audio normalization
│   │   ├── speech_engine/      # STT, diarization
│   │   ├── event_engine/       # Event detection
│   │   ├── knowledge_engine/   # Embedding generation
│   │   ├── workers/            # Worker framework
│   │   └── recommendation_engine/
│   └── tests/                  # pytest (30 tests)
├── callpilot-dashboard/        # Next.js Dashboard
├── contracts/                  # Shared API contracts
└── docker/                     # Dockerfiles
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

1. Read the architecture docs in `.opencode/` (in numerical order)
2. Follow the [PR template](.github/pull_request_template.md)
3. All tests must pass (`./scripts/test.sh`)
4. Follow the architecture principles (ADR-001 through ADR-010)

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Project Status

| Phase | Status |
|-------|--------|
| Phase 0 - Repository Foundation | Complete |
| Phase 1 - Auth & BYOK | Complete |
| Phase 2 - Desktop CLI | Complete |
| Phase 3 - AI Engine | Complete |
| Phase 4 - Live Dashboard | Complete |
| Phase 5 - Knowledge Management | Complete |
| Phase 6 - Conversation Intelligence | Complete |
| Phase 7 - Recommendation Engine | Complete |
| Phase 8 - Performance & Reliability | Complete |
| Phase 9 - Open Source Readiness | Complete |
| Phase 10 - Docker & Self Hosting | Complete |
| Phase 11 - Phase 2 Planning | Not Started |
