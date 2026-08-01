use log::{debug as log_debug, error as log_error, info as log_info, warn as log_warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::state::AppState;

// The CustomOpenAIConfig struct moved to a thin local definition below;
// the desktop no longer keeps a SQLite-backed SettingsRepository, so the
// type lives in this module instead of in the database layer.

// Default CallPilot server URL - the .NET Gateway.
// Operators can override via the settings store key "callpilot_api_url".
const DEFAULT_CALLPILOT_API_URL: &str = "http://localhost:5001";

// Default AI engine URL. Can be overridden via "callpilot_ai_engine_url".
const DEFAULT_CALLPILOT_AI_ENGINE_URL: &str = "ws://localhost:8001";

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSearchResult {
    pub id: String,
    pub title: String,
    #[serde(rename = "matchContext")]
    pub match_context: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileRequest {
    pub email: String,
    pub license_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveProfileRequest {
    pub id: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProfileRequest {
    pub email: String,
    pub license_key: String,
    pub company: String,
    pub position: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
    // Custom OpenAI fields (only populated when provider is 'custom-openai')
    #[serde(rename = "customOpenAIEndpoint", default, skip_serializing_if = "Option::is_none")]
    pub custom_openai_endpoint: Option<String>,
    #[serde(rename = "customOpenAIModel", default, skip_serializing_if = "Option::is_none")]
    pub custom_openai_model: Option<String>,
    #[serde(rename = "customOpenAIApiKey", default, skip_serializing_if = "Option::is_none")]
    pub custom_openai_api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(rename = "topP", default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(flatten, default)]
    pub _extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveModelConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CustomOpenAIConfig {
    pub endpoint: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    pub model: String,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    #[serde(rename = "topP")]
    pub top_p: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetApiKeyRequest {
    pub provider: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTranscriptConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteMeetingRequest {
    pub meeting_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingDetails {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub transcripts: Vec<MeetingTranscript>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingTranscript {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    // Recording-relative timestamps for audio-transcript synchronization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

/// Meeting metadata without transcripts (for pagination)
#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
}

/// Paginated transcripts response with total count
#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedTranscriptsResponse {
    pub transcripts: Vec<MeetingTranscript>,
    pub total_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveMeetingTitleRequest {
    pub meeting_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveMeetingSummaryRequest {
    pub meeting_id: String,
    pub summary: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTranscriptRequest {
    pub meeting_title: String,
    pub transcripts: Vec<TranscriptSegment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    // NEW: Recording-relative timestamps for playback synchronization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: Option<String>,
    pub email: String,
    pub license_key: String,
    pub company: Option<String>,
    pub position: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub is_licensed: bool,
}

// Helper function to get auth token from store (optional)
#[allow(dead_code)]
async fn get_auth_token<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let store = match app.store("store.json") {
        Ok(store) => store,
        Err(_) => return None,
    };

    match store.get("authToken") {
        Some(token) => {
            if let Some(token_str) = token.as_str() {
                let truncated = token_str.chars().take(20).collect::<String>();
                log_info!("Found auth token: {}", truncated);
                Some(token_str.to_string())
            } else {
                log_warn!("Auth token is not a string");
                None
            }
        }
        None => {
            log_warn!("No auth token found in store");
            None
        }
    }
}

// Helper function to get server address.
// Reads `callpilot_api_url` from the Tauri store if present, otherwise returns the
// default `http://localhost:5000` (CallPilot .NET Gateway).
async fn get_server_address<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    if let Ok(store) = app.store("settings.json") {
        if let Some(value) = store.get("callpilot_api_url") {
            if let Some(url) = value.as_str() {
                if !url.is_empty() {
                    log_info!("Using CallPilot API URL from settings: {}", url);
                    return Ok(url.to_string());
                }
            }
        }
    }
    log_info!("Using default CallPilot API URL: {}", DEFAULT_CALLPILOT_API_URL);
    Ok(DEFAULT_CALLPILOT_API_URL.to_string())
}

/// Resolve the .NET base URL synchronously (no async store fetch). Used by
/// settings shortcuts that need to fire-and-forget a single HTTP call.
/// Falls back to the default if nothing is configured.
pub(crate) fn callpilot_api_base_url() -> String {
    DEFAULT_CALLPILOT_API_URL.to_string()
}

// Generic API call function with optional authentication
async fn make_api_request<R: Runtime, T: for<'de> Deserialize<'de>>(
    app: &AppHandle<R>,
    endpoint: &str,
    method: &str,
    body: Option<&str>,
    additional_headers: Option<HashMap<String, String>>,
    auth_token: Option<String>, // Pass auth token from frontend
) -> Result<T, String> {
    let client = reqwest::Client::new();
    let server_url = get_server_address(app).await?;

    let url = format!("{}{}", server_url, endpoint);
    log_info!("Making {} request to: {}", method, url);

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    // Add authorization header if auth token is provided
    if let Some(token) = auth_token {
        log_info!("Adding authorization header");
        request = request.header("Authorization", format!("Bearer {}", token));
    } else {
        log_warn!("No auth token provided, making unauthenticated request");
    }

    request = request.header("Content-Type", "application/json");

    // Add additional headers if provided
    if let Some(headers) = additional_headers {
        for (key, value) in headers {
            request = request.header(&key, &value);
        }
    }

    // Add body if provided
    if let Some(body_str) = body {
        request = request.body(body_str.to_string());
    }

    let response = request.send().await.map_err(|e| {
        let error_msg = format!("Request failed: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })?;

    let status = response.status();
    log_info!("Response status: {}", status);

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        let error_msg = format!("HTTP {}: {}", status, error_text);
        log_error!("{}", error_msg);
        return Err(error_msg);
    }

    let response_text = response.text().await.map_err(|e| {
        let error_msg = format!("Failed to read response: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })?;

    // Safely truncate response for logging, respecting UTF-8 character boundaries
    let truncated = response_text.chars().take(200).collect::<String>();
    log_info!("Response body: {}", truncated);

    serde_json::from_str(&response_text).map_err(|e| {
        let error_msg = format!("Failed to parse JSON: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })
}

// API Commands for Tauri

#[tauri::command]
pub async fn api_get_meetings<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Vec<Meeting>, String> {
    log_info!(
        "api_get_meetings called with auth_token(native) : {}",
        auth_token.is_some()
    );

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(Vec::new()),
    };

    let resp = reqwest::Client::new()
        .get(format!("{}/api/v1/meetings", callpilot_api_base_url()))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    let raw: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let result: Vec<Meeting> = raw.into_iter().map(|m| Meeting {
        id: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: m.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled session").to_string(),
    }).collect();
    Ok(result)
}

#[tauri::command]
pub async fn api_search_transcripts<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    query: String,
    auth_token: Option<String>,
) -> Result<Vec<TranscriptSearchResult>, String> {
    log_info!(
        "api_search_transcripts called with query: '{}', auth_token: {}",
        query,
        auth_token.is_some()
    );

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(Vec::new()),
    };

    let resp = reqwest::Client::new()
        .get(format!(
            "{}/api/v1/search?q={}",
            callpilot_api_base_url(),
            urlencoding(&query)
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    let raw: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let result: Vec<TranscriptSearchResult> = raw.into_iter().map(|r| TranscriptSearchResult {
        id: r.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: r.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled session").to_string(),
        timestamp: r.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        match_context: r.get("matchContext").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    }).collect();
    Ok(result)
}

fn urlencoding(s: &str) -> String {
    s.chars().map(|c| {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
            c.to_string()
        } else {
            format!("%{:02X}", c as u32)
        }
    }).collect()
}

#[tauri::command]
pub async fn api_get_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    auth_token: Option<String>,
) -> Result<Profile, String> {
    log_info!(
        "api_get_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let profile_request = ProfileRequest { email, license_key };
    let body = serde_json::to_string(&profile_request).map_err(|e| e.to_string())?;

    make_api_request::<R, Profile>(&app, "/get-profile", "POST", Some(&body), None, auth_token)
        .await
}

#[tauri::command]
pub async fn api_save_profile<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    email: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let save_request = SaveProfileRequest { id, email };
    let body = serde_json::to_string(&save_request).map_err(|e| e.to_string())?;

    make_api_request::<R, serde_json::Value>(
        &app,
        "/save-profile",
        "POST",
        Some(&body),
        None,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn api_update_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    company: String,
    position: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_update_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let update_request = UpdateProfileRequest {
        email,
        license_key,
        company,
        position,
    };
    let body = serde_json::to_string(&update_request).map_err(|e| e.to_string())?;

    make_api_request::<R, serde_json::Value>(
        &app,
        "/update-profile",
        "POST",
        Some(&body),
        None,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn api_get_model_config<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Option<ModelConfig>, String> {
    log_info!("api_get_model_config called (native)");
    // After the SQLite removal the desktop no longer keeps its own model
    // config - it proxies to the .NET Gateway's ProviderConfigurations
    // table. The Tauri command is kept (and its name preserved) so the
    // frontend call sites don't have to change.

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    let response = match reqwest::Client::new()
        .get(format!("{}/api/v1/providers", callpilot_api_base_url()))
        .bearer_auth(&token)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return Err(format!("Upstream error: HTTP {}", r.status())),
        Err(e) => return Err(format!("Upstream unreachable: {}", e)),
    };

    let providers: Vec<serde_json::Value> = response.json().await.map_err(|e| e.to_string())?;
    let Some(first) = providers.first() else {
        return Ok(None);
    };

    let provider_type = first.get("providerType").and_then(|v| v.as_str()).unwrap_or("ollama").to_string();
    let model = first.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let endpoint = first.get("endpoint").and_then(|v| v.as_str()).map(|s| s.to_string());
    let temperature = first.get("temperature").and_then(|v| v.as_f64()).unwrap_or(0.7);
    let max_tokens = first.get("maxTokens").and_then(|v| v.as_i64()).unwrap_or(4096);

    Ok(Some(ModelConfig {
        provider: provider_type,
        model,
        whisper_model: "large-v3".to_string(),
        api_key: None,
        ollama_endpoint: endpoint,
        custom_openai_endpoint: None,
        custom_openai_model: None,
        custom_openai_api_key: None,
        max_tokens: Some(max_tokens as u32),
        temperature: Some(temperature as f32),
        top_p: None,
        _extra: Default::default(),
    }))
}

#[tauri::command]
pub async fn api_save_model_config<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    _whisper_model: String,
    api_key: Option<String>,
    ollama_endpoint: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "💾 api_save_model_config called (native): provider='{}', model='{}', ollamaEndpoint={:?}",
        &provider,
        &model,
        &ollama_endpoint
    );

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    let body = serde_json::json!({
        "providerType": provider,
        "model": model,
        "endpoint": ollama_endpoint,
        "apiKey": api_key.unwrap_or_default(),
        "temperature": 0.7,
        "maxTokens": 4096,
        "timeoutSeconds": 120,
    });

    let response = reqwest::Client::new()
        .post(format!("{}/api/v1/providers", callpilot_api_base_url()))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Upstream error: HTTP {}", response.status()));
    }

    Ok(serde_json::json!({
        "status": "success",
        "message": "Model configuration saved successfully",
    }))
}

#[tauri::command]
pub async fn api_get_api_key<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<String, String> {
    log_info!("api_get_api_key called (native) for provider '{}'", &provider);

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(String::new()),
    };

    // 1. List providers to find the matching type's GUID
    let providers_resp = reqwest::Client::new()
        .get(format!("{}/api/v1/providers", callpilot_api_base_url()))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;
    if !providers_resp.status().is_success() {
        return Ok(String::new());
    }
    let providers: Vec<serde_json::Value> = providers_resp.json().await.unwrap_or_default();
    let Some(target) = providers.iter().find(|p| {
        p.get("providerType").and_then(|v| v.as_str()) == Some(provider.as_str())
    }) else {
        return Ok(String::new());
    };
    let Some(id) = target.get("id").and_then(|v| v.as_str()) else {
        return Ok(String::new());
    };

    // 2. Decrypt + return the key for that provider id
    let key_resp = reqwest::Client::new()
        .get(format!("{}/api/v1/providers/{}/api-key", callpilot_api_base_url(), id))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;
    if !key_resp.status().is_success() {
        return Ok(String::new());
    }
    let body: serde_json::Value = key_resp.json().await.unwrap_or_default();
    Ok(body.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").to_string())
}

/// Desktop-local STT provider preference (parakeet / whisper / etc.).
/// Persisted in tauri-plugin-store instead of SQLite now that the local
/// DB layer is gone. Returns a sensible default when nothing is saved.
#[tauri::command]
pub async fn api_get_transcript_config<R: Runtime>(
    app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    _auth_token: Option<String>,
) -> Result<Option<TranscriptConfig>, String> {
    log_info!("api_get_transcript_config called (native)");

    let fallback = TranscriptConfig {
        provider: "parakeet".to_string(),
        model: crate::config::DEFAULT_PARAKEET_MODEL.to_string(),
        api_key: None,
    };

    if let Ok(store) = app.store("transcript-config.json") {
        if let Some(provider) = store.get("provider").and_then(|v| v.as_str().map(String::from)) {
            let model = store
                .get("model")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| crate::config::DEFAULT_PARAKEET_MODEL.to_string());
            return Ok(Some(TranscriptConfig { provider, model, api_key: None }));
        }
    }

    Ok(Some(fallback))
}

#[tauri::command]
pub async fn api_save_transcript_config<R: Runtime>(
    app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_transcript_config called (native) for provider '{}'",
        &provider
    );

    if let Ok(store) = app.store("transcript-config.json") {
        store.set("provider", serde_json::Value::String(provider));
        store.set("model", serde_json::Value::String(model));
        if let Some(key) = api_key {
            if !key.is_empty() {
                store.set("apiKey", serde_json::Value::String(key));
            }
        }
        let _ = store.save();
    }

    Ok(serde_json::json!({
        "status": "success",
        "message": "Transcript configuration saved successfully",
    }))
}

#[tauri::command]
pub async fn api_get_transcript_api_key<R: Runtime>(
    app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    _provider: String,
    _auth_token: Option<String>,
) -> Result<String, String> {
    log_info!("api_get_transcript_api_key called (native)");
    // Transcript API key lives in tauri-plugin-store (desktop-local).
    if let Ok(store) = app.store("transcript-config.json") {
        if let Some(v) = store.get("apiKey") {
            if let Some(s) = v.as_str() {
                return Ok(s.to_string());
            }
        }
    }
    Ok(String::new())
}

#[tauri::command]
pub async fn api_delete_api_key<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<(), String> {
    log_info!("api_delete_api_key called (native) for provider '{}'", &provider);
    // Soft-delete the provider row on the .NET side.
    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    let list_resp = reqwest::Client::new()
        .get(format!("{}/api/v1/providers", callpilot_api_base_url()))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;
    if !list_resp.status().is_success() {
        return Err(format!("Upstream HTTP {}", list_resp.status()));
    }
    let providers: Vec<serde_json::Value> = list_resp.json().await.unwrap_or_default();
    let Some(id) = providers.iter()
        .find(|p| p.get("providerType").and_then(|v| v.as_str()) == Some(provider.as_str()))
        .and_then(|p| p.get("id").and_then(|v| v.as_str()))
    else {
        return Ok(());
    };

    let _ = reqwest::Client::new()
        .delete(format!("{}/api/v1/providers/{}", callpilot_api_base_url(), id))
        .bearer_auth(&token)
        .send()
        .await;

    Ok(())
}

#[tauri::command]
pub async fn api_delete_meeting<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    meeting_id: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_delete_meeting called for meeting_id(native): {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    let resp = reqwest::Client::new()
        .delete(format!("{}/api/v1/meetings/{}", callpilot_api_base_url(), meeting_id))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;

    if !resp.status().is_success() {
        if resp.status().as_u16() == 404 {
            return Err(format!("Meeting not found or could not be deleted: {}", meeting_id));
        }
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    Ok(serde_json::json!({
        "status": "success",
        "message": "Meeting deleted successfully"
    }))
}

#[tauri::command]
pub async fn api_get_meeting<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    _state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<MeetingDetails, String> {
    log_info!(
        "api_get_meeting called(native) for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    let resp = reqwest::Client::new()
        .get(format!("{}/api/v1/meetings/{}", callpilot_api_base_url(), meeting_id))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;

    if !resp.status().is_success() {
        if resp.status().as_u16() == 404 {
            return Err(format!("Meeting not found: {}", meeting_id));
        }
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    let detail: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(MeetingDetails {
        id: detail.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: detail.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled session").to_string(),
        created_at: detail.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        updated_at: detail.get("endedAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        transcripts: Vec::new(), // fetched separately via api_get_meeting_transcripts
        folder_path: detail.get("folderPath").and_then(|v| v.as_str()).map(String::from),
    })
}

/// Get meeting metadata without transcripts (for pagination)
#[tauri::command]
pub async fn api_get_meeting_metadata<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    _state: tauri::State<'_, AppState>,
) -> Result<MeetingMetadata, String> {
    log_info!("api_get_meeting_metadata called for meeting_id: {}", meeting_id);

    // After SQLite removal, this is an internal hop that the desktop
    // frontend now bypasses - the new usePaginatedTranscripts.ts hits
    // /api/v1/meetings/{id} directly. Keep this command returning
    // minimal data so any other code path that still calls it doesn't
    // crash, but it does not talk to .NET (no token in this signature).
    Ok(MeetingMetadata {
        id: meeting_id,
        title: "Untitled session".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        folder_path: None,
    })
}

/// Get paginated transcripts for a meeting
#[tauri::command]
pub async fn api_get_meeting_transcripts<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    _limit: i64,
    _offset: i64,
    _state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<PaginatedTranscriptsResponse, String> {
    log_info!(
        "api_get_meeting_transcripts called for meeting_id: {}",
        meeting_id,
    );

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(PaginatedTranscriptsResponse { transcripts: Vec::new(), total_count: 0, has_more: false }),
    };

    let resp = reqwest::Client::new()
        .get(format!("{}/api/v1/meetings/{}/transcripts", callpilot_api_base_url(), meeting_id))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    let raw: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let meeting_transcripts: Vec<MeetingTranscript> = raw.into_iter().map(|t| {
        let start = t.get("startOffset").and_then(|v| v.as_f64());
        let end = t.get("endOffset").and_then(|v| v.as_f64());
        MeetingTranscript {
            id: t.get("sequence").and_then(|v| v.as_i64()).map(|n| n.to_string()).unwrap_or_default(),
            text: t.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            timestamp: t.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            audio_start_time: start,
            audio_end_time: end,
            duration: match (start, end) {
                (Some(s), Some(e)) => Some(e - s),
                _ => None,
            },
        }
    }).collect();
    let total_count = meeting_transcripts.len() as i64;

    Ok(PaginatedTranscriptsResponse {
        transcripts: meeting_transcripts,
        total_count,
        has_more: false,
    })
}

#[tauri::command]
pub async fn api_save_meeting_title<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    meeting_id: String,
    title: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_meeting_title called for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    let resp = reqwest::Client::new()
        .patch(format!("{}/api/v1/meetings/{}", callpilot_api_base_url(), meeting_id))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "title": title }))
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;

    if !resp.status().is_success() {
        if resp.status().as_u16() == 404 {
            return Err(format!("No meeting found with id {}", meeting_id));
        }
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    Ok(serde_json::json!({"message": "Meeting title saved successfully"}))
}

#[tauri::command]
pub async fn api_save_transcript<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    meeting_title: String,
    transcripts: Vec<serde_json::Value>,
    folder_path: Option<String>,
    meeting_id: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_transcript called for meeting: {}, transcripts: {}, folder_path: {:?}, auth_token: {}",
        meeting_title,
        transcripts.len(),
        folder_path,
        auth_token.is_some()
    );

    let meeting_id = match meeting_id {
        Some(id) if !id.is_empty() => id,
        _ => return Err("meeting_id is required".to_string()),
    };

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    // Map the desktop TranscriptSegment shape into the .NET
    // BulkTranscriptSegment shape. Each segment already has audio timing
    // fields that line up with the .NET schema.
    let segments: Vec<serde_json::Value> = transcripts.into_iter().enumerate().map(|(idx, t)| {
        serde_json::json!({
            "text": t.get("text").and_then(|v| v.as_str()).unwrap_or(""),
            "speaker": t.get("speaker").and_then(|v| v.as_str()),
            "confidence": t.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.0),
            "startOffset": t.get("audio_start_time").and_then(|v| v.as_f64()).unwrap_or(0.0),
            "endOffset": t.get("audio_end_time").and_then(|v| v.as_f64()).unwrap_or(0.0),
            "isFinal": true,
            "sequence": t.get("sequence_id").and_then(|v| v.as_i64()).unwrap_or(idx as i64),
        })
    }).collect();

    let body = serde_json::json!({
        "title": meeting_title,
        "folderPath": folder_path,
        "markEnded": true,
        "segments": segments,
    });

    let resp = reqwest::Client::new()
        .post(format!("{}/api/v1/meetings/{}/transcripts", callpilot_api_base_url(), meeting_id))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    Ok(serde_json::json!({
        "status": "success",
        "message": "Transcript saved successfully",
        "meeting_id": meeting_id
    }))
}

/// Opens the meeting's recording folder in the system file explorer
#[tauri::command]
pub async fn open_meeting_folder<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    meeting_id: String,
    auth_token: Option<String>,
) -> Result<(), String> {
    log_info!("open_meeting_folder called for meeting_id: {}", meeting_id);

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    let resp = reqwest::Client::new()
        .get(format!("{}/api/v1/meetings/{}", callpilot_api_base_url(), meeting_id))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Upstream HTTP {}", resp.status()));
    }
    let detail: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let folder_path = match detail.get("folderPath").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => return Err("Recording folder path not available for this meeting".to_string()),
    };

    let path = std::path::Path::new(&folder_path);
    if !path.exists() {
        return Err(format!("Recording folder not found: {}", folder_path));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}

// Simple test command to check backend connectivity
#[tauri::command]
pub async fn test_backend_connection<R: Runtime>(
    app: AppHandle<R>,
    auth_token: Option<String>,
) -> Result<String, String> {
    log_debug!("Testing backend connection...");

    let client = reqwest::Client::new();
    let server_url = get_server_address(&app).await?;

    log_debug!("Testing connection to: {}", server_url);

    let mut request = client.get(&format!("{}/docs", server_url));

    if let Some(token) = auth_token {
        request = request.header("Authorization", format!("Bearer {}", token));
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            log_debug!("Backend responded with status: {}", status);
            Ok(format!("Backend is reachable. Status: {}", status))
        }
        Err(e) => {
            let error_msg = format!("Failed to connect to backend: {}", e);
            log_debug!("{}", error_msg);
            Err(error_msg)
        }
    }
}

#[tauri::command]
pub async fn debug_backend_connection<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    log_debug!("=== DEBUG: Testing backend connection ===");

    // Test 1: Check server address from store
    let server_url = match get_server_address(&app).await {
        Ok(url) => {
            log_debug!("✓ Server URL from store: {}", url);
            url
        }
        Err(e) => {
            log_error!("✗ Failed to get server URL: {}", e);
            return Err(format!("Failed to get server URL: {}", e));
        }
    };

    // Test 2: Make a simple HTTP request to the backend
    let client = reqwest::Client::new();
    let test_url = format!("{}/docs", server_url); // Try the docs endpoint which should be public

    log_debug!("Testing connection to: {}", test_url);

    match client.get(&test_url).send().await {
        Ok(response) => {
            let status = response.status();
            log_debug!("✓ Backend responded with status: {}", status);
            Ok(format!(
                "Backend connection successful! Status: {}, URL: {}",
                status, server_url
            ))
        }
        Err(e) => {
            log_error!("✗ Backend connection failed: {}", e);
            Err(format!("Backend connection failed: {}", e))
        }
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    use std::process::Command;

    let result = if cfg!(target_os = "windows") {
        Command::new("cmd").args(&["/C", "start", &url]).output()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).output()
    } else {
        // Linux and other Unix-like systems
        Command::new("xdg-open").arg(&url).output()
    };

    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to open URL: {}", e)),
    }
}

// ===== CUSTOM OPENAI API COMMANDS =====

/// Saves the custom OpenAI configuration
/// This configuration is stored as JSON and includes endpoint, apiKey, model, and optional parameters
#[tauri::command]
pub async fn api_save_custom_openai_config<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    _top_p: Option<f32>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_custom_openai_config called: endpoint='{}', model='{}'",
        &endpoint,
        &model
    );

    if endpoint.trim().is_empty() {
        return Err("Endpoint URL is required".to_string());
    }
    if model.trim().is_empty() {
        return Err("Model name is required".to_string());
    }
    if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
        return Err("Endpoint must start with http:// or https://".to_string());
    }

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not authenticated".to_string()),
    };

    // Upsert as a provider row with providerType='custom-openai'. top_p
    // isn't stored server-side (the .NET ProviderConfiguration doesn't
    // have a top_p column), so we silently drop it.
    let body = serde_json::json!({
        "providerType": "custom-openai",
        "model": model.trim(),
        "endpoint": endpoint.trim(),
        "apiKey": api_key.clone().unwrap_or_default(),
        "temperature": temperature.unwrap_or(1.0),
        "maxTokens": max_tokens.unwrap_or(4096),
        "timeoutSeconds": 120,
    });

    let resp = reqwest::Client::new()
        .post(format!("{}/api/v1/providers", callpilot_api_base_url()))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Upstream HTTP {}", resp.status()));
    }

    Ok(serde_json::json!({
        "status": "success",
        "message": "Custom OpenAI configuration saved successfully"
    }))
}

