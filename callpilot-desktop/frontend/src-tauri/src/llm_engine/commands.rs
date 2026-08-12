//! Tauri commands for local LLM model management + meeting summarization.
//!
//! Inference runs through the bundled llama-helper sidecar (llama.cpp) against
//! GGUF models downloaded into `app_data_dir/models/summary/`. No transcript
//! bytes ever leave the device; the backend only receives the finished,
//! structured summary.

use std::future::Future;
use std::pin::Pin;

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_store::StoreExt;

use crate::llm_engine::helper::{helper_available, LlamaHelper};
use crate::llm_engine::model_manager;
use crate::llm_engine::models::{format_prompt, get_model_by_id};
use crate::llm_engine::summary;
use crate::llm_engine::LlmConfig;

const CONFIG_STORE: &str = "summarization-config.json";

fn load_config<R: Runtime>(app: &AppHandle<R>) -> LlmConfig {
    if let Ok(store) = app.store(CONFIG_STORE) {
        let model = store
            .get("model")
            .and_then(|v| v.as_str().map(String::from));
        let auto = store
            .get("autoSummarize")
            .and_then(|v| v.as_bool());
        return LlmConfig {
            model,
            auto_summarize: auto,
        };
    }
    LlmConfig::default()
}

fn save_config<R: Runtime>(app: &AppHandle<R>, config: &LlmConfig) {
    if let Ok(store) = app.store(CONFIG_STORE) {
        store.set(
            "model",
            config
                .model
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        store.set(
            "autoSummarize",
            serde_json::Value::Bool(config.auto_summarize.unwrap_or(true)),
        );
        let _ = store.save();
    }
}

/// Read the local summarization config (selected model + auto-summarize).
#[tauri::command]
pub async fn llm_get_config<R: Runtime>(app: AppHandle<R>) -> Result<LlmConfig, String> {
    Ok(load_config(&app))
}

/// Persist the local summarization config.
#[tauri::command]
pub async fn llm_set_config<R: Runtime>(
    app: AppHandle<R>,
    model: Option<String>,
    auto_summarize: Option<bool>,
) -> Result<LlmConfig, String> {
    let mut config = load_config(&app);
    if let Some(m) = model {
        config.model = Some(m);
    }
    if let Some(a) = auto_summarize {
        config.auto_summarize = Some(a);
    }
    save_config(&app, &config);
    Ok(config)
}

/// Summarization models with download/selection/availability state.
#[tauri::command]
pub async fn llm_get_models<R: Runtime>(app: AppHandle<R>) -> Result<Vec<model_manager::ModelInfo>, String> {
    let config = load_config(&app);
    Ok(model_manager::list_models(
        &app,
        config.model.as_deref(),
        helper_available(&app),
    ))
}

/// Downloads a GGUF summarization model, streaming progress via the
/// `llm-model-download-progress` event.
#[tauri::command]
pub async fn llm_pull_model<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<(), String> {
    let def = get_model_by_id(&name).ok_or_else(|| format!("Unknown model: {name}"))?;
    let app_for_emit = app.clone();
    let name_for_progress = name.clone();
    let result = model_manager::download_model(&app, def, move |progress| {
        let _ = app_for_emit.emit(
            "llm-model-download-progress",
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
                "llm-model-download-complete",
                serde_json::json!({ "modelName": name }),
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "llm-model-download-error",
                serde_json::json!({ "modelName": name, "error": e }),
            );
            Err(e)
        }
    }
}

/// Cancels an in-flight model download.
#[tauri::command]
pub async fn llm_cancel_download<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    model_manager::cancel_download(&app, &name);
    Ok(())
}

/// Removes a downloaded GGUF model.
#[tauri::command]
pub async fn llm_delete_model<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    model_manager::delete_model(&app, &name)
}

/// Runs local meeting summarization with the given transcript.
/// Streams stage progress via the `llm-summary-progress` event
/// (stage + percent) and returns the structured summary JSON.
///
/// The transcript is processed entirely on the user's machine - it is never
/// sent to any server. Summarization runs through llama-helper against the
/// selected (downloaded) GGUF model; without a selected model the command
/// fails rather than degrading to a lower-quality built-in summary.
#[tauri::command]
pub async fn llm_generate_summary<R: Runtime>(
    app: AppHandle<R>,
    transcript: String,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = load_config(&app);
    let model_id = model.or(config.model);
    let def = model_id
        .as_deref()
        .and_then(get_model_by_id)
        .cloned()
        .ok_or_else(|| {
            "No summarization model selected. Pick a model in Settings → Transcription, then try again."
                .to_string()
        })?;

    if !helper_available(&app) {
        return Err(
            "The bundled inference engine (llama-helper) is unavailable in this build. Reinstall or rebuild the application to restore local summarization.".to_string(),
        );
    }

    // Model must be present and valid before we spawn the sidecar.
    let model_path = model_manager::validate_downloaded(&app, def.id).map_err(|_| {
        format!(
            "The {} model is not downloaded. Install it in Settings → Transcription, then try again.",
            def.name
        )
    })?;

    let app_for_emit = app.clone();
    let emit_llm = move |stage: String, percent: u8| {
        let _ = app_for_emit.emit(
            "llm-summary-progress",
            serde_json::json!({ "stage": stage, "percent": percent }),
        );
    };

    let mut helper = match LlamaHelper::spawn(&app).await {
        Ok(h) => h,
        Err(e) => {
            log::error!("llama-helper spawn failed: {e}");
            return Err(e);
        }
    };
    let helper = std::sync::Arc::new(tokio::sync::Mutex::new(helper));
    let helper_for_shutdown = helper.clone();
    let sampling = def.sampling.clone();
    let template = def.template;
    let context_size = def.context_size;
    let path = model_path.clone();
    let mut llm = move |user_prompt: String| {
        let full = format_prompt(template, summary::SUMMARY_SCHEMA_PROMPT, &user_prompt);
        let helper = helper.clone();
        let path = path.clone();
        let sampling = sampling.clone();
        Box::pin(async move {
            helper
                .lock()
                .await
                .generate(&path, context_size, &full, &sampling)
                .await
        }) as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
    };

    let result = summary::summarize_meeting(&transcript, &mut llm, emit_llm).await;
    {
        let mut guard = helper_for_shutdown.lock().await;
        let _ = guard.shutdown().await;
    }

    result.map(|value| {
        let _ = app.emit(
            "llm-summary-complete",
            serde_json::json!({ "model": def.name }),
        );
        value
    })
}
