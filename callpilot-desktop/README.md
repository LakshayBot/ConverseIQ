# CallPilot Desktop

CallPilot AI's desktop agent - Tauri 2 + Rust audio core + Next.js UI.

Adapted from [Meetily](https://github.com/Zackriya-Solutions/meetily) (MIT).
See [`ADAPTATION_NOTES.md`](./ADAPTATION_NOTES.md) for the full component-by-component analysis of what was kept, adapted, and removed.

## What it does

Live transcription + speaker labels for sales calls, wired to the CallPilot AI engine for real-time intelligence cards (competitor mentions, objections, product matches, etc.).

- **Local STT** via whisper-rs (ggml-tiny.en / ggml-base.en / ggml-small.en) or NVIDIA Parakeet TDT 0.6B (ONNX).
- **Mic + system audio** capture with cpal; professional mixing and VAD unchanged from Meetily.
- **Intelligence panel** streams cards from `ws://<AI_ENGINE_URL>/ws/intelligence/{session_id}`.
- **REST client** targets the CallPilot .NET Gateway at `http://<API_URL>` (default `http://localhost:5000`).
- **Session history** kept in a local SQLite cache.

## Quick start

```bash
# install JS deps
cd frontend
pnpm install

# build the UI
pnpm build

# launch in dev mode (Rust + UI together, needs Xcode on macOS)
pnpm tauri:dev
```

Both URLs are configurable from **Settings → CallPilot**.

## Layout

```
callpilot-desktop/
├── Cargo.toml                 workspace
├── ADAPTATION_NOTES.md        every keep/adapt/remove decision, with reasons
├── LICENSE.md                 MIT (inherited from Meetily)
├── frontend/
│   ├── src/                   Next.js 14 app
│   │   ├── lib/
│   │   │   ├── callpilot.ts        settings keys + default URLs
│   │   │   ├── callpilotApi.ts     REST client (login, meetings, etc.)
│   │   │   └── speakerLabels.ts    mic → REP, system → PROSPECT
│   │   ├── hooks/
│   │   │   └── useIntelligenceStream.ts
│   │   ├── components/
│   │   │   ├── IntelligencePanel.tsx
│   │   │   └── CallPilotServerSettings.tsx
│   │   └── app/page.tsx           mounts the Intelligence panel next to the live transcript
│   └── src-tauri/                 Rust core
│       └── src/api/api.rs         CallPilot-aware HTTP client + new Tauri commands
```

## Build requirements

- **macOS**: full Xcode (Command Line Tools alone are insufficient - `cidre` runs `xcodebuild`).
- **Windows / Linux**: standard Tauri toolchain.
- **Node 22+** for the frontend.
- **Rust 1.88+** - pinned via `frontend/src-tauri/rust-toolchain.toml` to satisfy upstream deps (cidre, darling, icu, time, plist, serde_with) that require it. Meetily's declared `rust-version = "1.77"` is too old for those transitive crates.

## What was removed (and why)

Per the brief, only:

- The summary/meeting-summary screen + all summary generation logic.
- Meetily's FastAPI backend (`backend/`).
- Local Ollama / Groq / OpenRouter / Anthropic / OpenAI summary providers.
- PostHog analytics.
- Meetily's git history, CI, docs.

Everything else (Rust audio stack, Whisper + Parakeet engines, tray icon, window management, recovery, device selectors, settings, transcript rendering, onboarding) was kept and adapted in place. See `ADAPTATION_NOTES.md` for the full inventory.