/// Gets the custom OpenAI configuration
#[tauri::command]
pub async fn api_get_custom_openai_config<R: Runtime>(
    _app: AppHandle<R>,
    _state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Option<CustomOpenAIConfig>, String> {
    log_info!("api_get_custom_openai_config called");

    let token = match auth_token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(None),
    };

    let resp = reqwest::Client::new()
        .get(format!("{}/api/v1/providers", callpilot_api_base_url()))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Upstream unreachable: {}", e))?;

    if !resp.status().is_success() {
        return Ok(None);
    }
    let providers: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();
    let Some(p) = providers.iter().find(|p| p.get("providerType").and_then(|v| v.as_str()) == Some("custom-openai")) else {
        return Ok(None);
    };

    Ok(Some(CustomOpenAIConfig {
        endpoint: p.get("endpoint").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        api_key: None,
        model: p.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        max_tokens: p.get("maxTokens").and_then(|v| v.as_i64()).map(|n| n as u32),
        temperature: p.get("temperature").and_then(|v| v.as_f64()).map(|n| n as f32),
        top_p: None,
    }))
}

/// Tests the connection to a custom OpenAI-compatible endpoint
/// Makes a minimal request to verify the endpoint is reachable and responds correctly
#[tauri::command]
pub async fn api_test_custom_openai_connection<R: Runtime>(
    _app: AppHandle<R>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_test_custom_openai_connection called: endpoint='{}', model='{}'",
        &endpoint,
        &model
    );

    // Validate endpoint URL format
    if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
        return Err("Endpoint must start with http:// or https://".to_string());
    }

    // Build the URL - append /chat/completions to the base endpoint
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    // Create a minimal test request
    let test_request = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Hi"
            }
        ],
        "max_tokens": 5
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&test_request);

    // Add authorization if API key provided
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        request = request.header("Authorization", format!("Bearer {}", key));
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            let response_text = response.text().await.unwrap_or_default();

            if status.is_success() {
                // Parse response as JSON to verify it's a valid OpenAI-compatible response
                match serde_json::from_str::<serde_json::Value>(&response_text) {
                    Ok(json) => {
                        // Verify the response has the expected OpenAI structure
                        if let Some(choices) = json.get("choices") {
                            if let Some(choices_array) = choices.as_array() {
                                if !choices_array.is_empty() {
                                    // Verify the first choice has the required message structure
                                    if let Some(first_choice) = choices_array.get(0) {
                                        // Check if message.content field exists (can be empty string)
                                        let has_message_structure = first_choice
                                            .get("message")
                                            .and_then(|m| {
                                                m.get("content")
                                                .or_else(|| m.get("reasoning_content"))
                                            })
                                            .is_some();

                                        if has_message_structure {
                                            log_info!("✅ Custom OpenAI connection test successful - response validated");
                                            return Ok(serde_json::json!({
                                                "status": "success",
                                                "message": "Connection successful and response validated",
                                                "http_status": status.as_u16()
                                            }));
                                        }
                                    }
                                }
                            }
                        }

                        // Response was 200 but doesn't match OpenAI format
                        log_warn!("⚠️ Endpoint returned 200 but response doesn't match OpenAI format: {}", response_text);
                        Err("Endpoint is reachable but doesn't appear to be OpenAI-compatible. Response is missing 'choices' array or 'message.content' / 'message.reasoning_content' field.".to_string())
                    }
                    Err(e) => {
                        log_warn!("⚠️ Endpoint returned 200 but response is not valid JSON: {}", e);
                        Err(format!("Endpoint is reachable but returned invalid JSON: {}. Response: {}", e, response_text))
                    }
                }
            } else {
                log_warn!("⚠️ Custom OpenAI connection test failed with status {}: {}", status, response_text);
                Err(format!("Connection failed with status {}: {}", status, response_text))
            }
        }
        Err(e) => {
            log_error!("❌ Custom OpenAI connection test failed: {}", e);
            if e.is_timeout() {
                Err("Connection timed out. Please check the endpoint URL.".to_string())
            } else if e.is_connect() {
                Err("Could not connect to endpoint. Please verify the URL is correct and the server is running.".to_string())
            } else {
                Err(format!("Connection failed: {}", e))
            }
        }
    }
}

