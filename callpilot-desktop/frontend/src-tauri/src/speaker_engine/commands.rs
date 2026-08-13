//! Tauri commands for speaker diarization: model management, config, and the
//! offline "Identify Speakers" job for completed/historical meetings.
//!
//! Live (incremental) identification is wired into the recording pipeline in
//! `audio/recording_commands` via `speaker_engine::session` - see Stage 5.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;

use super::helper::{helper_available, DiarHelper};
use super::model_manager;
use super::models::{get_model_by_id, DiarModelDef};
use super::session::SpeakerSession;
use super::DiarConfig;

const CONFIG_STORE: &str = "diarization-config.json";

fn load_config<R: Runtime>(app: &AppHandle<R>) -> DiarConfig {
    if let Ok(store) = app.store(CONFIG_STORE) {
        let enabled = store.get("enabled").and_then(|v| v.as_bool());
        let model = store.get("model").and_then(|v| v.as_str().map(String::from));
        return DiarConfig {
            enabled,
            model,
        };
    }
    DiarConfig::default()
}

fn save_config<R: Runtime>(app: &AppHandle<R>, config: &DiarConfig) {
    if let Ok(store) = app.store(CONFIG_STORE) {
        store.set("enabled", serde_json::Value::Bool(config.enabled.unwrap_or(false)));
        store.set(
            "model",
            config
                .model
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        let _ = store.save();
    }
}

// ── Config ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn diar_get_config<R: Runtime>(app: AppHandle<R>) -> Result<DiarConfig, String> {
    Ok(load_config(&app))
}

#[tauri::command]
pub async fn diar_set_config<R: Runtime>(
    app: AppHandle<R>,
    enabled: Option<bool>,
    model: Option<String>,
) -> Result<DiarConfig, String> {
    let mut config = load_config(&app);
    if let Some(e) = enabled {
        config.enabled = Some(e);
    }
    if let Some(m) = model {
        config.model = Some(m);
    }
    save_config(&app, &config);
    Ok(config)
}

// ── Model management ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn diar_get_models<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<model_manager::ModelInfo>, String> {
    let config = load_config(&app);
    Ok(model_manager::list_models(
        &app,
        config.model.as_deref(),
        helper_available(&app),
    ))
}

#[tauri::command]
pub async fn diar_pull_model<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    let def = get_model_by_id(&name).ok_or_else(|| format!("Unknown model: {name}"))?;
    let app_for_emit = app.clone();
    let name_for_progress = name.clone();
    let result = model_manager::download_model(&app, def, move |progress| {
        let _ = app_for_emit.emit(
            "diar-model-download-progress",
            serde_json::json!({
                "modelName": name_for_progress,
                "progress": progress.percent,
                "downloadedMb": progress.downloaded_mb,
                "totalMb": progress.total_mb,
                "speedMbps": progress.speed_mbps,
            }),
        );
    })
    .await;

    match result {
        Ok(()) => {
            let _ = app.emit(
                "diar-model-download-complete",
                serde_json::json!({ "modelName": name }),
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "diar-model-download-error",
                serde_json::json!({ "modelName": name, "error": e }),
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn diar_cancel_download<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    model_manager::cancel_download(&app, &name);
    Ok(())
}

#[tauri::command]
pub async fn diar_delete_model<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    model_manager::delete_model(&app, &name)
}

// ── Offline "Identify Speakers" job (completed / historical meetings) ──────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingJobStatus {
    pub meeting_id: String,
    pub state: String, // "processing" | "completed" | "failed"
    pub stage: String, // "decoding" | "diarizing" | "aligning" | "saving" | "done"
    pub progress: u8,
    pub error: Option<String>,
    pub speakers_found: Option<u32>,
}

struct MeetingJob {
    state: String,
    stage: String,
    progress: u8,
    error: Option<String>,
    speakers_found: Option<u32>,
    cancel: bool,
}

static JOBS: OnceLock<RwLock<HashMap<String, MeetingJob>>> = OnceLock::new();

