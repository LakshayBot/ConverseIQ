//! Client for the bundled llama-helper sidecar (llama.cpp over JSON stdio).
//!
//! Spawns the llama-helper binary, keeps it alive across generation requests
//! (one spawn per summary run), and shuts it down cleanly. The protocol is
//! newline-delimited JSON: we write `generate` requests to stdin and read
//! `response` frames from stdout. llama-helper's stderr is drained and logged.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

use crate::llm_engine::models::{DEFAULT_MAX_TOKENS, GENERATION_TIMEOUT_SECS, SamplingParams};

/// Locates the bundled llama-helper binary.
/// Priority: env override -> exe dir -> resource dir (externalBin layout).
pub fn resolve_helper_binary<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    if let Ok(p) = std::env::var("CALLPILOT_LLAMA_HELPER") {
        if !p.trim().is_empty() {
            return Ok(std::path::PathBuf::from(p));
        }
    }

    let names = ["llama-helper", "llama-helper.exe"];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for n in &names {
                let candidate = dir.join(n);
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }
    }

    if let Ok(resources) = app.path().resource_dir() {
        for base in [
            resources.join("binaries"),
            resources.clone(),
            resources.join("../lib").join("llama-helper"),
        ] {
            for n in &names {
                let candidate = base.join(n);
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }
        if let Ok(entries) = std::fs::read_dir(&resources) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if name.starts_with("llama-helper") {
                        return Ok(path);
                    }
                }
            }
        }
    }

    Err("llama-helper binary not found. Reinstall or rebuild the application.".to_string())
}

/// Whether the llama-helper sidecar is available on this install.
pub fn helper_available<R: Runtime>(app: &AppHandle<R>) -> bool {
    resolve_helper_binary(app).is_ok()
}

/// A running llama-helper subprocess.
pub struct LlamaHelper {
    child: Child,
    stdin: ChildStdin,
    stdout: tokio::io::BufReader<ChildStdout>,
}

impl LlamaHelper {
    pub async fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let binary = resolve_helper_binary(app)?;
        let mut child = Command::new(&binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to start llama-helper: {e}"))?;
        let stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
        let mut stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

        // Drain stderr into the app log so llama.cpp diagnostics stay visible.
        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            while stderr.read_buf(&mut buf).await.unwrap_or(0) > 0 {
                if let Ok(text) = std::str::from_utf8(&buf) {
                    for line in text.lines() {
                        log::debug!("[llama-helper] {line}");
                    }
                }
                buf.clear();
            }
        });

        Ok(Self {
            child,
            stdin,
            stdout: tokio::io::BufReader::new(stdout),
        })
    }

    /// Runs one generation and returns the raw model output.
    pub async fn generate(
        &mut self,
        model_path: &Path,
        context_size: u32,
        prompt: &str,
        sampling: &SamplingParams,
    ) -> Result<String, String> {
        let payload = serde_json::json!({
            "type": "generate",
            "prompt": prompt,
            "model_path": model_path.to_string_lossy(),
            "context_size": context_size,
            "max_tokens": DEFAULT_MAX_TOKENS,
            "temperature": sampling.temperature,
            "top_k": sampling.top_k,
            "top_p": sampling.top_p,
            "presence_penalty": sampling.presence_penalty,
            "frequency_penalty": sampling.frequency_penalty,
            "repeat_penalty": sampling.repeat_penalty,
            "penalty_last_n": sampling.penalty_last_n,
            "stop_tokens": sampling.stop_tokens,
        });
        let mut line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("failed to write to llama-helper: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("failed to flush llama-helper stdin: {e}"))?;

        let deadline = Duration::from_secs(GENERATION_TIMEOUT_SECS);
        loop {
            let mut response = String::new();
            let read = timeout(deadline, self.stdout.read_line(&mut response))
                .await
                .map_err(|_| "llama-helper timed out during generation".to_string())?
                .map_err(|e| format!("llama-helper read error: {e}"))?;
            if read == 0 {
                return Err("llama-helper exited unexpectedly".to_string());
            }
            let value: serde_json::Value = serde_json::from_str(response.trim())
                .map_err(|e| format!("invalid reply from llama-helper: {e}"))?;
            match value["type"].as_str() {
                Some("response") => {
                    if let Some(err) = value["error"].as_str() {
                        return Err(err.to_string());
                    }
                    return Ok(value["text"].as_str().unwrap_or("").to_string());
                }
                Some("error") => {
                    return Err(value["message"].as_str().unwrap_or("llama-helper error").to_string());
                }
                Some("goodbye") => return Err("llama-helper went idle".to_string()),
                _ => continue,
            }
        }
    }

    /// Best-effort clean shutdown: request Goodbye, then kill + reap.
    pub async fn shutdown(&mut self) {
        let _ = self.stdin.write_all(b"{\"type\":\"shutdown\"}\n").await;
        let _ = self.stdin.flush().await;
        let _ = timeout(Duration::from_secs(3), self.child.wait()).await;
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

impl Drop for LlamaHelper {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"{\"type\":\"shutdown\"}\n");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
    }
}
