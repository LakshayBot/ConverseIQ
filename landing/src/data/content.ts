// ============================================================================
// CallPilot — central content store.
// One source of truth for every word on the page. Components import from here.
// ============================================================================

export type Speaker = 'rep' | 'prospect'

export interface TranscriptLine {
  id: string
  speaker: Speaker
  time: string
  text: string
  /** When true, this line is still being dictated (partial) */
  partial?: boolean
}

export type Severity = 'high' | 'medium' | 'low'
export type IntelligenceKind =
  | 'product'
  | 'competitor'
  | 'objection'
  | 'pricing'
  | 'technical'
  | 'recommendation'

export interface IntelligenceCard {
  id: string
  kind: IntelligenceKind
  severity: Severity
  /** Trigger that fired this card */
  trigger: string
  /** Headline shown bold */
  title: string
  /** Body — talking point or supporting fact */
  body: string
  /** Knowledge chunk source(s) — first 80 chars */
  sources?: string[]
  /** Time into the call when it landed */
  landedAt: string
}

export interface Capability {
  num: string
  label: string
  title: string
  body: string
  meta: string
}


export interface FAQItem {
  q: string
  a: string
}

export interface SpecRow {
  signal: string
  trigger: string
  response: string
  confidence: string
}

export interface ArchitectureStage {
  num: string
  title: string
  detail: string
  meta: string
}

// ----------------------------------------------------------------------------
// Hero — the live intelligence feed
// ----------------------------------------------------------------------------

export const HERO_LINES: TranscriptLine[] = [
  {
    id: 'l1',
    speaker: 'rep',
    time: '14:32:08',
    text: 'Before we go further — do you have any concerns about data residency?',
  },
  {
    id: 'l2',
    speaker: 'prospect',
    time: '14:32:14',
    text: 'Honestly yes. Our security team flags anything that touches a third-party cloud. We run Salesforce but we audit everything.',
  },
  {
    id: 'l3',
    speaker: 'rep',
    time: '14:32:23',
    text: 'Makes sense. We can run entirely in your VPC — STT, LLM, knowledge store, all of it.',
  },
  {
    id: 'l4',
    speaker: 'prospect',
    time: '14:32:31',
    text: 'What does that look like versus Gong, which we already use?',
  },
  {
    id: 'l5',
    speaker: 'rep',
    time: '14:32:38',
    text: "Gong records everything and stores it. We don't record. We surface live, in the moment, on your hardware.",
  },
]

export const HERO_CARDS: IntelligenceCard[] = [
  {
    id: 'c1',
    kind: 'objection',
    severity: 'high',
    trigger: '"data residency" · "security team"',
    title: 'Security objection · data sovereignty',
    body: 'Lead with self-hosted, then unpack: Docker Compose on the customer VPC, BYOK LLM key, no audio persisted. Salesken has the same posture on paper; match their technical depth.',
    sources: [
      'security-brief.md · "All processing on customer infrastructure"',
      'objection-bank/security.md · recommended response',
    ],
    landedAt: '14:32:14',
  },
  {
    id: 'c2',
    kind: 'competitor',
    severity: 'medium',
    trigger: 'competitor_detected · "Gong"',
    title: 'Gong comparison',
    body: 'Frame the wedge: Gong records, transcribes, summarizes after. CallPilot transcribes, detects, and surfaces mid-utterance, on-prem. Use the no-recording posture to land.',
    sources: ['competitor/gong.md · pricing', 'competitor/gong.md · privacy posture'],
    landedAt: '14:32:31',
  },
  {
    id: 'c3',
    kind: 'product',
    severity: 'high',
    trigger: 'product_match · "STT, LLM, knowledge store"',
    title: 'Self-hosted deployment card',
    body: 'Reference customer runbook: Tauri desktop + .NET 10 server + Python AI engine, single `docker compose up`, Parakeet on-device fallback. Available on the docs site.',
    landedAt: '14:32:23',
  },
  {
    id: 'c4',
    kind: 'technical',
    severity: 'low',
    trigger: 'technical_question · "What does that look like"',
    title: 'Architecture diagram — ready to share',
    body: 'Open the Knowledge card "Self-hosted deployment" → Sources: three tabs showing audio capture, AI engine, and the recommendation layer. Toggle show on customer share.',
    landedAt: '14:32:38',
  },
]