fn jobs() -> &'static RwLock<HashMap<String, MeetingJob>> {
    JOBS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn update_job(meeting_id: &str, f: impl FnOnce(&mut MeetingJob)) {
    if let Ok(mut guard) = jobs().write() {
        if let Some(job) = guard.get_mut(meeting_id) {
            f(job);
        }
    }
}

fn emit_job<R: Runtime>(app: &AppHandle<R>, meeting_id: &str, status: &MeetingJobStatus) {
    let _ = app.emit("diar-meeting-progress", status);
}

#[tauri::command]
pub async fn diar_get_meeting_status<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<Option<MeetingJobStatus>, String> {
    let guard = jobs().read().unwrap();
    let job = guard.get(&meeting_id).map(|j| MeetingJobStatus {
        meeting_id: meeting_id.clone(),
        state: j.state.clone(),
        stage: j.stage.clone(),
        progress: j.progress,
        error: j.error.clone(),
        speakers_found: j.speakers_found,
    });
    let _ = app;
    Ok(job)
}

#[tauri::command]
pub async fn diar_cancel_identify<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<(), String> {
    let _ = app;
    update_job(&meeting_id, |j| j.cancel = true);
    Ok(())
}

/// Reads the .NET server URL + auth token and performs a JSON API call.
/// Mirrors `crate::api::api::callpilot_api_request` internals.
async fn api_call<R: Runtime>(
    app: &AppHandle<R>,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let server_url = crate::api::api::get_callpilot_api_url(app.clone()).await?;
    let url = format!("{}{}", server_url.trim_end_matches('/'), path);
    let client = reqwest::Client::new();
    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        other => return Err(format!("Unsupported method: {other}")),
    };
    request = request.header("Content-Type", "application/json");
    if let Ok(Some(token)) = crate::auth::commands::get_auth_access_token(app.clone()).await {
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
    }
    if let Some(json) = body {
        request = request.body(json.to_string());
    }
    let response = request
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("backend request failed: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    if status >= 200 && status < 300 {
        if text.is_empty() {
            Ok(serde_json::json!({ "ok": true }))
        } else {
            match serde_json::from_str(&text) {
                Ok(v) => Ok(v),
                Err(_) => Ok(serde_json::json!({ "data": text })),
            }
        }
    } else {
        Err(format!("HTTP {status}: {text}"))
    }
}

/// Decodes the meeting's saved recording to a 16 kHz mono WAV via the bundled
/// ffmpeg (the diarization sidecar requires 16 kHz mono WAV input).
fn decode_to_16k_wav(recording_path: &PathBuf, out_wav: &PathBuf) -> Result<(), String> {
    let ffmpeg = crate::audio::ffmpeg::find_ffmpeg_path()
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let output = std::process::Command::new(&ffmpeg)
        .arg("-y")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(recording_path)
        .arg("-ar")
        .arg("16000")
        .arg("-ac")
        .arg("1")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(out_wav)
        .output()
        .map_err(|e| format!("failed to run ffmpeg: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg decode failed: {}",
            String::from_utf8_lossy(&output.stderr).chars().take(400).collect::<String>()
        ));
    }
    Ok(())
}

/// Aligns diarization turns to the existing transcript segments by timestamp
/// overlap (never re-transcribes). Returns (segmentIdx -> cluster index).
fn align_turns(
    segments: &[(f64, f64)],
    turns: &[super::helper::DiarSegment],
) -> Vec<Option<u32>> {
    segments
        .iter()
        .map(|(start, end)| {
            let mut best: Option<(f32, u32)> = None;
            for turn in turns {
                let overlap = (end.min(turn.end as f64) - start.max(turn.start as f64)).max(0.0);
                if overlap >= 0.2 && best.map(|(b, _)| overlap as f32 > b).unwrap_or(true) {
                    best = Some((overlap as f32, turn.speaker));
                }
            }
            best.map(|(_, s)| s)
        })
        .collect()
}