// ===== CallPilot settings persistence =====

const STORE_FILE: &str = "settings.json";

fn read_store_string<R: Runtime>(app: &AppHandle<R>, key: &str) -> Option<String> {
    app.store(STORE_FILE).ok()?.get(key).and_then(|v| v.as_str().map(|s| s.to_string()))
}

#[tauri::command]
pub async fn set_callpilot_api_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| format!("store: {}", e))?;
    store.set("callpilot_api_url", serde_json::Value::String(url));
    store.save().map_err(|e| format!("save: {}", e))?;
    log_info!("Updated CallPilot API URL");
    Ok(())
}

#[tauri::command]
pub async fn get_callpilot_api_url<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(read_store_string(&app, "callpilot_api_url").unwrap_or_else(|| DEFAULT_CALLPILOT_API_URL.to_string()))
}

#[tauri::command]
pub async fn set_callpilot_ai_engine_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| format!("store: {}", e))?;
    store.set("callpilot_ai_engine_url", serde_json::Value::String(url));
    store.save().map_err(|e| format!("save: {}", e))?;
    log_info!("Updated CallPilot AI engine URL");
    Ok(())
}

#[tauri::command]
pub async fn get_callpilot_ai_engine_url<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(read_store_string(&app, "callpilot_ai_engine_url").unwrap_or_else(|| DEFAULT_CALLPILOT_AI_ENGINE_URL.to_string()))
}