// ----------------------------------------------------------------------------
// Capabilities — six chapters in the feature storytelling section
// ----------------------------------------------------------------------------

export const CAPABILITIES: Capability[] = [
  {
    num: '01',
    label: 'Detection',
    title: 'Six signal types, fired in a single utterance.',
    body: 'Trie-precise entity recognition. Regex-precise intent. Every turn checked. Confidence scored. Debounced. No double-fires.',
    meta: 'Aho-Corasick + regex · 60s debounce · 200ms inference',
  },
  {
    num: '02',
    label: 'Knowledge',
    title: 'Grounded in your own documentation.',
    body: 'Upload product sheets, security briefs, competitor battle cards. The system reads them once and answers from them forever. Top-3 cosine retrieval, enriched chunks 1.2× priority.',
    meta: '384-dim all-MiniLM-L6-v2 · Docling + GLiNER + Groq',
  },
  {
    num: '03',
    label: 'Local transcription',
    title: 'On the rep’s CPU, not in the cloud.',
    body: 'Nemotron on the server, Parakeet on the desktop, Whisper as a third wheel. No audio leaves the machine. No third-party bot joins the call.',
    meta: 'Nemotron 0.6b · 200ms emit · 8s partial window',
  },
  {
    num: '04',
    label: 'BYO model',
    title: 'Your key. Your model. Your choice.',
    body: 'Bring your own LLM key. DeepSeek, Ollama, OpenAI — and the recommendation engine will route the talking point through whichever you wire up. No per-seat pricing.',
    meta: 'OpenAI-compatible · Ollama local · env-only',
  },
  {
    num: '05',
    label: 'Open source',
    title: 'The whole stack, on GitHub.',
    body: 'MIT-licensed. Server, AI engine, desktop, frontend — every component you can read, fork, and ship. No proprietary STT models behind a wall.',
    meta: 'MIT · ~28k★ upstream · CallPilot lineage on record',
  },
  {
    num: '06',
    label: 'No recording',
    title: 'The audio never persists.',
    body: 'Live detection happens on the streaming buffer. When the call ends, the buffer drops. We don’t archive what we don’t need to.',
    meta: 'Two-party consent honored · buffer-only · auditable',
  },
]

// ----------------------------------------------------------------------------
// Use cases — three real personas the product serves today
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Spec sheet — what the system actually detects, with examples
// ----------------------------------------------------------------------------

export const SPECS: SpecRow[] = [
  {
    signal: 'ProductMentioned',
    trigger: 'Aho-Corasick over the live transcript (entity ≥ 4 chars, brand-acronym allowlist)',
    response: 'Talking-point card + knowledge chunks for the named product',
    confidence: '0.92',
  },
  {
    signal: 'PricingDiscussion',
    trigger: 'Trie match on a registered pricing entity (e.g. tier name)',
    response: 'Pricing guidance card with talking-point grounded in the rate card',
    confidence: '0.92',
  },
  {
    signal: 'PricingQuestion',
    trigger: 'Regex on four canonical phrasings ("how much", "what does it cost")',
    response: 'Pricing reference card with quoted source paragraph',
    confidence: '0.88',
  },
  {
    signal: 'Objection',
    trigger: 'Regex across six sub-types (Price, Security, Migration, Integration, Timeline, Competitor)',
    response: 'Objection-handling card matched to the sub-type',
    confidence: '0.85',
  },
  {
    signal: 'TechnicalQuestion',
    trigger: 'Trie on integration / feature entities, plus TECHNICAL_PATTERNS regex',
    response: 'Technical reference card with the canonical answer',
    confidence: '0.84',
  },
  {
    signal: 'CompetitorMentioned',
    trigger: 'Heuristic classifier on unknown entities (proximity + sentence context) + LLM fallback',
    response: 'Comparison card with talking points + Tavily-fed intel (7-day cache)',
    confidence: '0.92 / 0.95 (heuristic / LLM)',
  },
]

// ----------------------------------------------------------------------------
// Architecture — the three-stage pipeline
// ----------------------------------------------------------------------------