/// Runs offline speaker identification for a meeting. Background task; the
/// frontend polls `diar_get_meeting_status` / listens to
/// `diar-meeting-progress`. The original transcript is never modified until
/// the whole pipeline succeeds (diarization is an enrichment layer).
#[tauri::command]
pub async fn diar_identify_meeting<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    num_speakers: Option<u32>,
    model: Option<String>,
) -> Result<(), String> {
    let config = load_config(&app);
    let model_id = model.or(config.model);
    let def = get_model_by_id(model_id.as_deref().unwrap_or("")).ok_or_else(|| {
        "No speaker identification model selected. Download one in Settings, then try again."
            .to_string()
    })?;

    if !helper_available(&app) {
        return Err(
            "The bundled diarization engine (diar-helper) is unavailable in this build. Reinstall or rebuild the application to restore speaker identification.".to_string(),
        );
    }
    let tier_dir = model_manager::validate_downloaded(&app, def.id)?;

    {
        let mut guard = jobs().write().unwrap();
        if guard
            .get(&meeting_id)
            .map(|j| j.state == "processing")
            .unwrap_or(false)
        {
            return Err("Speaker identification is already running for this meeting".to_string());
        }
        guard.insert(
            meeting_id.clone(),
            MeetingJob {
                state: "processing".to_string(),
                stage: "decoding".to_string(),
                progress: 0,
                error: None,
                speakers_found: None,
                cancel: false,
            },
        );
    }

    let app_handle = app.clone();
    let meeting_id_handle = meeting_id.clone();
    let def_handle: &'static DiarModelDef = def;
    let tier_dir_handle = tier_dir.clone();

    tauri::async_runtime::spawn(async move {
        let app = app_handle;
        let meeting_id = meeting_id_handle;
        let def = def_handle;
        let tier_dir = tier_dir_handle;
        let job_failed = |app: &AppHandle<R>, meeting_id: &str, err: String| {
            update_job(meeting_id, |j| {
                j.state = "failed".to_string();
                j.error = Some(err.clone());
            });
            let _ = app.emit(
                "diar-meeting-error",
                serde_json::json!({ "meetingId": meeting_id, "error": err }),
            );
        };

        // 1) Fetch meeting folder + transcripts.
        let meeting = match api_call(&app, "GET", &format!("/api/v1/meetings/{meeting_id}"), None)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                job_failed(&app, &meeting_id, format!("Could not load meeting: {e}"));
                return;
            }
        };
        let folder_path = meeting
            .get("folderPath")
            .and_then(|v| v.as_str())
            .map(String::from);
        let Some(folder_path) = folder_path else {
            job_failed(&app, &meeting_id, "This meeting has no saved recording. Speaker identification needs the original audio.".to_string());
            return;
        };

        let transcripts = match api_call(
            &app,
            "GET",
            &format!("/api/v1/meetings/{meeting_id}/transcripts"),
            None,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                job_failed(&app, &meeting_id, format!("Could not load transcript: {e}"));
                return;
            }
        };
        let segments: Vec<(String, f64, f64)> = transcripts
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|s| {
                let id = s.get("id")?.as_str()?.to_string();
                let start = s.get("startOffset")?.as_f64()?;
                let end = s.get("endOffset").and_then(|v| v.as_f64()).unwrap_or(start);
                Some((id, start, end))
            })
            .collect();
        if segments.is_empty() {
            job_failed(&app, &meeting_id, "This meeting has no transcript segments.".to_string());
            return;
        }

        // 2) Locate + decode the recording.
        let recording = PathBuf::from(&folder_path).join("audio.mp4");
        if !recording.exists() {
            job_failed(&app, &meeting_id, "The meeting recording (audio.mp4) was not found on this machine.".to_string());
            return;
        }
        let wav_path = std::env::temp_dir().join(format!("callpilot-diar-{meeting_id}.wav"));
        update_job(&meeting_id, |j| {
            j.stage = "decoding".to_string();
            j.progress = 2;
        });
        let status = {
            let guard = jobs().read().unwrap();
            guard
                .get(&meeting_id)
                .map(|j| MeetingJobStatus {
                    meeting_id: meeting_id.clone(),
                    state: j.state.clone(),
                    stage: j.stage.clone(),
                    progress: j.progress,
                    error: j.error.clone(),
                    speakers_found: j.speakers_found,
                })
        };
        if let Some(s) = status {
            emit_job(&app, &meeting_id, &s);
        }
        if let Err(e) = decode_to_16k_wav(&recording, &wav_path) {
            job_failed(&app, &meeting_id, format!("Could not decode the recording: {e}"));
            return;
        }

        // 3) Run diarization.
        update_job(&meeting_id, |j| {
            j.stage = "diarizing".to_string();
            j.progress = 5;
        });
        let mut helper = match DiarHelper::spawn(&app).await {
            Ok(h) => h,
            Err(e) => {
                let _ = std::fs::remove_file(&wav_path);
                job_failed(&app, &meeting_id, e);
                return;
            }
        };
        let app_emit = app.clone();
        let meeting_id_emit = meeting_id.clone();
        let diar_result = helper
            .diarize(&wav_path, &tier_dir, def, num_speakers, move |percent| {
                update_job(&meeting_id_emit, |j| {
                    j.stage = "diarizing".to_string();
                    j.progress = 5 + (percent as u8 * 70 / 100);
                });
                let guard = jobs().read().unwrap();
                if let Some(job) = guard.get(&meeting_id_emit) {
                    let status = MeetingJobStatus {
                        meeting_id: meeting_id_emit.clone(),
                        state: job.state.clone(),
                        stage: job.stage.clone(),
                        progress: job.progress,
                        error: job.error.clone(),
                        speakers_found: job.speakers_found,
                    };
                    emit_job(&app_emit, &meeting_id_emit, &status);
                }
            })
            .await;
        let _ = std::fs::remove_file(&wav_path);

        let turns = match diar_result {
            Ok(t) => t,
            Err(e) => {
                let _ = helper.shutdown().await;
                job_failed(&app, &meeting_id, format!("Diarization failed: {e}"));
                return;
            }
        };
        {
            let cancel = jobs()
                .read()
                .unwrap()
                .get(&meeting_id)
                .map(|j| j.cancel)
                .unwrap_or(false);
            if cancel {
                update_job(&meeting_id, |j| {
                    j.state = "failed".to_string();
                    j.error = Some("Cancelled".to_string());
                });
                let _ = helper.shutdown().await;
                return;
            }
        }
        let _ = helper.shutdown().await;

        // 4) Align turns to existing transcript segments.
        update_job(&meeting_id, |j| {
            j.stage = "aligning".to_string();
            j.progress = 78;
        });
        let bounds: Vec<(f64, f64)> = segments.iter().map(|(_, s, e)| (*s, *e)).collect();
        let aligned = align_turns(&bounds, &turns);

        let assigned: Vec<(usize, u32)> = aligned
            .iter()
            .enumerate()
            .filter_map(|(i, cluster)| cluster.map(|c| (i, c)))
            .collect();
        if assigned.is_empty() {
            job_failed(&app, &meeting_id, "No speech segments were found in the recording.".to_string());
            return;
        }

        // Stable speaker ids: cluster index -> uuid, ordered by first
        // appearance so labels read Speaker 1/2/... in talk order.
        let mut cluster_to_uuid: HashMap<u32, String> = HashMap::new();
        let mut order: Vec<u32> = Vec::new();
        for (_, cluster) in &assigned {
            if !cluster_to_uuid.contains_key(cluster) {
                let id = uuid::Uuid::new_v4().to_string();
                cluster_to_uuid.insert(*cluster, id);
                order.push(*cluster);
            }
        }
        let uuid_to_sort: HashMap<String, u32> = cluster_to_uuid
            .iter()
            .enumerate()
            .map(|(i, (_, uuid))| (uuid.clone(), i as u32 + 1))
            .collect();

        // 5) Persist: upsert speakers, then bulk-assign.
        update_job(&meeting_id, |j| {
            j.stage = "saving".to_string();
            j.progress = 90;
        });
        let speaker_payload: Vec<serde_json::Value> = order
            .iter()
            .map(|cluster| {
                let uuid = &cluster_to_uuid[cluster];
                serde_json::json!({
                    "id": uuid,
                    "displayName": format!("Speaker {}", uuid_to_sort[uuid]),
                    "sortOrder": uuid_to_sort[uuid],
                })
            })
            .collect();

        if let Err(e) = api_call(
            &app,
            "POST",
            &format!("/api/v1/meetings/{meeting_id}/speakers"),
            Some(serde_json::Value::Array(speaker_payload)),
        )
        .await
        {
            job_failed(&app, &meeting_id, format!("Could not save speakers: {e}"));
            return;
        }

        let assignments: Vec<serde_json::Value> = assigned
            .iter()
            .map(|(seg_idx, cluster)| {
                let segment_id = segments[*seg_idx].0.clone();
                let speaker_uuid = cluster_to_uuid[cluster].clone();
                serde_json::json!({ "segmentId": segment_id, "speakerId": speaker_uuid })
            })
            .collect();
        let updated = match api_call(
            &app,
            "POST",
            &format!("/api/v1/meetings/{meeting_id}/transcripts/speaker-assignments"),
            Some(serde_json::json!({ "assignments": assignments })),
        )
        .await
        {
            Ok(v) => v.get("updated").and_then(|u| u.as_u64()).unwrap_or(0),
            Err(e) => {
                job_failed(&app, &meeting_id, format!("Could not save speaker assignments: {e}"));
                return;
            }
        };

        let speakers_found = order.len() as u32;
        update_job(&meeting_id, |j| {
            j.state = "completed".to_string();
            j.stage = "done".to_string();
            j.progress = 100;
            j.speakers_found = Some(speakers_found);
            j.error = None;
        });
        let _ = app.emit(
            "diar-meeting-complete",
            serde_json::json!({
                "meetingId": meeting_id,
                "speakersFound": speakers_found,
                "segmentsUpdated": updated,
            }),
        );
    });

    Ok(())
}

