# Contributing to ConverseIQ

Thank you for your interest in contributing!

## Getting Started

1. Read all architecture documents in `.opencode/`
2. Set up the development environment using `docker compose -f docker/docker-compose.yml up`
3. Browse existing issues

## Development Workflow

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Run tests: `dotnet test src/CallPilot.slnx`
5. Submit a pull request

## Code Style

- Follow existing patterns in the codebase
- Keep the solution compiling at all times
- Follow Vertical Slice Architecture
- Follow CQRS patterns
- Write tests for new features

## Architecture Rules

- Business logic belongs in the Server, not the AI Engine
- AI logic belongs in the Python AI Engine, not the Server
- Keep providers abstracted - no vendor lock-in
- Events describe facts, not intentions
- All public APIs must be versioned

## Pull Request Checklist

- [ ] Build succeeds
- [ ] Tests pass
- [ ] No placeholder code
- [ ] Logging added
- [ ] Error handling added
- [ ] Documentation updated if needed