export const PIPELINE: ArchitectureStage[] = [
  {
    num: '01',
    title: 'Capture',
    detail:
      'FFmpeg pulls system audio + mic at 16 kHz mono, 40 ms frames. Streamed over SignalR to the .NET server, then forwarded to Nemotron.',
    meta: 'PCM16 · 16 kHz · 40 ms',
  },
  {
    num: '02',
    title: 'Detect',
    detail:
      'Nemotron returns partials every 200 ms. On each final, Aho-Corasick + regex scan for the six signal types. Debounced 60 s per (meeting, signal, entity).',
    meta: 'Nemotron 0.6b · 200ms emit · 60s debounce',
  },
  {
    num: '03',
    title: 'Surface',
    detail:
      'For each event, RecommendationEngine assembles a card: talking point, key facts (≤ 3), priority (high / medium / low), sources. Broadcast over SignalR. UI surfaces within ~300 ms.',
    meta: 'BYOK LLM · ~300 ms · severity-coded',
  },
]

// ----------------------------------------------------------------------------
// Latency numbers — the real ones, from the codebase
// ----------------------------------------------------------------------------

export const LATENCY = [
  { label: 'First partial after speech', value: '~320 ms', sub: 'Nemotron MIN_CHUNK_MS' },
  { label: 'Emit interval', value: '200 ms', sub: 'NEMOTRON_EMIT_INTERVAL_MS' },
  { label: 'Partial window', value: '8 s', sub: 'NEMOTRON_PARTIAL_WINDOW_SEC' },
  { label: 'Card land to UI', value: '~300 ms', sub: 'SignalR broadcast · event → recommendation' },
  { label: 'Event debounce', value: '60 s', sub: 'Per (meeting, signal, entity)' },
  { label: 'Enrichment per page', value: '30 s', sub: 'Groq · no retry · fail-open' },
  { label: 'Competitor intel cache', value: '7 days', sub: 'Tavily-backed, Redis-keyed' },
] as const

// ----------------------------------------------------------------------------
// Stack — what it actually runs on (honest)
// ----------------------------------------------------------------------------

export const STACK = [
  { layer: 'Audio capture', tech: 'FFmpeg · Tauri cpal · Silero VAD', local: true },
  { layer: 'Speech-to-text', tech: 'Nemotron 0.6b · Parakeet TDT · Whisper', local: true },
  { layer: 'Entity detection', tech: 'Aho-Corasick trie · GLiNER · regex', local: true },
  { layer: 'Knowledge retrieval', tech: 'all-MiniLM-L6-v2 · cosine (in-process)', local: true },
  { layer: 'Recommendation LLM', tech: 'BYOK — Ollama · DeepSeek · OpenAI-compat', local: true },
  { layer: 'Knowledge enrichment', tech: 'Groq · llama-3.1-8b-instant', local: false },
  { layer: 'Competitive intel', tech: 'Tavily search + 7-day Redis cache', local: false },
  { layer: 'Server', tech: '.NET 10 · ASP.NET · SignalR · EF Core', local: true },
  { layer: 'AI engine', tech: 'Python 3.13 · FastAPI · Docling', local: true },
  { layer: 'Database', tech: 'PostgreSQL 17 · pgvector (image)', local: true },
] as const

// ----------------------------------------------------------------------------
// Pricing — honest
// ----------------------------------------------------------------------------

export const PRICING = {
  selfHosted: {
    label: 'Self-hosted',
    price: '$0',
    cadence: 'forever',
    body: 'Run it on your hardware, your VPC, your air-gapped network. MIT-licensed. You bring your own LLM key and your own inference bill. There is no CallPilot subscription to buy.',
    points: [
      'Every component · server, AI engine, desktop, dashboard',
      'Updates via Git · no auto-telemetry, no call-home',
      'Single `docker compose up`',
    ],
  },
  optional: {
    label: 'Optional managed',
    price: '$—',
    cadence: 'on request',
    body: 'If your team would rather not run Postgres at 2 a.m., we can host the platform for you. Pricing is per-deployment and depends on your seat count, region, and SLAs.',
    points: ['EU / US regions', 'Single-tenant VPC', 'Hand-off within 14 days'],
  },
}

// ----------------------------------------------------------------------------
// FAQ — answered in the voice
// ----------------------------------------------------------------------------

