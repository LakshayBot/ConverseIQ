# 01_Project_Vision.md

**Document Status**

Version: 1.0

Status: Approved

---

# Project Name

**CallPilot AI**

**Tagline**

Real-Time AI Sales Intelligence Platform

---

# 1. Vision

CallPilot AI is an open-source, real-time AI sales intelligence platform that assists sales professionals during live customer conversations by continuously analyzing speech, understanding business context, retrieving organizational knowledge, and providing contextual recommendations without interrupting the flow of the meeting.

Unlike traditional meeting assistants that focus on recording meetings and generating summaries after the conversation has ended, CallPilot AI operates while the meeting is taking place.

Its primary purpose is to reduce cognitive load on sales representatives by acting as an intelligent sales copilot capable of understanding what is happening inside the meeting and surfacing the right information at the right moment.

The platform is designed to be vendor-neutral, AI-provider agnostic, open-source, self-hostable, Docker-native, and extensible.

---

# 2. Problem Statement

Sales representatives spend a significant portion of customer meetings trying to remember information instead of actively listening.

During a typical enterprise sales meeting they are expected to:

- Understand customer requirements.
- Explain product capabilities.
- Handle objections.
- Recall pricing.
- Remember previous conversations.
- Compare competitors.
- Qualify opportunities.
- Answer technical questions.
- Take notes.
- Capture action items.
- Update CRM systems.
- Prepare follow-up emails.

These responsibilities compete for the salesperson's attention, reducing the quality of the conversation.

Existing AI meeting assistants primarily solve problems after the meeting has already ended.

Most products provide:

- Meeting recordings.
- Transcripts.
- AI summaries.
- Action items.

While valuable, these capabilities do not improve the quality of the live conversation.

CallPilot AI shifts the focus from **meeting documentation** to **meeting intelligence**.

---

# 3. Mission

Enable every salesperson to perform like an experienced enterprise sales engineer by delivering contextual intelligence in real time.

The platform should augment human decision making rather than replace it.

AI exists to support the salesperson—not speak on their behalf.

---

# 4. Product Philosophy

CallPilot AI follows five core principles.

## Intelligence over Automation

The platform should recommend.

It should not control.

The salesperson remains responsible for every customer interaction.

---

## Context over Conversation

The system should understand business context rather than simply transcribe words.

Example:

Customer:

"We're currently using Salesforce."

The valuable information is not the sentence.

The valuable information is:

- Competitor detected.
- Migration opportunity.
- Possible objections.
- Existing comparison documents.
- Recommended talking points.

---

## Real-Time over Post-Meeting

The highest value exists while the customer is still speaking.

Recommendations delivered after the meeting are useful.

Recommendations delivered during the meeting are transformative.

---

## Open over Closed

Every major component should be replaceable.

Examples include:

- Speech providers
- AI models
- Vector stores
- Knowledge sources

Users should never be locked into a specific vendor.

---

## Human First

The AI should never interrupt.

The AI should never speak.

The AI should never automatically respond.

It quietly assists the salesperson by presenting relevant information at the appropriate time.

---

# 5. Objectives

Phase 1 focuses on delivering a real-time sales intelligence platform capable of:

- Capturing meeting audio.
- Identifying speakers.
- Producing live transcripts.
- Detecting important business events.
- Retrieving relevant internal documentation.
- Comparing competitors.
- Suggesting talking points.
- Answering technical questions through company documentation.
- Displaying meeting intelligence in a live dashboard.

The system intentionally avoids attempting to automate the conversation.

---

# 6. Scope

Phase 1 includes:

- Native Desktop Agent.
- Streaming speech recognition.
- Speaker diarization.
- Knowledge Base.
- Retrieval-Augmented Generation (RAG).
- Live transcription.
- Live event detection.
- Competitor recognition.
- Product comparison.
- Sales recommendations.
- PDF knowledge ingestion.
- Markdown knowledge ingestion.
- DOCX knowledge ingestion.
- BYOK AI providers.
- Local LLM support.
- Docker deployment.
- Open-source architecture.

Phase 1 explicitly excludes:

- CRM integrations.
- Meeting recording.
- Voice synthesis.
- Automatic meeting participation.
- Browser extensions.
- Calendar integrations.
- Search across historical meetings.
- Persistent conversation memory.
- Automatic follow-up emails.
- Team analytics.

---

# 7. Target Users

Primary users:

- Enterprise Account Executives.
- Sales Engineers.
- Solution Consultants.
- Business Development Representatives.
- Founders conducting customer calls.

Secondary users:

- Sales Managers.
- Technical Consultants.
- Customer Success Engineers.

---

# 8. Primary Use Case

A salesperson starts the Desktop Agent before joining a customer meeting.

The Desktop Agent securely captures:

- Microphone audio.
- Desktop audio.

Audio is streamed in real time to the backend.

The backend coordinates speech recognition and AI reasoning.

The dashboard updates continuously with:

- Live transcript.
- Speaker labels.
- Detected competitors.
- Product mentions.
- Customer pain points.
- Suggested responses.
- Relevant documentation.
- Objection guidance.
- Technical references.

The salesperson remains focused on the customer while CallPilot AI continuously provides supporting information.

---

# 9. Core Value Proposition

Instead of remembering hundreds of product details, case studies, pricing documents, and competitor comparisons, the salesperson receives exactly the information they need when they need it.

The platform functions as a real-time sales engineer sitting beside the salesperson throughout the conversation.

---

# 10. Key Features

Phase 1 delivers the following core capabilities:

- Live meeting transcription.
- Speaker identification.
- Competitor detection.
- Product recognition.
- Technical question detection.
- Objection detection.
- Retrieval-Augmented Generation.
- Company knowledge search.
- Context-aware talking points.
- Product comparison cards.
- Live timeline of meeting events.
- AI-generated contextual recommendations.
- Structured event stream.
- Docker-native deployment.
- BYOK AI providers.

---

# 11. Success Criteria

The project will be considered successful when it can:

- Capture live desktop and microphone audio.
- Produce accurate streaming transcripts.
- Correctly distinguish speakers.
- Detect business events in real time.
- Retrieve relevant documentation from the knowledge base.
- Display contextual recommendations within seconds of the customer mentioning a topic.
- Operate without recording meetings.
- Support both cloud-hosted and local AI providers.
- Run entirely through Docker.
- Be deployable by any contributor using a single setup process.

---

# 12. Long-Term Vision

Although Phase 1 focuses exclusively on sales intelligence, the underlying architecture should remain generic.

Future modules may include:

- Customer Support Intelligence.
- Technical Interview Intelligence.
- Customer Success Intelligence.
- Procurement Intelligence.
- Legal Review Assistance.
- Executive Meeting Intelligence.

These future capabilities should be implemented as additional modules without requiring architectural changes to the core platform.

---

# 13. Final Statement

CallPilot AI is not a meeting recorder, a chatbot, or an automated salesperson.

It is a real-time intelligence platform that transforms live conversations into actionable business insights, allowing sales professionals to spend less time searching for information and more time building meaningful customer relationships.

Every architectural decision in this project should reinforce one principle:

**Deliver the right information to the right person at the exact moment they need it—without disrupting the conversation.**

---

**End of Document — 01_Project_Vision.md**