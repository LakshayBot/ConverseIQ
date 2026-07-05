# 04_AI_Architecture.md

## Part 2 — Speech Intelligence Pipeline

---

# 11. Speech Intelligence Overview

The Speech Intelligence Pipeline is responsible for transforming raw audio streams into structured conversational data.

This stage is the foundation of every downstream AI capability.

Every subsequent module depends on the accuracy of this pipeline.

Unlike conventional transcription systems that simply convert speech into text, the Speech Intelligence Pipeline must preserve conversational structure.

It should answer questions such as:

- Who is speaking?
- When did they begin speaking?
- When did they stop speaking?
- Did two people speak simultaneously?
- Is this a continuation of the previous sentence?
- Is the transcript final or still changing?
- How confident are we?

The output of this pipeline becomes the canonical conversation representation used by the remainder of the AI Engine.

---

# 12. Pipeline Overview

```
Desktop Agent

↓

Microphone Stream

↓

Desktop Audio Stream

↓

Audio Normalization

↓

Voice Activity Detection

↓

Streaming Speech Recognition

↓

Transcript Alignment

↓

Speaker Diarization

↓

Conversation Segmentation

↓

Transcript Stabilization

↓

Structured Conversation
```

Each stage performs a single responsibility.

No stage should contain business logic.

---

# 13. Audio Normalization

Raw audio arrives from multiple devices.

Devices differ in:

- Sample Rate
- Channels
- Bit Depth
- Volume
- Background Noise

The first processing stage standardizes every stream.

Target Format

- PCM
- Mono
- 16-bit
- 16 kHz

Future versions may support:

- 24 kHz
- Stereo preservation
- Adaptive bitrate

---

# 14. Voice Activity Detection (VAD)

## Purpose

The AI Engine should not waste compute processing silence.

Voice Activity Detection identifies whether speech is currently present.

Responsibilities

- Detect speech start
- Detect speech end
- Ignore silence
- Ignore keyboard clicks
- Ignore mouse clicks
- Ignore fan noise
- Ignore background hum

The VAD module should emit events such as:

```
SpeechStarted

SpeechEnded

SilenceDetected
```

These events are used to optimize downstream inference.

---

# 15. Architecture Decision — Streaming First

Decision

Speech recognition shall operate continuously.

Rejected Alternative

Wait until speaker stops talking.

Reason

Waiting increases perceived latency.

Continuous streaming allows downstream modules to begin reasoning before the sentence has completed.

---

# 16. Speech Recognition Engine

The Speech Recognition Engine converts normalized audio into timestamped text.

Responsibilities

- Continuous transcription
- Word timestamps
- Partial transcripts
- Final transcripts
- Confidence scores

The engine should support incremental correction.

Example

Partial

```
We currently use...
```

Updated

```
We currently use Salesforce...
```

Final

```
We currently use Salesforce Sales Cloud Enterprise.
```

Downstream modules must understand transcript revisions.

---

# 17. Candidate Evaluation

The following open-source projects should be evaluated before implementation.

## Faster Whisper

Advantages

- Excellent accuracy
- Active community
- GPU acceleration
- CPU fallback
- Production ready

Disadvantages

- Requires additional streaming orchestration

---

## WhisperLive

Advantages

- Native streaming
- Low latency
- Designed specifically for live transcription

Disadvantages

- Smaller ecosystem
- Less mature than Faster Whisper

---

## WhisperX

Advantages

- Superior timestamp alignment
- Excellent transcript correction
- Better diarization integration

Disadvantages

- Higher computational cost

---

## Architecture Decision

Phase 1 should benchmark all three implementations using identical datasets.

Selection criteria include:

- Latency
- GPU utilization
- Memory usage
- Accuracy
- Docker compatibility
- Community maintenance
- Documentation quality

The implementation must remain provider-agnostic.

---

# 18. Partial vs Final Transcript

The Speech Engine emits two transcript types.

## Partial Transcript

Characteristics

- Fast
- Low confidence
- Frequently updated

Purpose

Provide immediate visual feedback.

---

## Final Transcript

Characteristics

- Stable
- High confidence
- Immutable

Purpose

Used for:

- Event Detection
- RAG
- Recommendations

Only final transcripts should trigger expensive AI operations.

---

# 19. Transcript Stabilization

Streaming speech models often revise earlier words.

Example

Initial

```
We use...

```

Updated

```
We use Sales...

```

Final

```
We use Salesforce CRM.
```

The Transcript Stabilizer is responsible for determining when text is sufficiently stable for downstream processing.

This avoids repeatedly invoking expensive AI pipelines.

---

# 20. Speaker Diarization

Speaker Diarization determines who is speaking.

This is significantly more complex than traditional transcription.

The AI Engine should distinguish:

Salesperson

Customer

Unknown Speaker

Future versions may support named participants.

---

# 21. Multi-Speaker Meetings

The Desktop Agent captures:

Microphone

Desktop Audio

Desktop audio may contain multiple remote participants.

Example

```
John

Sarah

Mike

You
```

The Diarization Engine should identify distinct remote speakers whenever possible.

Rather than assigning names, speakers should initially receive identifiers.

Example

```
Customer-1

Customer-2

Customer-3
```

Future versions may map these identifiers to participant names.

---

# 22. Speaker Timeline

Each transcript fragment should include:

```
Speaker

Start Timestamp

End Timestamp

Confidence

Transcript
```

Example

```
Speaker:
Customer-1

Start:
00:12:18

End:
00:12:24

Confidence:
0.94

Transcript:
We're currently evaluating alternatives.
```

This structured representation becomes the canonical conversation record.

---

# 23. Overlapping Speech

Enterprise meetings frequently contain interruptions.

Example

```
Customer

We're—

Salesperson

Sorry to interrupt...
```

The pipeline must preserve both utterances.

Transcripts should never merge overlapping speakers.

Downstream modules should receive separate conversation events.

---

# 24. Confidence Scores

Every transcript fragment must include confidence.

Example

```
0.99

Very High

0.91

High

0.74

Medium

0.42

Low
```

Modules should make decisions based on configurable confidence thresholds.

Low-confidence text should not trigger competitor detection or product recommendations.

---

# 25. Streaming Window

The Speech Pipeline operates on overlapping windows.

Example

```
Window A

0–5 seconds

Window B

3–8 seconds

Window C

6–11 seconds
```

Overlapping windows reduce transcription discontinuities and improve contextual understanding.

---

# 26. Output Contract

The Speech Pipeline should never return plain text alone.

Every transcript must include structured metadata.

Example

```json
{
  "speaker": "Customer-1",
  "text": "We currently use Salesforce.",
  "confidence": 0.96,
  "start": "00:14:18",
  "end": "00:14:22",
  "isFinal": true
}
```

Downstream modules consume this contract rather than raw strings.

---

# 27. Failure Handling

Expected failures include:

- Packet loss
- Temporary silence
- Device distortion
- Overlapping speech
- Background noise
- Incomplete sentences

The Speech Pipeline should degrade gracefully.

Whenever uncertainty exists, confidence scores should decrease rather than fabricating transcript content.

---

# 28. Guiding Principles

The Speech Intelligence Pipeline exists to provide reliable conversational structure.

It should prioritize:

- Accuracy over speed
- Streaming over batch processing
- Structured output over plain text
- Explainability over hidden reasoning
- Deterministic processing over unnecessary LLM usage

Every downstream intelligence capability depends on the correctness of this stage.

A poorly designed speech pipeline cannot be compensated for by a larger language model.

---

End of Part 2