export const FAQ: FAQItem[] = [
  {
    q: 'Is the call recorded?',
    a: 'No. CallPilot detects and surfaces on a streaming buffer. When the call ends, the buffer drops. We don’t archive audio. We don’t write audio to disk at any point.',
  },
  {
    q: 'What language model runs the recommendations?',
    a: 'Whatever you wire up. CallPilot ships with an OpenAI-compatible client and tested integrations for Ollama, DeepSeek, and OpenAI-compatible endpoints. You provide the key. We never proxy to a default model.',
  },
  {
    q: 'Does it join my call as a bot?',
    a: 'No. Capture happens on the rep’s machine — mic and system audio, no participant entry, no calendar plug-in. The buyer never sees CallPilot in their meeting UI.',
  },
  {
    q: 'What languages are supported?',
    a: 'Nemotron handles English out of the box. The pipeline is language-agnostic; bring a multilingual STT model and the rest follows.',
  },
  {
    q: 'How is this different from Gong, Clari, or Outreach Kaia?',
    a: 'Those record. They store. They’re cloud-only. They’re sales-gated. They bundle into a revenue-operations platform. CallPilot does one thing — surfaces live intelligence during the call — and it runs on your hardware, with your key, open-sourced.',
  },
  {
    q: 'Can I evaluate it without self-hosting?',
    a: 'Spin up `docker compose up` against the local repo. The full pipeline runs on a laptop with 16 GB of RAM. First Nemotron load takes 30–60 s; everything after is real-time.',
  },
]

// ----------------------------------------------------------------------------
// Manifesto — one line, used on the problem section
// ----------------------------------------------------------------------------

export const MANIFESTO = [
  'Most AI meeting tools record the call, transcribe it, summarize it, and ship a recap.',
  'The recap arrives when it can’t help you — the call is already over.',
  'CallPilot surfaces during the call, on your machine, with your model, in front of the question still being asked.',
]
// ----------------------------------------------------------------------------
// Signal lab — six detections, each with a live micro-demo
// ----------------------------------------------------------------------------

export interface SignalDemo {
  id: string
  index: string
  name: string
  event: string
  tagline: string
  trigger: string
  snippet: string
  highlight: string[]
  confidence: string
  body: string
}

export const SIGNAL_DEMOS: SignalDemo[] = [
  {
    id: 'product',
    index: '01',
    name: 'Product match',
    event: 'ProductMentioned',
    tagline: 'Your portfolio, recognised mid-sentence.',
    trigger: 'trie · "Apex 100"',
    snippet: 'We are rolling out the Apex 100 across four sites this quarter.',
    highlight: ['Apex 100'],
    confidence: '0.92',
    body: 'Surface the product card: 500+ endpoints per gateway, OTA firmware updates, API-based billing.',
  },
  {
    id: 'pricing',
    index: '02',
    name: 'Pricing discussion',
    event: 'PricingDiscussion',
    tagline: 'The moment money enters the room.',
    trigger: 'trie · pricing entity',
    snippet: 'The Pro tier at forty-eight hundred a year covers what exactly?',
    highlight: ['Pro tier'],
    confidence: '0.92',
    body: 'Open the rate card at the exact tier they named, with the source paragraph attached.',
  },
  {
    id: 'objection',
    index: '03',
    name: 'Objection',
    event: 'Objection · security',
    tagline: 'Six sub-types, caught as they form.',
    trigger: 'regex · security objection',
    snippet: 'We cannot put customer data in a third-party cloud. It is a hard no.',
    highlight: ['third-party cloud'],
    confidence: '0.85',
    body: 'Answer with the self-hosted posture: Docker Compose in their VPC, BYOK LLM, no audio persisted.',
  },
  {
    id: 'technical',
    index: '04',
    name: 'Technical question',
    event: 'TechnicalQuestion',
    tagline: 'SAML, SCIM, APIs — answered from your docs.',
    trigger: 'trie + regex · SCIM / SSO',
    snippet: 'Does it support SCIM provisioning and SAML single sign-on?',
    highlight: ['SCIM', 'SAML'],
    confidence: '0.84',
    body: 'Pull the canonical answer from the integration docs — with the source paragraph, verbatim.',
  },
  {
    id: 'competitor',
    index: '05',
    name: 'Competitor mention',
    event: 'CompetitorMentioned',
    tagline: 'They named your competitor. You answer.',
    trigger: 'classifier · "we use Gong"',
    snippet: 'We already use Gong for call tracking across the team.',
    highlight: ['Gong'],
    confidence: '0.92 / 0.95',
    body: 'A comparison card: what they record and store, what you surface and drop — with talking points.',
  },
  {
    id: 'pricing-q',
    index: '06',
    name: 'Pricing question',
    event: 'PricingQuestion',
    tagline: '"How much?" — answered before the pause.',
    trigger: 'regex · "how much"',
    snippet: 'How much does the enterprise license run per year?',
    highlight: ['How much'],
    confidence: '0.88',
    body: 'Quote the pricing reference card, grounded in the rate card you uploaded.',
  },
]

