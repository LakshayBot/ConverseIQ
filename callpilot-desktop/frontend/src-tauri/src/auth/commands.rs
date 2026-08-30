// Auth session persistence - stores the access/refresh token pair (plus user
// metadata) in the same Tauri store the rest of the app uses (`settings.json`).
//
// Why server-side? The refresh token should never reach the webview - keeping
// the rotation on the Rust side means a compromised render process can't be
// used to mint long-lived sessions. The webview only ever holds the short-
// lived access token, fetched per-call via `get_auth_access_token`.
//
// Storage key: `auth_session` (a single JSON blob). Removing it = signed out.

use log::{error as log_error, info as log_info, warn as log_warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const AUTH_SESSION_KEY: &str = "auth_session";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    pub access_token_expires_at: String,
    pub refresh_token_expires_at: String,
    pub email: String,
}

fn read_session<R: Runtime>(app: &AppHandle<R>) -> Option<AuthSession> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(AUTH_SESSION_KEY)?;
    serde_json::from_value::<AuthSession>(value).ok()
}

fn write_session<R: Runtime>(app: &AppHandle<R>, session: &AuthSession) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("store: {}", e))?;
    let json = serde_json::to_value(session).map_err(|e| format!("serialize: {}", e))?;
    store.set(AUTH_SESSION_KEY, json);
    store.save().map_err(|e| format!("save: {}", e))?;
    Ok(())
}

fn clear_session<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("store: {}", e))?;
    store.delete(AUTH_SESSION_KEY);
    store.save().map_err(|e| format!("save: {}", e))?;
    Ok(())
}

async fn server_url<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("store: {}", e))?;
    if let Some(value) = store.get("callpilot_api_url") {
        if let Some(url) = value.as_str() {
            if !url.is_empty() {
                return Ok(url.trim_end_matches('/').to_string());
            }
        }
    }
    Ok("http://localhost:5001".to_string())
}

/// Persist a freshly-issued session. Called by the frontend right after
/// `POST /api/v1/auth/login` (or `register`) succeeds.
#[tauri::command]
pub async fn set_auth_token<R: Runtime>(
    app: AppHandle<R>,
    access_token: String,
    refresh_token: String,
    access_token_expires_at: String,
    refresh_token_expires_at: String,
    email: String,
) -> Result<(), String> {
    let session = AuthSession {
        access_token,
        refresh_token,
        access_token_expires_at,
        refresh_token_expires_at,
        email,
    };
    write_session(&app, &session)?;
    log_info!("Auth session persisted for {}", session.email);
    Ok(())
}

/// Returns the current access token (for attaching to `callpilot_api_request`)
/// or `None` if no session is stored. The frontend uses this on every
/// authenticated call so the Rust side can stamp the `Authorization` header.
///
/// Proactively refreshes if the token expires within 5 min (like the JS
/// proactive check) — this catches the case where the webview hasn't yet
/// run its JS refresh but Rust is asked for a token.
#[tauri::command]
pub async fn get_auth_access_token<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    if let Some(session) = read_session(&app) {
        // Check if token is expiring within 5 min (parse ISO8601)
        let needs_refresh = chrono::DateTime::parse_from_rfc3339(&session.access_token_expires_at)
            .map(|exp| {
                let now = chrono::Utc::now();
                let exp_utc = exp.with_timezone(&chrono::Utc);
                (exp_utc - now).num_milliseconds() < 5 * 60 * 1000
            })
            .unwrap_or(false);

        if needs_refresh {
            // Best-effort silent refresh; fall through to old token if it fails
            // (the 401 handler in JS will then do a proper refresh + retry)
            if let Ok(Some(refreshed)) = refresh_access_token(app.clone()).await {
                return Ok(Some(refreshed.access_token));
            }
        }
        return Ok(Some(session.access_token));
    }
    Ok(None)
}

/// Returns the full session (email + token metadata). Used by `AuthContext`
/// to render the signed-in email and decide whether the session is still
/// within its expiry window.
#[tauri::command]
pub async fn get_auth_session<R: Runtime>(app: AppHandle<R>) -> Result<Option<AuthSession>, String> {
    Ok(read_session(&app))
}

/// Wipes the stored session. Called after a successful `POST /api/v1/auth/logout`
/// or when the user clicks "Sign out" in settings.
#[tauri::command]
pub async fn clear_auth_token<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    clear_session(&app)?;
    log_info!("Auth session cleared");
    Ok(())
}

/// Server-side token refresh. Calls `POST /api/v1/auth/refresh` using the
/// stored refresh token, persists the rotated pair, and returns it.
///
/// Returns `Ok(None)` when there is no stored refresh token (cold launch with
/// no prior session). Returns `Err(...)` when the server rejects the refresh
/// token (expired/revoked) - the frontend should clear the session in that
/// case and route the user to the login screen.
#[tauri::command]
pub async fn refresh_access_token<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<AuthSession>, String> {
    let session = match read_session(&app) {
        Some(s) => s,
        None => {
            log_info!("refresh_access_token: no session stored");
            return Ok(None);
        }
    };

    let base = server_url(&app).await?;
    let url = format!("{}/api/v1/auth/refresh", base);
    log_info!("refresh_access_token → {}", url);

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .body(format!(
            r#"{{"refreshToken":"{}"}}"#,
            session.refresh_token.replace('"', r#"\""#)
        ))
        .send()
        .await
        .map_err(|e| {
            let msg = if e.is_timeout() {
                "Refresh timed out".to_string()
            } else if e.is_connect() {
                "Could not reach the CallPilot server".to_string()
            } else {
                format!("Refresh request failed: {}", e)
            };
            log_error!("{}", msg);
            msg
        })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        let msg = format!("HTTP {}: {}", status, text);
        log_warn!("refresh_access_token failed: {}", msg);
        // Treat 401 as a permanent logout - the stored refresh token is dead.
        if status.as_u16() == 401 {
            clear_session(&app)?;
        }
        return Err(msg);
    }

    #[derive(Deserialize)]
    #[allow(non_snake_case)]
    struct RefreshResp {
        accessToken: String,
        refreshToken: String,
        accessTokenExpiresAt: String,
        refreshTokenExpiresAt: String,
    }

    let parsed: RefreshResp = serde_json::from_str(&text)
        .map_err(|e| format!("Could not parse refresh response: {}", e))?;

    let next = AuthSession {
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
        access_token_expires_at: parsed.accessTokenExpiresAt,
        refresh_token_expires_at: parsed.refreshTokenExpiresAt,
        email: session.email,
    };

    write_session(&app, &next)?;
    log_info!("refresh_access_token: rotated for {}", next.email);
    Ok(Some(next))
}
