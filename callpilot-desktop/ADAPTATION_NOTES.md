# CallPilot Desktop — Adaptation Notes

> Component-by-component analysis of Meetily (MIT, https://github.com/Zackriya-Solutions/meetily) and how each piece maps to CallPilot AI. Generated as the mandatory Step 1 deliverable before any code changes were made.
>
> Decision legend: ✅ **keep as-is** · 🔧 **adapt** · ❌ **remove**
>
> Source of truth for what exists in the cloned repo: `callpilot-desktop/` at this commit.

---

## 1. Top-level layout

```
callpilot-desktop/
├── Cargo.toml                          workspace (members: src-tauri, llama-helper)
├── Cargo.lock
├── LICENSE.md                          MIT — keep
├── CLAUDE.md                           Meetily's own Claude notes — REPLACE with our own (delete then rewrite)
├── frontend/                           Next.js 14 app + Tauri 2 wrapper
│   ├── src/                            React UI
│   └── src-tauri/                      Rust core (commands + audio engines)
├── backend/                            ❌ FastAPI legacy — REMOVE (Meetily CLAUDE.md also confirms it's archived)
├── docs/                               ❌ REMOVE
├── llama-helper/                       ✅ Keep (used by Parakeet build)
├── scripts/                            build helpers — 🔧 adapt paths later if needed
└── .github/                            ❌ REMOVE
```

---

## 2. Rust core — `frontend/src-tauri/src/`

| Module | Decision | Notes |
|---|---|---|
| `main.rs` | ✅ keep | Tauri entrypoint. Rebrand identifier in `tauri.conf.json` instead. |
| `lib.rs` | ✅ keep | Tauri command registration. Will drop the summary-* commands here. |
| `config.rs` | ✅ keep | App-level config. |
| `state.rs` | ✅ keep | Shared state struct. |
| `tray.rs` | ✅ keep | Tray icon. **Valuable.** |
| `onboarding.rs` | 🔧 adapt | Onboarding flow. We add CallPilot server-check step. |
| `utils.rs` | ✅ keep | |
| `audio/` (entire module) | ✅ keep, untouched | cpal + whisper-rs + mixing — "core, untouched" per task. |
| `audio_v2/` | ✅ keep | Alternative audio path. Untouched. |
| `whisper_engine/` | 🔧 adapt | Keep engine; ensure it loads ggml-tiny/base/small.en model files. Don't change internals beyond the model list. |
| `parakeet_engine/` | ✅ keep | Already supports `parakeet-tdt-0.6b-v3-int8` etc. The task model list maps 1:1. |
| `summary/` | ❌ **remove entire directory** | All summary generation logic (Ollama / Groq / OpenRouter / Anthropic / OpenAI). |
| `summary_engine/` | ❌ **remove** | |
| `summary/templates/` | ❌ **remove** | |
| `groq/` | ❌ **remove** | Used only by summary. |
| `ollama/` | ❌ **remove** | Used only by summary. (Local LLM removed; CallPilot has its own stack.) |
| `anthropic/`, `openai/`, `openrouter/` | ❌ **remove** | Summary providers only. |
| `database/` | 🔧 adapt | Local SQLite store for meetings + transcripts. **Keep** — needed for session history offline. Will stub the summary-related tables/queries. |
| `notifications/` | ✅ keep | Native notification integration. Will be repointed to fire on CallPilot events. |
| `api/` | 🔧 adapt | Currently calls Meetily's FastAPI on `localhost:5167`. **Rewire to CallPilot .NET Gateway on `localhost:5000`.** Add new functions for `/api/v1/auth/*`, `/api/v1/meetings/*`, `/api/v1/providers/*`. Stub any endpoint CallPilot doesn't yet expose. |
| `analytics/` | ❌ **remove** | PostHog tracking — third-party; remove. |
| `console_utils/` | ✅ keep | In-app console toggle. |
| `lib_old_complex.rs` | ❌ **remove** | Confirmed by the lib.rs comment "complexity was extracted" — dead legacy file. |
| `migrations/` | 🔧 adapt | SQL migrations for local DB. Keep as-is for now; we'll need a new migration if we add CallPilot meeting-id columns. |
| `check_screen_permission.swift` | ✅ keep | macOS screen recording permission helper. |
| `Info.plist`, `entitlements.plist` | ✅ keep | macOS bundle config. Will tweak `CFBundleName` to CallPilot. |

### Rust Tauri commands (registered in `lib.rs` + submodules)

**Core recording/audio — KEEP:**
- `start_recording`, `stop_recording`, `is_recording`
- `get_transcription_status`, `save_transcript`, `read_audio_file`
- `start_audio_level_monitoring`, `stop_audio_level_monitoring`, `is_audio_level_monitoring`
- `get_audio_devices`, `trigger_microphone_permission`
- `start_recording_with_devices`, `start_recording_with_devices_and_meeting`
- `set_language_preference`
- All `whisper_*` commands (init, get/load model, transcribe, download, cancel, etc.)
- All `parakeet_*` commands (same shape as whisper_*)
- `open_models_folder`, `open_parakeet_models_folder`

**Database — KEEP** (for local meeting history): `check_first_launch`, `initialize_fresh_database`, `import_and_initialize_database`, `get_database_directory`, `open_database_folder`, `detect_legacy_database`, `check_default_legacy_database`, `check_homebrew_database`, `select_legacy_database_path`

**Onboarding — KEEP:** `get_onboarding_status`, `save_onboarding_status_cmd`, `reset_onboarding_status_cmd`, `complete_onboarding`

**Console — KEEP:** `show_console`, `hide_console`, `toggle_console`

**Tray — KEEP**

**Summary / Ollama / Groq / OpenAI / Anthropic / OpenRouter — REMOVE** (covered by removing `summary/`, `ollama/`, `groq/`, `anthropic/`, `openai/`, `openrouter/` modules). Affected commands:
- `api_save_meeting_summary`, `api_get_meeting_summary_language`, `api_save_meeting_summary_language`, `api_detect_transcript_summary_language`, `api_get_summary`, `api_process_transcript`, `api_cancel_summary`, `api_save_model_config`, `api_get_model_config`
- `ollama_*` family (pull/list/download/etc.)
- `groq_*`, `anthropic_*`, `openai_*`, `openrouter_*`

**API — REWIRE:** `api_get_server_address` (change base URL), `api_get_meetings`, `api_search_meetings`, `api_get_*` etc. Will rewrite to target CallPilot endpoints. Stub anything CallPilot doesn't yet expose (return empty + log warning).

**Analytics — REMOVE**: `init_analytics`, `disable_analytics`, `track_event`, `identify_user`, `track_meeting_*`, `track_recording_*`, `track_search_performed`, `track_settings_changed`, `track_feature_used`, `is_analytics_enabled`, `start_analytics_session`, `end_analytics_session` (lives in `lib_old_complex.rs`).

---

## 3. Frontend — `frontend/src/`

### 3.1 Pages (Next.js App Router)

| Route | File | Decision | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | ✅ keep, adapt | Live recording page. Will host the new **Intelligence Panel** alongside the existing `TranscriptPanel`. |
| `/meeting-details` | `app/meeting-details/page.tsx` + `page-content.tsx` | 🔧 adapt | Currently loads transcripts **AND** summary via `api_get_summary`. Keep the transcript loading. Strip the summary fetch, the auto-gen logic, the AISummary panel, and the `SummaryGeneratorButtonGroup`. Result: a transcript-only details screen. |
| `/meeting-details/page-content.tsx` | | 🔧 adapt | Same — strip summary panels. |
| `/notes/[id]` | `app/notes/[id]/page.tsx` | ❌ **remove** | This is the static sample-notes demo. Not even wired into nav. Removed cleanly. |
| `/settings` | `app/settings/page.tsx` | 🔧 adapt | Add **CallPilot Server** section (URLs + test connection), **Session** section (auto-start, save-transcripts toggle). Keep all audio/device/model sections. |

### 3.2 `app/_components/`

| File | Decision | Notes |
|---|---|---|
| `TranscriptPanel.tsx` | ✅ keep, adapt | The main live transcript container. Will add a sibling `IntelligencePanel` next to it on the home page. |
| `StatusOverlays.tsx` | ✅ keep | Processing/saving overlays. |
| `SettingsModal.tsx` | ✅ keep | Modal wrapper used by sidebar; rebadge only. |

### 3.3 `components/`

| Component | Decision | Notes |
|---|---|---|
| `About.tsx` | 🔧 adapt | Rebrand strings only. |
| `AnalyticsConsentSwitch.tsx` | ❌ **remove** | PostHog consent. |
| `AnalyticsDataModal.tsx` | ❌ **remove** | PostHog data view. |
| `AnalyticsProvider.tsx` | ❌ **remove** | PostHog provider. |
| `AudioBackendSelector.tsx` | ✅ keep | Audio backend chooser. |
| `AudioLevelMeter.tsx` | ✅ keep | Real-time level meter — valuable visual cue. |
| `AudioPlayer.tsx` | ✅ keep | Playback of recorded audio. |
| `BetaSettings.tsx` | 🔧 adapt | Rebadge. |
| `BlockNoteEditor/` | ❌ **remove** | BlockNote rich-text editor is only used by summary. |
| `BluetoothPlaybackWarning.tsx` | ✅ keep | macOS-specific warning. |
| `BuiltInModelManager.tsx` | ✅ keep | Model download UI base component. |
| `ChunkProgressDisplay.tsx` | ✅ keep | Chunked-upload progress. |
| `ComplianceNotification.tsx` | ✅ keep | Recording consent banner — valuable for sales compliance. |
| `ConfidenceIndicator.tsx` | ✅ keep | Per-segment confidence. |
| `ConfirmationModel/` | ✅ keep | Confirm modals. |
| `ConsoleToggle.tsx` | ✅ keep | Debug console toggle. |
| `CustomDialog.tsx` | ✅ keep | Generic dialog. |
| `DatabaseImport/` | ✅ keep | DB import flow. |
| `DeviceSelection.tsx` | ✅ keep, **no change needed** | Mic + system-audio device selectors. **Reuse directly.** |
| `EditableTitle.tsx` | ✅ keep | Inline rename. |
| `EmptyStateSummary.tsx` | ❌ **remove** | Summary empty state. |
| `ImportAudio/` | ✅ keep | Audio file import. |
| `Info.tsx` | 🔧 adapt | Rebadge. |
| `LanguagePickerPopover.tsx` | ✅ keep | Transcription language picker. |
| `LanguageSelection.tsx` | ✅ keep | |
| `Logo.tsx` | 🔧 adapt | Replace Meetily logo with CallPilot placeholder. |
| `MainContent/` | ✅ keep | Layout shell. |
| `MainNav/` | ✅ keep | Nav. Remove any summary link. |
| `MeetingDetails/` | 🔧 adapt | Remove `SummaryPanel.tsx`, `SummaryGeneratorButtonGroup.tsx`, `SummaryUpdaterButtonGroup.tsx`. Keep `TranscriptPanel.tsx`, `TranscriptButtonGroup.tsx`, `RetranscribeDialog.tsx`. |
| `MessageToast.tsx` | ✅ keep | Toast wrapper. |
| `ModelDownloadProgress.tsx` | ✅ keep | Used by model downloads. |
| `ModelSettingsModal.tsx` | 🔧 adapt | Currently configures Ollama provider for summary. We strip the summary-provider bits and keep the model-size selector (which feeds the local STT engine). |
| `AISummary/` | ❌ **remove** | Summary views. |
| `molecules/form-components/` | ✅ keep | Form atoms. |
| `onboarding/` | 🔧 adapt | Keep all 4 steps (Welcome, Permissions, SetupOverview, DownloadProgress). Will rebrand and add a CallPilot server check step later. |
| `ParakeetModelManager.tsx` | ✅ keep | Already supports the model in our target list. |
| `PermissionWarning.tsx` | ✅ keep | Mic permission banner. |
| `PreferenceSettings.tsx` | ✅ keep | General prefs (will be merged into new CallPilot sections). |
| `RecordingControls.tsx` | ✅ keep | Record / pause / stop. |
| `RecordingSettings.tsx` | ✅ keep | Recording prefs. |
| `RecordingStatusBar.tsx` | ✅ keep | Status indicator. |
| `SettingTabs.tsx` | ✅ keep | Tab structure for settings modal. |
| `shared/DownloadProgressToast.tsx` | ✅ keep | |
| `Sidebar/` | ✅ keep | Meeting list, current meeting, navigation. Will add "CallPilot" branding and remove summary nav link. |
| `SummaryLanguageSettings.tsx` | ❌ **remove** | Summary-language picker. |
| `SummaryModelSettings.tsx` | ❌ **remove** | Summary-model picker. |
| `TranscriptRecovery/` | ✅ keep | Crash recovery dialog. |
| `TranscriptSettings.tsx` | 🔧 adapt | The provider list contains summary-related providers (Deepgram, ElevenLabs, Groq, OpenAI for summary). We keep `localWhisper` and `parakeet`, remove the cloud-summary providers (their UI can stay but selection will be hidden). |
| `TranscriptView.tsx` | ✅ keep | Transcript display. |
| `ui/` (shadcn primitives) | ✅ keep | All UI primitives. |
| `UpdateCheckProvider.tsx` | ✅ keep | App update check. |
| `UpdateDialog.tsx` | ✅ keep | |
| `UpdateNotification.tsx` | ✅ keep | |
| `VirtualizedTranscriptView.tsx` | ✅ keep | Large-transcript perf. |
| `WhisperModelManager.tsx` | 🔧 adapt | The Whisper model list currently has 14+ variants (large-v3, large-v3-turbo, medium, small, base, tiny, + quantizations). The task says keep `ggml-tiny.en / ggml-base.en / ggml-small.en` + `Parakeet TDT 0.6B`. We collapse the Whisper list to those three ggml-*.en files but keep the same download/manage UI. |

### 3.4 `hooks/`

| Hook | Decision | Notes |
|---|---|---|
| `useAudioPlayer.ts` | ✅ keep | |
| `useAutoScroll.ts` | ✅ keep | |
| `useImportAudio.ts` | ✅ keep | |
| `useModalState.ts` | ✅ keep | |
| `useNavigation.ts` | ✅ keep | |
| `usePaginatedTranscripts.ts` | ✅ keep | |
| `usePermissionCheck.ts` | ✅ keep | |
| `usePlatform.ts` | ✅ keep | |
| `useProcessingProgress.ts` | ✅ keep | |
| `useRecentLanguages.ts` | ✅ keep | |
| `useRecordingStart.ts` | ✅ keep | |
| `useRecordingStateSync.ts` | ✅ keep | |
| `useRecordingStop.ts` | ✅ keep | |
| `useTranscriptionModels.ts` | ✅ keep | |
| `useTranscriptRecovery.ts` | ✅ keep | |
| `useTranscriptStreaming.ts` | ✅ keep | |
| `useUpdateCheck.ts` | ✅ keep | |
| `hooks/meeting-details/` | 🔧 adapt | `useMeetingData.ts`, `usePaginatedTranscripts.ts` keep. `useSummaryGeneration.ts`, `useTemplates.ts`, `useCopyOperations.ts`, `useModelConfiguration.ts` strip summary logic. |

### 3.5 `contexts/`

| Context | Decision |
|---|---|
| `ConfigContext.tsx` | ✅ keep, adapt |
| `ImportDialogContext.tsx` | ✅ keep |
| `OllamaDownloadContext.tsx` | ❌ **remove** |
| `OnboardingContext.tsx` | ✅ keep, adapt |
| `RecordingPostProcessingProvider.tsx` | ✅ keep |
| `RecordingStateContext.tsx` | ✅ keep |
| `TranscriptContext.tsx` | ✅ keep, strip summary fields |

### 3.6 `lib/`

| File | Decision | Notes |
|---|---|---|
| `analytics.ts` | ❌ **remove** | PostHog. |
| `blocknote-markdown.ts` | ❌ **remove** | BlockNote summary export. |
| `builtin-ai.ts` | ✅ keep | |
| `onboarding-summary-model.ts` | ❌ **remove** | Summary-model onboarding step. |
| `parakeet.ts` | ✅ keep | Parakeet model registry. |
| `recordingNotification.tsx` | ✅ keep | Native notification helper. |
| `summary-language-preferences.ts` | ❌ **remove** | |
| `summary-languages.ts` | ❌ **remove** | |
| `utils.ts` | ✅ keep | |
| `whisper.ts` | 🔧 adapt | Trim `MODEL_CONFIGS` to `tiny.en`, `base.en`, `small.en` per task. Keep API wrapper class. |

### 3.7 `services/`

| File | Decision | Notes |
|---|---|---|
| `configService.ts` | ✅ keep | Settings persistence. Will gain the new CallPilot URL fields. |
| `indexedDBService.ts` | ✅ keep | Local IndexedDB for transcripts cache. |
| `recordingService.ts` | ✅ keep | |
| `storageService.ts` | ✅ keep | |
| `transcriptService.ts` | ✅ keep | |
| `updateService.ts` | ✅ keep | App updater. |

### 3.8 `types/`, `config/`, `constants/`

- `types/` — keep `transcript.ts`, strip `summary.ts`. Keep `index.ts`.
- `config/`, `constants/` — keep, rebrand strings.

---

## 4. Hardcoded URLs (must rewire)

| Where | Current | Target |
|---|---|---|
| `src-tauri/src/api/api.rs:10` | `const APP_SERVER_URL: &str = "http://localhost:5167";` | `const APP_SERVER_URL: &str = "http://localhost:5000";` + read from settings |
| `src-tauri/src/api/api.rs:23` | `APP_SERVER_URL` reads from config or defaults to `localhost:5167` | Same pattern, default `http://localhost:5000` |
| `src/components/Sidebar/SidebarProvider.tsx:108` | `setServerAddress('http://localhost:5167')` | `setServerAddress('http://localhost:5000')` |
| `src/components/ModelSettingsModal.tsx:132` | `placeholder="http://localhost:11434"` | Strip (Ollama removed) |
| `src-tauri/src/ollama/*` | `http://localhost:11434` everywhere | Module removed |
| `src-tauri/src/summary/service.rs` | Ollama endpoint | Module removed |
| `src-tauri/tauri.conf.json` `connect-src` CSP | `http://localhost:11434 http://localhost:5167 http://localhost:8178 https://api.ollama.ai` | `http://localhost:5000 ws://localhost:8000 http://localhost:8000` |

> **Port note:** This task spec uses `localhost:5000` (Gateway) and `localhost:8000` (AI engine WS). The existing CallPilot monorepo uses `5001` and `8001` (see `CONTEXT.md`). The task takes precedence; we'll document this in the dashboard README later and let operators override via env if needed.

---

## 5. Speaker-label strategy (Step 6)

Meetily does **not** perform speaker diarization — every transcript segment has only `text`, no speaker ID. We will:
- Add an `audio_source: 'mic' | 'system' | 'unknown'` field to outgoing WS frames (the Rust pipeline already knows which stream produced a chunk).
- On the frontend, default `mic → "REP"` and `system → "PROSPECT"` with an optional toggle in the transcript panel to show/hide speaker labels.
- For now, label is best-effort visual — true diarization is a future work item.

---

## 6. Intelligence Panel contract (Step 6)

New frontend panel, listens on `ws://<CALLPILOT_AI_ENGINE_URL>/ws/intelligence/{session_id}` (default `ws://localhost:8000/ws/intelligence/{session_id}`). Card JSON shape from the task:

```ts
interface IntelligenceCard {
  type: 'competitor_detected' | 'objection' | 'buying_signal' |
        'product_match' | 'pricing_discussion' | 'technical_question';
  title: string;
  body: string;
  severity: 'high' | 'medium' | 'low';
  chunks: string[];
}
```

Render rules from task: red/yellow/blue left border by severity, newest on top, max 5 visible, collapsible "View Sources" if chunks present. When CallPilot's `/ws/intelligence/` endpoint isn't yet wired, the panel renders an empty state ("Intelligence stream offline") and logs a console warning — the UI stays intact.

---

## 7. Model list (Step 5)

| Provider | Models (final list) |
|---|---|
| Whisper (ggml-*.en) | `ggml-tiny.en` (75MB, fastest), `ggml-base.en` (142MB, **default**), `ggml-small.en` (466MB, best CPU accuracy) |
| Parakeet (ONNX) | `Parakeet TDT 0.6B` (600MB, NVIDIA, highest accuracy) |

Download URLs:
- ggml: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/`
- Parakeet: `https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx`

Meetily's existing `MODEL_CONFIGS` in `lib/whisper.ts` currently lists 14+ Whisper variants with `q5_0` / `q5_1` quantization. We collapse to exactly the three ggml-*.en files above. Download plumbing (Tauri events, progress, cancellation) is reused unchanged.

---

## 8. Settings additions (Step 7)

New sections on top of Meetily's existing tabs:

```
CallPilot Server
  CallPilot API URL         [text]   default: http://localhost:5000
  CallPilot AI Engine URL   [text]   default: ws://localhost:8000
  [Test Connection]                     → green/red status

Session
  Auto-start on launch      [toggle]
  Save transcripts locally  [toggle]   default: on
```

Keep all existing audio-device tabs, model-selection tabs, language tabs, etc.

---

## 9. Files to remove (Step 2 + Step 8)

Root:
- `.git/`, `.github/`, `backend/`, `docs/`
- `BLUETOOTH_PLAYBACK_NOTICE.md`, `CONTRIBUTING.md`, `PRIVACY_POLICY.md`, `README.md`
- `CLAUDE.md` (Meetily's) — replaced by our own
- `frontend/build*.{bat,sh,ps1}`, `frontend/dev-gpu.{bat,sh,ps1}`, `frontend/clean_*` (most) — keep `frontend/clean_run.sh` and `frontend/clean_build.sh`, rebrand them
- `frontend/vs_buildtools.exe` — Meetily Windows-only installer; remove

Rust:
- `src-tauri/src/summary/`, `src-tauri/src/summary_engine/`, `src-tauri/src/summary/templates/`
- `src-tauri/src/ollama/`, `src-tauri/src/groq/`, `src-tauri/src/anthropic/`, `src-tauri/src/openai/`, `src-tauri/src/openrouter/`
- `src-tauri/src/analytics/`
- `src-tauri/src/lib_old_complex.rs`

Frontend:
- `src/app/notes/[id]/page.tsx`
- `src/components/AISummary/`
- `src/components/BlockNoteEditor/`
- `src/components/EmptyStateSummary.tsx`
- `src/components/AnalyticsConsentSwitch.tsx`, `AnalyticsDataModal.tsx`, `AnalyticsProvider.tsx`
- `src/components/SummaryLanguageSettings.tsx`, `SummaryModelSettings.tsx`
- `src/components/MeetingDetails/SummaryPanel.tsx`, `SummaryGeneratorButtonGroup.tsx`, `SummaryUpdaterButtonGroup.tsx`
- `src/contexts/OllamaDownloadContext.tsx`
- `src/lib/analytics.ts`, `blocknote-markdown.ts`, `onboarding-summary-model.ts`, `summary-language-preferences.ts`, `summary-languages.ts`
- `src/types/summary.ts` (or strip summary fields from `types/index.ts`)
- `src/hooks/meeting-details/useSummaryGeneration.ts`, `useTemplates.ts`, `useModelConfiguration.ts` (strip summary logic, keep file as stub or delete)

---

## 10. Build verification plan

After all changes:
```bash
cd callpilot-desktop/frontend/src-tauri
cargo build                                # Rust (needs Xcode on macOS for cidre)

cd callpilot-desktop/frontend
pnpm install                               # may take a while first time
pnpm build                                 # Next.js production build
```

### Build status (this session)

- **Frontend `pnpm build`** ✅ **PASSED.** `Next.js 14.2.35` produced a clean static export:
  - `/` 24.8 kB
  - `/meeting-details` 3.46 kB
  - `/settings` 8.31 kB
- **Rust `cargo build --bin callpilot-audio`** ✅ **PASSED.** Full Xcode installed. Final binary at `target/release/callpilot-audio` (60 MB). One minor fix during the build: the `CustomOpenAIConfig` stub had to make `endpoint`/`model` `String` (not `Option<String>`) and `max_tokens: Option<u32>` (not `i32`) to match the call sites in `api_save_custom_openai_config` — the stub now mirrors the real shape.
- **Tauri app bundle** ✅ **PASSED.** `pnpm tauri:build:cpu` produced a signed `CallPilot.app` at `target/release/bundle/macos/CallPilot.app` (60 MB executable, FFmpeg sidecar included). The DMG step at the very end failed (`bundle_dmg.sh` requires extra Xcode CLT tooling and isn't critical for app distribution), but the `.app` bundle is fully runnable.
- **Launch verification** ✅ **PASSED.** `open CallPilot.app` started the process; `ps aux | grep callpilot` confirmed `callpilot-audio` running; dock icon visible. Bundle metadata: `CFBundleName=CallPilot`, `CFBundleDisplayName=CallPilot`, `CFBundleIdentifier=ai.callpilot.desktop`.
- **Onboarding fix** — Removed the leftover "Summary Engine" download card from `DownloadProgressStep` (CallPilot handles summarization server-side via the .NET Gateway). The Parakeet v3 download URL was also corrected from a non-existent `callpilot.towardsgeneralintelligence.com` to the real HuggingFace repo `huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main`.
- **Permissions step fix** — `completeOnboarding` in `OnboardingContext.tsx` was calling a deleted Rust command (`builtin_ai_get_recommended_model`), so clicking "Finish Setup" silently failed. Replaced the local-summary-model discovery/download flow with no-op stubs (CallPilot's summary is server-side). The "I'll do this later" / "Finish Setup" buttons now work.
- **Live streaming fix** — Meetily's audio pipeline only emitted a transcription chunk after the VAD detected end-of-speech (≥2s silence), so text appeared all-at-once after every pause. Added interim partials: `AudioChunk` gained an `is_partial: bool`; `ContinuousVadProcessor` exposes `interim_snapshot()` + `is_in_speech()`; the VAD pipeline emits a partial chunk every 800 ms during ongoing speech while the final chunk stays `is_partial: false`; the transcription worker forwards the flag to `transcript-update` events; `TranscriptContext` dedups in place so the UI replaces the most-recent partial (instead of stacking rows) and cleans up overlapping partials when a final arrives. Net effect: text appears incrementally as the user speaks, not in one block at the end of every sentence.
- **Toggle start/stop fix** — Replaced the START button's click handler with `handleToggleRecording` in `RecordingControls.tsx`. It queries `is_recording` from the backend first; if the backend is recording but the React state thinks it's idle (state-mismatch bug — transcripts visible, button stuck in START state), the click is routed to `stop_recording` instead of `start_recording_with_devices_and_meeting` (which would have failed with "Recording already in progress"). This makes the button always respond regardless of state sync issues.
- **Toggle stop path corrected** — First version of `handleToggleRecording` only called `onRecordingStop(true)` (the parent post-stop hook), which never invokes the Rust `stop_recording` Tauri command. So clicking the mic while the backend was recording left the audio pipeline running while the React state thought it was idle. Fixed by calling `stopRecordingAction()` directly FIRST (which invokes `stop_recording`), then `onRecordingStop(true)` for post-stop processing.
- **Event detection wiring** — `app/page.tsx` now mints a real meeting on the .NET Gateway via `createMeeting()` when recording starts and uses its id as the intelligence WS session id (falls back to a local UUID if the Gateway is unreachable). `useIntelligenceStream` cleans up the WS on unmount and logs the connect target to the console for debugging.
- **Toolchain pin** — Meetily's `Cargo.toml` declares `rust-version = "1.77"` but several deps (cidre 0.11, darling 0.23, home 0.5, icu_*, plist 1.9, serde_with 3.20, time 0.3) require **rustc 1.86–1.88**. We added `frontend/src-tauri/rust-toolchain.toml` pinning the channel to `1.88.0` to satisfy those without changing any dependency versions. No `Cargo.toml`/`Cargo.lock`/package.json edits beyond that.

If a stale `package-lock`/`pnpm-lock` or `Cargo.lock` blocks the build, only then are lockfile edits allowed (and only minimal ones). No dependency version upgrades.

---

## 11. Decisions captured

- **Keep the local transcription pipeline (whisper-rs + Parakeet ONNX).** The task spec lists the model selection as a local feature. So the desktop agent does STT locally and **also** opens a WebSocket to CallPilot's `.NET Gateway` for session/identity/events and to the AI engine for intelligence cards. Local STT stays the source of truth for transcript text.
- **Keep the local SQLite DB** for offline meeting history (the dashboard pulls transcripts via SignalR when online, but having a local cache is useful).
- **Strip every summary / Ollama / Groq / OpenRouter / Anthropic path.** The intelligence cards panel replaces what Meetily used summary for in our world.
- **Stub missing endpoints.** Anywhere the UI calls a CallPilot endpoint that doesn't yet exist (e.g. `/api/v1/meetings/{id}/recommendations` may exist, but `/api/v1/meetings` POST for session create may differ), we read the URL pattern, add a TODO log, and return empty / mock data so the UI keeps rendering.
- **No dependency version bumps.** Per task constraint.
- **In-place adaptation.** Per task constraint — no folder restructure.