// ----------------------------------------------------------------------------
// Card anatomy — the intelligence card, annotated
// ----------------------------------------------------------------------------

export interface AnatomyNote {
  id: string
  num: string
  label: string
  detail: string
}

export const ANATOMY_NOTES: AnatomyNote[] = [
  {
    id: 'n1',
    num: '01',
    label: 'Type badge',
    detail: 'What fired the card — the signal type, named in the product vocabulary.',
  },
  {
    id: 'n2',
    num: '02',
    label: 'Priority',
    detail: 'How loud the signal is. High / medium / low, coded on the left edge.',
  },
  {
    id: 'n3',
    num: '03',
    label: 'Headline',
    detail: 'The trigger, named. The card is a claim, and the claim is specific.',
  },
  {
    id: 'n4',
    num: '04',
    label: 'Talking point',
    detail: 'What to say next, in the rep voice — never a wall of text.',
  },
  {
    id: 'n5',
    num: '05',
    label: 'Sources',
    detail: 'The receipts. Every claim links to the exact knowledge chunk it came from.',
  },
]

// ----------------------------------------------------------------------------
// Architecture — diagram nodes
// ----------------------------------------------------------------------------

export interface ArchNode {
  id: string
  label: string
  title: string
  tech: string[]
  meta: string
}

export const ARCH_NODES: ArchNode[] = [
  {
    id: 'capture',
    label: '01 · On the rep machine',
    title: 'Capture',
    tech: ['FFmpeg', 'cpal', 'Silero VAD'],
    meta: 'PCM16 · 16 kHz · 40 ms frames · no bot in the room',
  },
  {
    id: 'server',
    label: '02 · In your infrastructure',
    title: 'Server',
    tech: ['.NET 10', 'SignalR', 'PostgreSQL 17', 'Redis'],
    meta: 'self-hosted · single docker compose up',
  },
  {
    id: 'engine',
    label: '03 · In your model stack',
    title: 'AI engine',
    tech: ['Nemotron', 'Aho-Corasick', 'GLiNER', 'BYOK LLM'],
    meta: 'partials every 200 ms · card to rail in ~300 ms',
  },
]

// ----------------------------------------------------------------------------
// Use cases — three people the product serves
// ----------------------------------------------------------------------------

export interface UseCase {
  id: string
  index: string
  persona: string
  headline: string
  scenario: string
  surface: string[]
}

export const USE_CASES_NEW: UseCase[] = [
  {
    id: 'uc-1',
    index: '01',
    persona: 'Enterprise AE',
    headline: 'Walk into the security review already armed.',
    scenario:
      'A buyer mentions SOC 2, data residency, vendor lock-in. Three cards land in your rail before they finish the sentence — one per objection. You answer with the exact paragraph from their security brief.',
    surface: ['Live intelligence rail', 'Talking-point cards', 'Knowledge bank'],
  },
  {
    id: 'uc-2',
    index: '02',
    persona: 'Founder / solo seller',
    headline: 'Sell like the best rep on your team.',
    scenario:
      'You wear five hats. CallPilot reads your docs once, listens to the live call, and feeds you the next sentence — battle cards, pricing guidance and product comparisons, surfaced mid-utterance.',
    surface: ['Live intelligence rail', 'Talking-point cards', 'Knowledge bank'],
  },
  {
    id: 'uc-3',
    index: '03',
    persona: 'Solutions engineer',
    headline: 'Technical questions answered without breaking flow.',
    scenario:
      'They ask about SAML, SCIM, API rate limits, region availability. The system matches against your product docs and surfaces the canonical answer with the source paragraph.',
    surface: ['Live intelligence rail', 'Technical-question cards', 'Source chunks'],
  },
]
