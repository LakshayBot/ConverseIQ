# 04_AI_Architecture.md

## Part 3 — Conversation Intelligence & Event Engine

---

# 29. Purpose

The Event Engine is the heart of the CallPilot AI Engine.

Its responsibility is to transform human conversations into structured business intelligence.

Unlike traditional conversational AI systems that repeatedly send entire conversations to a Large Language Model, the Event Engine incrementally builds a semantic representation of the meeting.

This dramatically reduces:

- Token consumption
- AI latency
- Hallucinations
- Duplicate reasoning
- Unnecessary LLM invocations

The Event Engine is responsible for understanding **what happened**, not generating natural language.

---

# 30. Why an Event Engine?

Consider the following transcript.

Customer

> "We're currently using Salesforce, but pricing has become expensive."

A conventional LLM receives the sentence.

CallPilot AI instead transforms it into structured business knowledge.

```
CompetitorMentioned

↓

PricingConcern

↓

BuyingSignal

↓

MigrationOpportunity
```

This structured representation becomes significantly more useful than the transcript itself.

---

# 31. Conversation Processing Pipeline

```
Transcript

↓

Sentence Builder

↓

Entity Extraction

↓

Intent Detection

↓

Event Detection

↓

Conversation Graph

↓

Knowledge Retrieval

↓

LLM Reasoning

↓

Recommendation Engine
```

Notice that the LLM is **not** responsible for understanding the conversation.

The LLM reasons **after** deterministic processing has extracted as much structure as possible.

---

# 32. Conversation Builder

Streaming transcripts arrive as fragmented text.

Example

```
"We"

"currently"

"use"

"Salesforce"
```

The Conversation Builder combines fragments into complete conversational units.

Output

```
We currently use Salesforce.
```

Responsibilities

- Merge transcript fragments
- Detect sentence boundaries
- Handle interruptions
- Handle transcript corrections
- Preserve timestamps
- Preserve speaker identity

Every downstream module receives conversation units instead of raw transcript fragments.

---

# 33. Context Window

The AI Engine maintains a rolling conversation context.

Unlike long-term memory, this context exists only for the duration of the meeting.

The context window contains:

- Active discussion topic
- Current speaker
- Mentioned products
- Mentioned competitors
- Customer concerns
- Technical questions
- Previously detected events

The context window continuously evolves throughout the meeting.

---

# 34. Context Graph

Rather than storing plain text, the AI Engine maintains a semantic graph.

Example

```
Customer

↓

Uses

↓

Salesforce

↓

Has Concern

↓

Pricing

↓

Interested In

↓

Migration
```

The graph becomes the source of truth for conversation understanding.

Advantages

- Explainable reasoning
- Fast lookups
- Structured AI prompts
- Reduced hallucinations
- Better recommendation quality

---

# 35. Entity Extraction

The Entity Extraction Engine identifies important business entities from every conversation segment.

Examples include:

Products

```
Salesforce

HubSpot

SAP

Jira

ServiceNow
```

Companies

```
Microsoft

Google

Amazon

OpenAI
```

Technologies

```
Kubernetes

Azure

AWS

PostgreSQL

Docker
```

Documents

```
Pricing Guide

Migration Guide

Security Whitepaper
```

Features

```
Single Sign-On

Role-Based Access

Audit Logs

API Integration
```

Every detected entity receives a confidence score.

---

# 36. Entity Registry

Detected entities are stored in an in-memory registry.

Example

```
Products

Salesforce

Mention Count: 4

Confidence: 0.98

-------------------------

Technology

Azure

Mention Count: 2

Confidence: 0.93

-------------------------

Feature

SSO

Mention Count: 3

Confidence: 0.91
```

The registry prevents repeated extraction work.

---

# 37. Intent Detection

Intent Detection identifies what the customer is trying to accomplish.

Examples

```
Request Information

Request Pricing

Evaluate Competitors

Raise Objection

Discuss Timeline

Request Demonstration

Technical Validation

Security Assessment
```

