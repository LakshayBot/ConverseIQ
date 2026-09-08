# e2e Feature-Test Fixtures

Fixtures for `tests/e2e/test_features.py` (the contextual-matching / action
item / debounce feature suite). These extend — never replace — the baseline
fixtures (`tests/e2e/sample/secure-meters-product-guide.md`,
`samples/audio_files_samples/sales-call-secure.mp3`).

## audio/

Real per-turn audio is **symlinked** (never copied) from
`samples/audio_files_samples/sales_call_turns/` — turn indices follow
`samples/sales-call-script-secure.txt` (odd = seller, even = buyer):

| Fixture | Source | Content |
|---|---|---|
| `prospect_ct_pain.aiff` | `turn_02_buyer.aiff` | Buyer: Landis Plus Gyre CT units, accuracy drifts after six months, external CT installations are a nightmare — the canonical contextual-match turn |
| `rep_product_mention.aiff` | `turn_03_seller.aiff` | Seller: "That's exactly why I wanted to show you Prodigy… current transformers are built-in" |
| `prospect_pricing_objection.aiff` | `turn_10_buyer.aiff` | Buyer: Elster pricing fifteen percent lower — can you compete on that |
| `prospect_ct_pain_synth.wav` | generated | 3s 220 Hz sine, amplitude 0.15 — **NOT speech**. Exists only to exercise pipeline plumbing (frame slicing, hub POST, VAD gating) without any STT dependency |
| `silence_flush.wav` | generated | 1s digital silence — VAD flush source |

Naming deviation from the spec: symlinks keep the `.aiff` extension of their
target so soundfile's format sniffing works reliably.

## transcripts/

Ground-truth turn text. Used for (a) direct calls to
`POST /api/v1/ai/contextual-match` when STT of the replayed audio is not
accurate enough to assert on (Test B's documented fallback path), and
(b) the action-item extraction input (Test E).

- `ct_pain_turn.txt` — the contextual-match trigger sentence lives here.
- `pricing_objection_turn.txt`
- `product_mention_turn.txt`

## knowledge/

- `prodigy_battle_card.md` — the knowledge chunk the contextual matcher must
  hit for the CT pain turn. **Lexical overlap is deliberate**: "accuracy
  drifts after about six months", "external CT installations", "built-in",
  "thread-through" appear in both the turn text and the card so that the
  sentence-level all-MiniLM embedding clears the 0.72 threshold. Ingested by
  the suite's session fixture before any contextual assertion runs.

## What these fixtures deliberately do NOT do

- **No TTS.** Generating speech programmatically would add a model
  dependency to the suite. Semantic-match assertions therefore run through
  the direct Python endpoint (`/api/v1/ai/contextual-match`) with injected
  text; audio replay asserts pipeline plumbing (events flow, debounce
  timing, source gating) rather than STT accuracy.
- **No baseline.json coupling.** The feature suite keeps its own
  expectations inline (thresholds, counts, payload shapes); `baseline.json`
  is untouched so the regression suite behaviour is unchanged.
