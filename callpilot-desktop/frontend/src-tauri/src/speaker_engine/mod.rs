//! Local speaker diarization (meeting speaker identification).
//!
//! Runs through the bundled `diar-helper` sidecar (sherpa-onnx) - the same
//! sidecar pattern as the `llm_engine` llama-helper. Two tiers of models are
//! downloadable from within the app into `app_data_dir/models/diarization/`:
//! a fast tier (eres2net base + int8 pyannote segmentation) and an accurate
//! tier (titanet large + fp32 segmentation). Nothing leaves the device.
//!
//! Live meetings run incremental speaker matching in `session` (per-meeting
//! speaker profiles + cosine similarity + stabilization); completed/old
//! meetings use offline diarization of the saved recording in `commands`
//! (diar_identify_meeting) aligned to the existing transcript timestamps -
//! never a re-transcription.

pub mod commands;
pub mod helper;
pub mod live;
pub mod model_manager;
pub mod models;
pub mod session;

use serde::{Deserialize, Serialize};

/// Persisted speaker-identification config (tauri-store `diarization-config.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiarConfig {
    /// Whether live speaker identification runs during recordings.
    pub enabled: Option<bool>,
    /// Selected model tier id ("fast" | "accurate").
    pub model: Option<String>,
}

impl Default for DiarConfig {
    fn default() -> Self {
        Self {
            enabled: Some(false),
            model: None,
        }
    }
}