// ===== CallPilot-specific: test health check endpoint =====

#[tauri::command]
pub async fn callpilot_test_connection<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    let server_url = get_server_address(&app).await?;
    let health_url = format!("{}/health", server_url.trim_end_matches('/'));
    log_info!("CallPilot test connection → {}", health_url);

    let client = reqwest::Client::new();
    match client
        .get(&health_url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status().as_u16();
            log_info!("CallPilot test connection: HTTP {}", status);
            Ok(serde_json::json!({ "ok": true, "status": status }))
        }
        Err(e) => {
            let msg = if e.is_timeout() {
                "Connection timed out. Is the CallPilot server running?".to_string()
            } else if e.is_connect() {
                format!("Could not connect to {}. Verify the URL is correct and the server is up.", server_url)
            } else {
                format!("Connection failed: {}", e)
            };
            log_warn!("CallPilot test connection failed: {}", msg);
            Ok(serde_json::json!({ "ok": false, "error": msg }))
        }
    }
}

/// Generic JSON proxy: sends a REST call to the .NET Gateway from Rust (no CORS).
/// Works around the fact that Tauri's webview blocks cross-origin fetch() to
/// Docker-localhost endpoints. The frontend calls `invoke('callpilot_api_request', ...)`
/// instead of `fetch(...)`.
///
/// If `auth_token` is supplied, attaches `Authorization: Bearer <token>` so the call
/// can reach protected endpoints (meetings, knowledge, providers, …).
#[tauri::command]
pub async fn callpilot_api_request<R: Runtime>(
    app: AppHandle<R>,
    method: String,
    path: String,
    body: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let server_url = get_server_address(&app).await?;
    let url = format!("{}{}", server_url.trim_end_matches('/'), path);
    log_debug!("callpilot_api_request {} {}", method, url);

    let client = reqwest::Client::new();
    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        other => return Err(format!("Unsupported method: {}", other)),
    };

    request = request.header("Content-Type", "application/json");

    if let Some(token) = auth_token {
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", token));
        }
    }

    if let Some(json) = body {
        request = request.body(json);
    }

    match request.timeout(std::time::Duration::from_secs(30)).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();
            if status >= 200 && status < 300 {
                if text.is_empty() {
                    Ok(serde_json::json!({ "ok": true, "status": status }))
                } else {
                    match serde_json::from_str(&text) {
                        Ok(v) => Ok(v),
                        Err(_) => Ok(serde_json::json!({ "data": text })),
                    }
                }
            } else {
                Err(format!("HTTP {}: {}", status, text))
            }
        }
        Err(e) => {
            let msg = if e.is_timeout() {
                "Request timed out".to_string()
            } else if e.is_connect() {
                format!("Could not connect to {}. Is the Docker container running?", server_url)
            } else {
                format!("Request failed: {}", e)
            };
            Err(msg)
        }
    }
}

