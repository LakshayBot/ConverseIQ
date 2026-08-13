//! Speaker diarization model download/validation/cancel/delete.
//!
//! Mirrors `llm_engine::model_manager` (same OnceLock state machine, `.part`
//! downloads, progress events, cancel flag, app-data storage) with two
//! additions: each tier downloads TWO artifacts (embedding ONNX + the shared
//! pyannote segmentation tar.bz2 which is extracted at download time), and
//! validation is size-based (ONNX files have no GGUF-style magic header).

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::RwLock;

use bzip2::read::BzDecoder;
use futures_util::StreamExt as _;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use super::models::{get_model_by_id, DiarModelDef, DIAR_MODEL_CATALOG};

/// Per-tier download progress (combined embedding + segmentation artifacts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub percent: u8,
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub speed_mbps: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelStatus {
    Missing,
    Downloading { progress: u8 },
    Ready,
    Corrupted { file_size: u64, expected_min_size: u64 },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub embedding_size_mb: u64,
    pub segmentation_size_mb: u64,
    pub cluster_threshold: f32,
    pub similarity_threshold: f32,
    pub local_path: Option<String>,
    pub status: ModelStatus,
    pub progress: Option<u8>,
    pub selected: bool,
    pub helper_available: bool,
}

#[derive(Default)]
struct DownloadState {
    active: HashSet<String>,
    cancel: Option<String>,
}

static STATE: OnceLock<RwLock<DownloadState>> = OnceLock::new();

fn state() -> &'static RwLock<DownloadState> {
    STATE.get_or_init(|| RwLock::new(DownloadState::default()))
}

/// `app_data_dir/models/diarization/<tier-id>/`
pub fn models_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("models")
        .join("diarization")
}

fn tier_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> PathBuf {
    models_dir(app).join(id)
}

/// Validation floor: a downloaded artifact is Ready only when it is at least
/// 90% of the expected size (ONNX has no magic bytes to sniff).
fn is_valid_size(path: &std::path::Path, expected_mb: u64) -> bool {
    match std::fs::metadata(path) {
        Ok(m) => m.len() >= expected_mb * 1024 * 1024 * 9 / 10,
        Err(_) => false,
    }
}

/// Extracts the pyannote segmentation tar.bz2 into the tier dir and returns
/// whether the tier's chosen file is present and valid.
fn extract_segmentation(app: &AppHandle<impl Runtime>, def: &DiarModelDef, dir: &std::path::Path) -> Result<(), String> {
    let tar_path = dir.join("segmentation.tar.bz2");
    if !tar_path.exists() {
        return Err("segmentation archive missing".to_string());
    }
    let file = std::fs::File::open(&tar_path).map_err(|e| e.to_string())?;
    let mut archive = tar::Archive::new(BzDecoder::new(file));
    archive
        .unpack(dir)
        .map_err(|e| format!("failed to extract segmentation model: {e}"))?;

    let extracted = dir.join(def.segmentation_file);
    if !is_valid_size(&extracted, def.segmentation_size_mb) {
        return Err(format!(
            "extracted segmentation model is invalid or undersized ({} expected)",
            def.segmentation_file
        ));
    }
    let _ = std::fs::remove_file(&tar_path);
    Ok(())
}

fn status_of<R: Runtime>(app: &AppHandle<R>, def: &DiarModelDef) -> (ModelStatus, Option<u8>) {
    let guard = state().read().unwrap();
    if guard.active.contains(def.id) {
        let progress = guard
            .cancel
            .as_deref()
            .filter(|c| *c == def.id)
            .map(|_| 0)
            .unwrap_or(0);
        return (ModelStatus::Downloading { progress }, Some(progress));
    }
    drop(guard);

    let dir = tier_dir(app, def.id);
    let embedding = dir.join(def.embedding_file);
    let segmentation = dir.join(def.segmentation_file);

    if !embedding.exists() || !segmentation.exists() {
        // A leftover partial embedding is still "missing" until a full
        // download completes (downloads write to .part and rename).
        return (ModelStatus::Missing, None);
    }

    let emb_ok = is_valid_size(&embedding, def.embedding_size_mb);
    let seg_ok = is_valid_size(&segmentation, def.segmentation_size_mb);
    if !emb_ok || !seg_ok {
        let size = embedding.metadata().map(|m| m.len()).unwrap_or(0);
        return (
            ModelStatus::Corrupted {
                file_size: size,
                expected_min_size: def.embedding_size_mb * 1024 * 1024 * 9 / 10,
            },
            None,
        );
    }

    (ModelStatus::Ready, None)
}

