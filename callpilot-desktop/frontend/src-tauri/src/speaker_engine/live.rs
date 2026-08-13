//! Live (incremental) speaker identification for an active recording.
//!
//! Decoupled from the transcription pipeline by design: the STT worker
//! forwards final (VAD-complete) 16 kHz mono chunks through an unbounded
//! channel and never waits for diarization. A background task owns the
//! diar-helper sidecar (spawned lazily on the first chunk), extracts a
//! speaker embedding per chunk, matches it against the meeting's
//! `SpeakerSession` profiles, and emits `speaker-assignment` events that the
//! frontend applies to the matching transcript segment by sequence id.
//!
//! Meeting-level speaker state (uuid + label per SpeakerSession profile) is
//! kept here so the frontend can persist speakers + assignments at
//! end-of-recording without re-running inference.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc::UnboundedSender;

use super::helper::{helper_available, DiarHelper};
use super::model_manager;
use super::models::get_model_by_id;
use super::session::SpeakerSession;
use super::DiarConfig;

/// One final VAD chunk forwarded from the transcription worker.
#[derive(Debug, Clone)]
pub struct LiveChunk {
    pub sequence: u64,
    pub samples: Vec<f32>,
    /// Recording-relative start time in seconds.
    pub start: f32,
    /// Recording-relative end time in seconds.
    pub end: f32,
}

/// Minimum segment duration for a meaningful embedding (~1.5 s @ 16 kHz).
const MIN_EMBED_SECS: f32 = 1.2;
/// Cap the embedded portion of very long segments (first N seconds).
const MAX_EMBED_SECS: f32 = 20.0;

/// Handles live diarization for one recording. Cheap to clone (channel
/// sender); the background task owns the sidecar + session.
#[derive(Clone)]
pub struct LiveDiarization {
    tx: UnboundedSender<LiveChunk>,
    /// Resolved model paths (shared with the task).
    tier_dir: Arc<PathBuf>,
    embedding_model: Arc<PathBuf>,
    threshold: f32,
    floor: f32,
}

impl LiveDiarization {
    /// Builds the runtime when speaker identification is enabled for live
    /// meetings and the selected model + helper are available; None
    /// otherwise (transcription must never depend on diarization).
    pub async fn try_new<R: Runtime>(app: &AppHandle<R>, config: &DiarConfig) -> Option<Self> {
        if !config.enabled.unwrap_or(false) {
            return None;
        }
        let model_id = config.model.as_deref()?;
        let def = get_model_by_id(model_id)?;
        if !helper_available(app) {
            log::warn!("speaker identification enabled but diar-helper is unavailable");
            return None;
        }
        let tier_dir = model_manager::validate_downloaded(app, def.id).ok()?;
        let embedding_model = tier_dir.join(def.embedding_file);
        if !embedding_model.exists() {
            return None;
        }

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<LiveChunk>();
        let runtime = Self {
            tx,
            tier_dir: Arc::new(tier_dir),
            embedding_model: Arc::new(embedding_model),
            threshold: def.similarity_threshold,
            floor: def.similarity_floor,
        };
        let task = runtime.clone();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            task.run(app_handle, rx).await;
        });
        Some(runtime)
    }

    /// Non-blocking: forwards a final chunk to the diarization task.
    /// Returns false when the task is gone (transcription never blocks).
    pub fn send_chunk(&self, chunk: LiveChunk) -> bool {
        self.tx.send(chunk).is_ok()
    }

    async fn run<R: Runtime>(
        self,
        app: AppHandle<R>,
        mut rx: tokio::sync::mpsc::UnboundedReceiver<LiveChunk>,
    ) {
        let mut helper: Option<DiarHelper> = None;
        let mut session = SpeakerSession::new(self.threshold, self.floor);
        // sequence -> (speaker uuid, label). The uuid is minted once per
        // profile so saved segments reference stable ids.
        let mut speaker_uuids: HashMap<u32, String> = HashMap::new();
        // Assignments by transcript sequence id (for the meeting-end save).
        let mut assignments: HashMap<u64, (String, String)> = HashMap::new();

        while let Some(chunk) = rx.recv().await {
            let duration = chunk.end - chunk.start;
            if duration < MIN_EMBED_SECS {
                continue;
            }

            // Lazy sidecar spawn on first usable chunk.
            if helper.is_none() {
                match DiarHelper::spawn(&app).await {
                    Ok(h) => {
                        log::info!("live speaker diarization started");
                        helper = Some(h);
                    }
                    Err(e) => {
                        log::warn!("live speaker diarization unavailable: {e}");
                        return;
                    }
                }
            }

            // Cap the embedded portion for very long segments.
            let samples: Vec<f32> = if duration > MAX_EMBED_SECS {
                let cap = (MAX_EMBED_SECS * 16000.0) as usize;
                chunk.samples.iter().take(cap).copied().collect()
            } else {
                chunk.samples
            };

            let Some(h) = helper.as_mut() else {
                continue;
            };
            let embedding = match h.embed(&samples, &self.embedding_model).await {
                Ok(e) => e,
                Err(e) => {
                    log::debug!("speaker embedding failed (seq {}): {e}", chunk.sequence);
                    continue;
                }
            };

            let assignment = session.assign(&embedding, duration, chunk.start);
            let (speaker_id, label) = match assignment {
                super::session::Assignment::Matched { speaker, label, .. } => {
                    let uuid = speaker_uuids
                        .entry(speaker)
                        .or_insert_with(|| uuid::Uuid::new_v4().to_string())
                        .clone();
                    (uuid, label)
                }
                super::session::Assignment::Identifying => continue,
            };

            assignments.insert(chunk.sequence, (speaker_id.clone(), label.clone()));
            let _ = app.emit(
                "speaker-assignment",
                serde_json::json!({
                    "sequenceId": chunk.sequence,
                    "speakerId": speaker_id,
                    "label": label,
                }),
            );
        }

        if let Some(mut h) = helper {
            let _ = h.shutdown().await;
        }
        log::info!("live speaker diarization stopped");
    }
}
