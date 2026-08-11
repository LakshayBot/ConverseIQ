//! Local LLM model management + meeting summarization.
//!
//! Mirrors the local speech-model architecture (whisper_engine /
//! parakeet_engine): a GGUF model catalog, an installed/available/selected
//! state machine, download with streamed progress events, and a local
//! inference path. Inference runs on the user's machine through the bundled
//! llama-helper sidecar (llama.cpp) - no API key, no transcript bytes ever
//! leave the device. The backend only ever receives the finished, structured
//! summary.

pub mod commands;
pub mod helper;
pub mod model_manager;
pub mod models;
pub mod summary;

/// Desktop-local summarization configuration (persisted in
/// `summarization-config.json` via tauri-plugin-store, same as the STT
/// transcript-config.json pattern).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    /// Selected model id (see `models::SUMMARY_MODEL_CATALOG`), or None.
    pub model: Option<String>,
    /// Auto-summarize when a meeting ends (defaults true).
    pub auto_summarize: Option<bool>,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            model: None,
            auto_summarize: Some(true),
        }
    }
}
