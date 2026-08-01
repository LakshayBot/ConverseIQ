# Contributing to CallPilot AI

Thank you for your interest in contributing to CallPilot AI! This document outlines the process for contributing to the project.

## Architecture First

CallPilot AI has a comprehensive architecture documented in the `.opencode/` directory. Before contributing:

1. **Read the architecture documents** in numerical order (01 through 12)
2. Understand the **10 Architecture Decision Records** (ADR) in `06_Architecture_Decisions.md`
3. Follow the **Implementation Roadmap** in `10_Implementation_Roadmap.md`

## Development Setup

### Prerequisites

- .NET 10 SDK
- Node.js 22+
- Python 3.13+
- Docker & Docker Compose
- FFmpeg (for desktop audio capture)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/callpilot-ai.git
cd callpilot-ai

# Start infrastructure
docker compose up -d postgres

# Start the server
dotnet run --project src/CallPilot.Server/CallPilot.Server.Api

# Start the AI Engine (in another terminal)
cd src/callpilot-ai-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn engine.main:app --reload --port 8001

# Start the dashboard (in another terminal)
cd src/callpilot-dashboard
npm install
npm run dev

# Start the desktop agent (optional, needs ffmpeg)
dotnet run --project src/CallPilot.Desktop -- start --email user@example.com --password pass
```

### Running Tests

```bash
# .NET tests
dotnet test src/CallPilot.slnx

# Python tests
cd src/callpilot-ai-engine
python -m pytest tests/

# Full CI validation
docker compose up -d postgres
dotnet build src/CallPilot.slnx
dotnet test src/CallPilot.slnx
cd src/callpilot-ai-engine && pip install -e ".[dev]" && python -m pytest tests/
cd src/callpilot-dashboard && npm ci && npm run build
```

## Project Structure

```
callpilot-ai/
├── .github/              # CI pipeline, issue templates
├── .opencode/            # Architecture documentation (read first!)
├── src/
│   ├── CallPilot.Server/        # .NET Backend (ASP.NET Core)
│   ├── CallPilot.Desktop/       # .NET Desktop Agent CLI
│   ├── callpilot-ai-engine/     # Python AI Engine (FastAPI)
│   ├── callpilot-dashboard/     # Next.js Dashboard
│   ├── contracts/               # Shared API contracts
│   └── docker/                  # Dockerfiles
├── docker-compose.yml
├── LICENSE
└── README.md
```

## Architecture Principles

Before submitting a PR, verify your changes follow these principles:

1. **Business logic belongs in the server** - not in controllers, not in AI Engine
2. **AI reasoning belongs in the AI Engine** - not in the server
3. **Vertical Slice Architecture** - features own their complete implementation
4. **CQRS** - commands mutate, queries read
5. **Provider independence** - no hardcoded vendor logic
6. **Event-driven** - components communicate through events
7. **BYOK** - users own their AI credentials
8. **Stateless AI** - AI Engine never persists user data

## Pull Request Process

1. Ensure your PR is traceable to an architecture document
2. Follow the [PR template](.github/pull_request_template.md)
3. All tests must pass (build, unit, integration, contract)
4. Add tests for new functionality
5. Update documentation if APIs change
6. Ensure Docker compatibility

## Commit Messages

Use conventional commits:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `refactor:` for code changes
- `test:` for test changes
- `chore:` for build/config changes

## Questions?

- Read the architecture docs in `.opencode/`
- Check existing issues and discussions
- Open a new issue with the `question` label

Thank you for contributing to CallPilot AI!
