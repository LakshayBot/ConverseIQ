//! GGUF model manager for summarization models.
//!
//! Mirrors the Parakeet/Whisper speech-model managers: models are streamed
//! into `app_data_dir/models/summary/` with progress + cancellation, validated
//! (size + GGUF magic), and only then marked Ready.

use std::collections::HashSet;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use std::time::{Instant, SystemTime};

use futures_util::StreamExt as _;
use reqwest::Client;
use tauri::{AppHandle, Runtime};
use tauri::Manager as _;

use crate::llm_engine::models::SummaryModelDef;

/// Download progress (MB + speed), same shape as the Parakeet manager.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub speed_mbps: f64,
    pub percent: u8,
}

#[derive(Debug, Clone)]
pub enum ModelStatus {
    Missing,
    Downloading,
    Ready,
    Corrupted { file_size: u64, expected_min_size: u64 },
}

/// Model state reported to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub gguf_file: String,
    pub size_mb: u64,
    pub context_size: u32,
    pub template: String,
    pub description: String,
    pub local_path: Option<String>,
    pub status: String,
    pub progress: Option<u8>,
    pub selected: bool,
    pub helper_available: bool,
}

struct DownloadState {
    active: HashSet<String>,
    cancel: Option<String>,
}

fn state() -> &'static RwLock<DownloadState> {
    static STATE: OnceLock<RwLock<DownloadState>> = OnceLock::new();
    STATE.get_or_init(|| {
        RwLock::new(DownloadState {
            active: HashSet::new(),
            cancel: None,
        })
    })
}

fn models_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = base.join("models").join("summary");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Public helper for path resolution (commands.rs uses this too).
pub fn summary_models_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    models_dir(app)
}

fn model_path<R: Runtime>(app: &AppHandle<R>, def: &SummaryModelDef) -> PathBuf {
    models_dir(app).join(def.gguf_file)
}

const MAGIC: &[u8; 4] = b"GGUF";

fn is_valid_gguf(path: &PathBuf) -> bool {
    use std::io::Read;
    std::fs::File::open(path)
        .map(|mut f| {
            let mut buf = [0u8; 4];
            f.read_exact(&mut buf).is_ok() && &buf == MAGIC
        })
        .unwrap_or(false)
}

fn status_of<R: Runtime>(app: &AppHandle<R>, def: &SummaryModelDef) -> ModelStatus {
    {
        let guard = state().read().unwrap();
        if guard.active.contains(def.id) {
            return ModelStatus::Downloading;
        }
    }
    let path = model_path(app, def);
    if !path.exists() {
        return ModelStatus::Missing;
    }
    let file_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let expected_min = (def.size_mb as u64 * 1024 * 1024 * 9) / 10; // >=90%
    if file_size < expected_min || !is_valid_gguf(&path) {
        return ModelStatus::Corrupted { file_size, expected_min_size: expected_min };
    }
    ModelStatus::Ready
}

pub fn list_models<R: Runtime>(app: &AppHandle<R>, selected: Option<&str>, helper_available: bool) -> Vec<ModelInfo> {
    crate::llm_engine::models::SUMMARY_MODEL_CATALOG
        .iter()
        .map(|def| {
            let status = status_of(app, def);
            let (status_str, progress) = match status {
                ModelStatus::Missing => ("missing", None),
                ModelStatus::Downloading => ("downloading", Some(0)),
                ModelStatus::Ready => ("ready", None),
                ModelStatus::Corrupted { .. } => ("corrupted", None),
            };
            let local = model_path(app, def);
            ModelInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                gguf_file: def.gguf_file.to_string(),
                size_mb: def.size_mb,
                context_size: def.context_size,
                template: def.template.to_string(),
                description: def.description.to_string(),
                local_path: if local.exists() { Some(local.to_string_lossy().to_string()) } else { None },
                status: status_str.to_string(),
                progress,
                selected: selected == Some(def.id),
                helper_available,
            }
        })
        .collect()
}