/// Multipart upload sibling of `callpilot_api_request`. The .NET
/// `POST /api/v1/knowledge/upload` endpoint requires multipart/form-data
/// (it reads `request.Form.Files[0]`), so the JSON proxy above can't
/// carry it. The frontend reads the picked file via the existing
/// `read_audio_file` Tauri command (Tauri extends the File API with
/// `.path`), then sends the bytes here. The Rust side builds a real
/// multipart body and forwards it to the .NET endpoint with the same
/// auth + response handling as the JSON proxy.
#[tauri::command]
pub async fn callpilot_api_upload<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    file_name: String,
    content_type: String,
    file_bytes: Vec<u8>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let server_url = get_server_address(&app).await?;
    let url = format!("{}{}", server_url.trim_end_matches('/'), path);
    log_debug!("callpilot_api_upload {} ({} bytes)", url, file_bytes.len());

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.clone())
        .mime_str(&content_type)
        .map_err(|e| format!("Invalid content type '{}': {}", content_type, e))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = reqwest::Client::new();
    let mut request = client.post(&url).multipart(form);

    if let Some(token) = auth_token {
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", token));
        }
    }

    match request.timeout(std::time::Duration::from_secs(60)).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();
            if status >= 200 && status < 300 {
                if text.is_empty() {
                    Ok(serde_json::json!({ "ok": true, "status": status }))
                } else {
                    match serde_json::from_str(&text) {
                        Ok(v) => Ok(v),
                        Err(_) => Ok(serde_json::json!({ "data": text })),
                    }
                }
            } else {
                Err(format!("HTTP {}: {}", status, text))
            }
        }
        Err(e) => {
            let msg = if e.is_timeout() {
                "Upload timed out".to_string()
            } else if e.is_connect() {
                format!("Could not connect to {}. Is the Docker container running?", server_url)
            } else {
                format!("Upload failed: {}", e)
            };
            Err(msg)
        }
    }
}