/// Live session wrapper used by the recording pipeline (Stage 5). Kept here
/// so the commands module owns the meeting->session map.
static LIVE_SESSIONS: OnceLock<RwLock<HashMap<String, SpeakerSession>>> = OnceLock::new();

pub(crate) fn live_sessions() -> &'static RwLock<HashMap<String, SpeakerSession>> {
    LIVE_SESSIONS.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Builds the live diarization runtime for a new recording when enabled +
/// configured; None otherwise (transcription never depends on diarization).
pub(crate) async fn live_runtime<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<super::live::LiveDiarization> {
    let config = load_config(app);
    super::live::LiveDiarization::try_new(app, &config).await
}

#[cfg(test)]
mod tests {
    use super::align_turns;
    use crate::speaker_engine::helper::DiarSegment;

    fn turn(start: f32, end: f32, speaker: u32) -> DiarSegment {
        DiarSegment { start, end, speaker }
    }

    #[test]
    fn aligns_by_overlap() {
        let segments = vec![(0.0, 4.0), (5.0, 9.0), (10.0, 14.0), (20.0, 24.0)];
        let turns = vec![
            turn(0.5, 4.5, 0),
            turn(5.2, 8.8, 1),
            turn(10.1, 14.2, 0),
        ];
        let aligned = align_turns(&segments, &turns);
        assert_eq!(aligned, vec![Some(0), Some(1), Some(0), None]);
    }

    #[test]
    fn no_speech_means_no_assignment() {
        let segments = vec![(0.0, 4.0)];
        let aligned = align_turns(&segments, &[]);
        assert_eq!(aligned, vec![None]);
    }

    #[test]
    fn tiny_overlap_is_not_enough() {
        let segments = vec![(0.0, 4.0)];
        let turns = vec![turn(3.85, 8.0, 2)];
        let aligned = align_turns(&segments, &turns);
        assert_eq!(aligned, vec![None]);
    }
}