/// Streams a GGUF download, calling `on_progress` per chunk. Checks the cancel
/// flag each chunk. Writes to `<file>.part`, renames on success.
pub async fn download_model<F, R: Runtime>(
    app: &AppHandle<R>,
    def: &SummaryModelDef,
    on_progress: F,
) -> Result<(), String>
where
    F: Fn(DownloadProgress) + Send + 'static,
{
    {
        let mut guard = state().write().unwrap();
        guard.active.insert(def.id.to_string());
        guard.cancel = None;
    }

    let final_path = model_path(app, def);
    let part_path = final_path.with_extension("part");
    let url = def.download_url.to_string();
    let model_id = def.id.to_string();

    let result = async {
        let client = Client::builder()
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("Download failed (HTTP {status})"));
        }
        let total = resp.content_length().unwrap_or(0);
        let mut stream = resp.bytes_stream();
        let mut file = std::fs::File::create(&part_path)
            .map_err(|e| format!("Could not create model file: {e}"))?;
        let mut downloaded: u64 = 0;
        let start = Instant::now();
        while let Some(chunk) = stream.next().await {
            {
                let guard = state().read().unwrap();
                if guard.cancel.as_deref() == Some(model_id.as_str()) {
                    return Err("Download cancelled".to_string());
                }
            }
            let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
            file.write_all(&chunk).map_err(|e| format!("Write error: {e}"))?;
            downloaded += chunk.len() as u64;
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            let speed = downloaded as f64 / elapsed / 1024.0 / 1024.0;
            on_progress(DownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: total,
                downloaded_mb: downloaded as f64 / (1024.0 * 1024.0),
                total_mb: total as f64 / (1024.0 * 1024.0),
                speed_mbps: speed,
                percent: if total > 0 { ((downloaded as f64 / total as f64) * 100.0) as u8 } else { 0 },
            });
        }
        file.flush().map_err(|e| format!("Flush error: {e}"))?;
        drop(file);
        if is_valid_gguf(&part_path) {
            std::fs::rename(&part_path, &final_path).map_err(|e| format!("Finalize error: {e}"))?;
            Ok(())
        } else {
            let _ = std::fs::remove_file(&part_path);
            Err("Downloaded file is not a valid GGUF model".to_string())
        }
    }
    .await;

    {
        let mut guard = state().write().unwrap();
        guard.active.remove(&model_id);
        guard.cancel = None;
    }
    result
}

pub fn cancel_download<R: Runtime>(app: &AppHandle<R>, name: &str) {
    let mut guard = state().write().unwrap();
    if guard.active.contains(name) {
        guard.cancel = Some(name.to_string());
    }
    let _ = app;
}

pub fn delete_model<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<(), String> {
    let def = crate::llm_engine::models::get_model_by_id(name)
        .ok_or_else(|| format!("Unknown model: {name}"))?;
    let path = model_path(app, def);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("part"));
    Ok(())
}

pub fn validate_downloaded<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    let def = crate::llm_engine::models::get_model_by_id(name)
        .ok_or_else(|| format!("Unknown model: {name}"))?;
    match status_of(app, def) {
        ModelStatus::Ready => Ok(model_path(app, def)),
        ModelStatus::Missing => Err(format!("Model {} has not been downloaded.", def.name)),
        ModelStatus::Corrupted { .. } => Err(format!("Model {} is corrupted. Delete and re-download it.", def.name)),
        ModelStatus::Downloading { .. } => Err(format!("Model {} is still downloading.", def.name)),
    }
}

/// Last modified time of the model file (for display).
pub fn downloaded_at<R: Runtime>(app: &AppHandle<R>, name: &str) -> Option<SystemTime> {
    let def = crate::llm_engine::models::get_model_by_id(name)?;
    std::fs::metadata(model_path(app, def))
        .ok()
        .and_then(|m| m.modified().ok())
}
