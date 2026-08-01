# CallPilot AI Product Overview

## What is CallPilot AI?

CallPilot AI is a real-time sales intelligence platform that provides live AI assistance during customer conversations.

## Key Features

### Live Transcription
Real-time speech-to-text with speaker identification. Supports 20+ languages through Faster Whisper.

### Competitor Intelligence
Automatic detection of competitor mentions during calls. Includes battle cards for:
- Salesforce
- HubSpot
- Zendesk
- ServiceNow
- Jira

### Knowledge Retrieval
Semantic search across your uploaded documents. Supports PDF, DOCX, and Markdown formats.

### AI Recommendations
Contextual talking points and objection handling guidance generated in real time.

## Pricing

### Starter Plan - $29/user/month
- Live transcription
- Basic competitor detection
- 5 knowledge documents

### Professional Plan - $79/user/month
- Full competitor intelligence
- 50 knowledge documents
- AI recommendations
- Custom battle cards

### Enterprise Plan - Custom pricing
- Unlimited documents
- Custom integrations
- Dedicated deployment
- SSO/SAML support
- Priority support

## Security

CallPilot AI is SOC 2 Type II compliant. All data is encrypted at rest and in transit. We support BYOK (Bring Your Own Key) for AI providers.

## Integrations

- Microsoft Teams
- Zoom
- Google Meet
- Slack
- REST API

## Migration Guide

### Migrating from Salesforce

1. Export your knowledge base
2. Import documents into CallPilot AI
3. Configure your AI providers
4. Install the Desktop Agent
5. Start your first meeting

Common questions about switching from Salesforce:
- Does CallPilot AI replace Salesforce? No, it complements it.
- Can I keep my Salesforce data? Yes, CallPilot AI is read-only.
- How long does migration take? Typically 1-2 days.

### Migrating from HubSpot

Similar process to Salesforce migration. Key differences:
- HubSpot knowledge base exports as HTML
- CallPilot AI supports HTML import in Enterprise plan

## Technical Specifications

### Supported Platforms
- Windows 10/11 (Desktop Agent)
- macOS (Dashboard access)
- Linux (Server deployment)

### API
REST API with JWT authentication. Full documentation in `.opencode/08_API_Contracts.md`.

### Deployment
Docker Compose for self-hosted deployment. Kubernetes support planned for v2.0.