Intent detection should combine deterministic rules with LLM reasoning where necessary.

---

# 38. Event Detection

Events are immutable business facts extracted from the conversation.

Examples

```
CompetitorMentioned

PricingQuestion

SecurityConcern

FeatureRequest

PositiveBuyingSignal

NegativeBuyingSignal

BudgetDiscussion

TimelineDiscussion

MigrationInterest

DecisionMakerMentioned

TechnicalQuestion
```

Events should contain:

- Event Type
- Timestamp
- Speaker
- Confidence
- Related Entities
- Supporting Transcript

Events should never contain AI-generated assumptions.

---

# 39. Event Lifecycle

Every event progresses through a lifecycle.

```
Detected

↓

Validated

↓

Published

↓

Consumed
```

Detected

The event has been identified.

Validated

Confidence exceeds threshold.

Published

Sent to downstream consumers.

Consumed

Used by:

- Dashboard
- Recommendation Engine
- RAG
- Analytics (future)

---

# 40. Confidence Scoring

Every event must include a confidence score.

Example

```
PricingQuestion

Confidence

0.96
```

Suggested thresholds

```
0.95+

Immediately publish

0.80–0.95

Publish normally

0.60–0.80

Publish as low confidence

Below 0.60

Discard
```

Thresholds should remain configurable.

---

# 41. Competitor Detection

Competitor detection is one of the flagship capabilities of CallPilot AI.

Whenever a known competitor is mentioned, the AI Engine should generate a structured event.

Example

Customer

> "We're currently using HubSpot."

Produces

```
CompetitorMentioned

Name

HubSpot

Confidence

0.99
```

This event immediately triggers:

- Knowledge retrieval
- Product comparison
- Talking points
- Objection guidance

---

# 42. Product Detection

The AI Engine should distinguish between:

- Our product
- Competitor products
- Partner products
- Third-party technologies

Product metadata should be stored independently of transcripts.

Example

```
Product

Salesforce

Category

CRM

Vendor

Salesforce

Mention Count

5
```

---

# 43. Buying Signals

Positive buying signals

Examples

```
"We need this soon."

"Can you send pricing?"

"When can we start?"

"We'd like a demo."

"What would migration look like?"
```

Negative signals

```
"This is outside our budget."

"We're happy with our current solution."

"We don't have executive approval."

"We're revisiting this next year."
```

Signals should be emitted as events, not free text.

---

# 44. Objection Detection

The Event Engine should classify objections.

Examples

```
Price

Security

Compliance

Migration

Performance

Integration

Vendor Lock-In

Support

Training

Implementation Time
```

Objections should immediately trigger retrieval of supporting documentation.

---

# 45. Technical Question Detection

Example

Customer

> "Do you support SAML?"

Produces

```
TechnicalQuestion

Topic

SAML

Confidence

0.98
```

This event automatically initiates:

Knowledge Search

↓

Documentation Retrieval

↓

Suggested Response

---

# 46. Event Bus

Every validated event is published to the internal Event Bus.

Consumers include:

- Dashboard
- Recommendation Engine
- Knowledge Engine
- Future CRM Plugin
- Future Analytics Engine

The Event Bus allows new modules to subscribe without modifying existing code.

---

# 47. Why Deterministic Processing First?

Traditional AI systems repeatedly ask an LLM to interpret conversations.

CallPilot AI first extracts deterministic business structure.

Benefits

- Lower token usage
- Lower latency
- Better explainability
- Easier debugging
- Better caching
- Lower inference cost
- Higher consistency

The LLM should spend its compute budget generating value—not rediscovering obvious facts.

---

# 48. Guiding Principles

The Event Engine should follow these principles.

- Facts before opinions.
- Events before prompts.
- Deterministic processing before probabilistic reasoning.
- Structured data before natural language.
- Confidence before publication.
- Explainability over hidden inference.
- Extensibility without modification.

The Event Engine is the intelligence backbone of CallPilot AI.

Every recommendation, knowledge retrieval, and AI suggestion begins with the structured events produced by this component.

---

End of Part 3