pub fn list_models<R: Runtime>(
    app: &AppHandle<R>,
    selected: Option<&str>,
    helper_available: bool,
) -> Vec<ModelInfo> {
    DIAR_MODEL_CATALOG
        .iter()
        .map(|def| {
            let (status, progress) = status_of(app, def);
            let local_path = match &status {
                ModelStatus::Ready => Some(
                    tier_dir(app, def.id)
                        .join(def.embedding_file)
                        .to_string_lossy()
                        .into_owned(),
                ),
                _ => None,
            };
            ModelInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                description: def.description.to_string(),
                embedding_size_mb: def.embedding_size_mb + def.segmentation_tar_size_mb,
                segmentation_size_mb: def.segmentation_size_mb,
                cluster_threshold: def.cluster_threshold,
                similarity_threshold: def.similarity_threshold,
                local_path,
                status,
                progress,
                selected: selected == Some(def.id),
                helper_available,
            }
        })
        .collect()
}

/// Downloads one tier: embedding ONNX + segmentation tar.bz2 (extracted).
/// Streams progress via the `on_progress` callback (0-100 combined).
pub async fn download_model<R: Runtime>(
    app: &AppHandle<R>,
    def: &'static DiarModelDef,
    on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<(), String> {
    {
        let mut guard = state().write().unwrap();
        if guard.active.contains(def.id) {
            return Err(format!("{} is already downloading", def.name));
        }
        guard.active.insert(def.id.to_string());
        guard.cancel = None;
    }

    let dir = tier_dir(app, def.id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create model dir: {e}"))?;

    let embedding_part = dir.join(format!("{}.part", def.embedding_file));
    let tar_part = dir.join("segmentation.tar.bz2.part");
    let embedding_final = dir.join(def.embedding_file);
    let tar_final = dir.join("segmentation.tar.bz2");

    let total_mb = def.embedding_size_mb + def.segmentation_tar_size_mb;
    let embedding_mb = def.embedding_size_mb as f64;
    let total_mb_f = total_mb as f64;

    let client = reqwest::Client::new();
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes = 0u64;
    let started = std::time::Instant::now();

    let cancel_aborted = || -> bool {
        let guard = state().read().unwrap();
        guard.cancel.as_deref() == Some(def.id)
    };

    let emit = |downloaded_mb: f64, speed: f64| {
        let percent = ((downloaded_mb / total_mb_f) * 100.0).clamp(0.0, 100.0) as u8;
        on_progress(DownloadProgress {
            percent,
            downloaded_mb: downloaded_mb.round(),
            total_mb: total_mb_f.round(),
            speed_mbps: speed,
        });
    };

    // 1) Embedding model (weight = embedding_size_mb of the total).
    let result: Result<(), String> = async {
        {
            let resp = client
                .get(def.embedding_url)
                .send()
                .await
                .map_err(|e| format!("download failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("download failed: HTTP {}", resp.status()));
            }
            let _total = resp
                .content_length()
                .unwrap_or(def.embedding_size_mb * 1024 * 1024);
            let mut stream = resp.bytes_stream();
            let mut file = std::fs::File::create(&embedding_part).map_err(|e| e.to_string())?;
            let mut written = 0u64;
            while let Some(chunk) = stream.next().await {
                if cancel_aborted() {
                    return Err("Download cancelled".to_string());
                }
                let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
                file.write_all(&chunk).map_err(|e| e.to_string())?;
                written += chunk.len() as u64;
                let now = std::time::Instant::now();
                if now.duration_since(last_emit).as_millis() >= 250 {
                    let speed = (written.saturating_sub(last_bytes)) as f64
                        / now.duration_since(started).as_secs_f64().max(0.001)
                        / 1024.0
                        / 1024.0;
                    emit(
                        (written as f64 / 1024.0 / 1024.0) * (embedding_mb / total_mb_f),
                        speed,
                    );
                    last_emit = now;
                    last_bytes = written;
                }
            }
            file.flush().ok();
            drop(file);
            if !is_valid_size(&embedding_part, def.embedding_size_mb) {
                return Err("Downloaded embedding model is invalid or undersized".to_string());
            }
            std::fs::rename(&embedding_part, &embedding_final).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    .await;

    if let Err(e) = result {
        let _ = std::fs::remove_file(&embedding_part);
        let mut guard = state().write().unwrap();
        guard.active.remove(def.id);
        guard.cancel = None;
        return Err(e);
    }

    // 2) Segmentation tar.bz2 (weight = tar size of the total), then extract.
    let result: Result<(), String> = async {
        {
            let resp = client
                .get(def.segmentation_tar_url)
                .send()
                .await
                .map_err(|e| format!("segmentation download failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("segmentation download failed: HTTP {}", resp.status()));
            }
            let _total = resp
                .content_length()
                .unwrap_or(def.segmentation_tar_size_mb * 1024 * 1024);
            let mut stream = resp.bytes_stream();
            let mut file = std::fs::File::create(&tar_part).map_err(|e| e.to_string())?;
            let mut written = 0u64;
            while let Some(chunk) = stream.next().await {
                if cancel_aborted() {
                    return Err("Download cancelled".to_string());
                }
                let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
                file.write_all(&chunk).map_err(|e| e.to_string())?;
                written += chunk.len() as u64;
                let now = std::time::Instant::now();
                if now.duration_since(last_emit).as_millis() >= 250 {
                    let speed = (written.saturating_sub(last_bytes)) as f64
                        / now.duration_since(started).as_secs_f64().max(0.001)
                        / 1024.0
                        / 1024.0;
                    emit(
                        (def.embedding_size_mb as f64)
                            + (written as f64 / 1024.0 / 1024.0),
                        speed,
                    );
                    last_emit = now;
                    last_bytes = written;
                }
            }
            file.flush().ok();
            drop(file);
            std::fs::rename(&tar_part, &tar_final).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    .await;

    if let Err(e) = result {
        let _ = std::fs::remove_file(&tar_part);
        let mut guard = state().write().unwrap();
        guard.active.remove(def.id);
        guard.cancel = None;
        return Err(e);
    }

    // Extraction + final validation.
    if let Err(e) = extract_segmentation(app, def, &dir) {
        let _ = std::fs::remove_file(&tar_final);
        let mut guard = state().write().unwrap();
        guard.active.remove(def.id);
        guard.cancel = None;
        return Err(format!("segmentation extraction failed: {e}"));
    }

    if !is_valid_size(&embedding_final, def.embedding_size_mb)
        || !is_valid_size(&dir.join(def.segmentation_file), def.segmentation_size_mb)
    {
        let mut guard = state().write().unwrap();
        guard.active.remove(def.id);
        guard.cancel = None;
        return Err("Downloaded model is invalid or undersized".to_string());
    }

    {
        let mut guard = state().write().unwrap();
        guard.active.remove(def.id);
        guard.cancel = None;
    }
    emit(total_mb_f, 0.0);
    Ok(())
}

pub fn cancel_download<R: Runtime>(app: &AppHandle<R>, name: &str) {
    let _ = app;
    let mut guard = state().write().unwrap();
    if guard.active.contains(name) {
        guard.cancel = Some(name.to_string());
    }
}

pub fn delete_model<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<(), String> {
    let def = get_model_by_id(name).ok_or_else(|| format!("Unknown model: {name}"))?;
    let dir = tier_dir(app, def.id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("failed to delete model: {e}"))?;
    }
    Ok(())
}

/// Returns the tier dir iff the tier is fully downloaded and valid.
pub fn validate_downloaded<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    let def = get_model_by_id(name).ok_or_else(|| format!("Unknown model: {name}"))?;
    match status_of(app, def) {
        (ModelStatus::Ready, _) => Ok(tier_dir(app, def.id)),
        (ModelStatus::Missing, _) => Err(format!(
            "The {} model is not downloaded. Install it in Settings, then try again.",
            def.name
        )),
        (ModelStatus::Corrupted { .. }, _) => Err(format!(
            "The {} model is corrupted. Re-download it in Settings, then try again.",
            def.name
        )),
        (ModelStatus::Downloading { .. }, _) => Err("The model is still downloading.".to_string()),
    }
}
