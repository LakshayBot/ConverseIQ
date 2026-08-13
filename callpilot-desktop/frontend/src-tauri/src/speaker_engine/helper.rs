//! Client for the bundled `diar-helper` sidecar (sherpa-onnx over JSON stdio).
//!
//! Mirrors `llm_engine::helper`: one spawn per job, newline-delimited JSON
//! frames, stderr drained to the app log. `diarize` runs offline speaker
//! segmentation+clustering on a 16 kHz mono WAV; `embed` extracts a speaker
//! embedding for live incremental matching.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use base64::Engine as _;
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

use super::models::DiarModelDef;

/// A speaker turn from offline diarization (seconds within the recording).
#[derive(Debug, Clone)]
pub struct DiarSegment {
    pub start: f32,
    pub end: f32,
    pub speaker: u32,
}

/// How long a full diarization may take (long meetings diarize at ~0.1-0.4x
/// realtime; 1h meeting => 6-24 min).
const DIARIZE_TIMEOUT_SECS: u64 = 60 * 60;
/// How long a single embedding extraction may take.
const EMBED_TIMEOUT_SECS: u64 = 60;

/// Locates the bundled diar-helper binary.
/// Priority: env override -> exe dir -> resource dir (externalBin layout).
pub fn resolve_helper_binary<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("CALLPILOT_DIAR_HELPER") {
        if !p.trim().is_empty() {
            return Ok(PathBuf::from(p));
        }
    }

    let names = ["diar-helper", "diar-helper.exe"];

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
            resources.join("../lib").join("diar-helper"),
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
                    if name.starts_with("diar-helper") {
                        return Ok(path);
                    }
                }
            }
        }
    }

    Err("diar-helper binary not found. Reinstall or rebuild the application.".to_string())
}

/// Whether the diar-helper sidecar is available on this install.
pub fn helper_available<R: Runtime>(app: &AppHandle<R>) -> bool {
    resolve_helper_binary(app).is_ok()
}

/// A running diar-helper subprocess.
pub struct DiarHelper {
    child: Child,
    stdin: ChildStdin,
    stdout: tokio::io::BufReader<ChildStdout>,
}

impl DiarHelper {
    pub async fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let binary = resolve_helper_binary(app)?;
        let mut child = Command::new(&binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to start diar-helper: {e}"))?;
        let stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
        let mut stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            while stderr.read_buf(&mut buf).await.unwrap_or(0) > 0 {
                if let Ok(text) = std::str::from_utf8(&buf) {
                    for line in text.lines() {
                        log::debug!("[diar-helper] {line}");
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

    /// Runs offline diarization on a 16 kHz mono WAV file. The tier dir must
    /// contain the embedding + segmentation ONNX files named by `def`.
    pub async fn diarize(
        &mut self,
        audio_path: &Path,
        tier_dir: &Path,
        def: &DiarModelDef,
        num_speakers: Option<u32>,
        mut on_progress: impl FnMut(u8) + Send,
    ) -> Result<Vec<DiarSegment>, String> {
        let payload = serde_json::json!({
            "type": "diarize",
            "audio_path": audio_path.to_string_lossy(),
            "segmentation_model": tier_dir.join(def.segmentation_file).to_string_lossy(),
            "embedding_model": tier_dir.join(def.embedding_file).to_string_lossy(),
            "num_speakers": num_speakers.map(|n| n as i32),
            "cluster_threshold": def.cluster_threshold,
        });
        self.send_line(&serde_json::to_string(&payload).map_err(|e| e.to_string())?).await?;

        let deadline = Duration::from_secs(DIARIZE_TIMEOUT_SECS);
        let start = std::time::Instant::now();
        loop {
            let remaining = deadline.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                return Err("diar-helper timed out during diarization".to_string());
            }
            let frame = self
                .read_frame(remaining)
                .await?
                .ok_or_else(|| "diar-helper exited unexpectedly".to_string())?;
            match frame["type"].as_str() {
                Some("progress") => {
                    on_progress(frame["percent"].as_u64().unwrap_or(0).clamp(0, 100) as u8);
                }
                Some("response") => {
                    let segments = frame["segments"]
                        .as_array()
                        .ok_or_else(|| "malformed diarization result".to_string())?
                        .iter()
                        .map(|s| DiarSegment {
                            start: s["start"].as_f64().unwrap_or(0.0) as f32,
                            end: s["end"].as_f64().unwrap_or(0.0) as f32,
                            speaker: s["speaker"].as_i64().unwrap_or(0).max(0) as u32,
                        })
                        .collect();
                    return Ok(segments);
                }
                Some("error") => {
                    return Err(frame["message"]
                        .as_str()
                        .unwrap_or("diar-helper error")
                        .to_string());
                }
                Some("goodbye") => return Err("diar-helper went idle".to_string()),
                _ => continue,
            }
        }
    }

    /// Extracts the speaker embedding (Vec<f32>, 16 kHz mono samples in).
    pub async fn embed(
        &mut self,
        samples: &[f32],
        embedding_model: &Path,
    ) -> Result<Vec<f32>, String> {
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let payload = serde_json::json!({
            "type": "embed",
            "samples_b64": base64::engine::general_purpose::STANDARD.encode(&bytes),
            "sample_rate": 16000,
            "embedding_model": embedding_model.to_string_lossy(),
        });
        self.send_line(&serde_json::to_string(&payload).map_err(|e| e.to_string())?).await?;

        let deadline = Duration::from_secs(EMBED_TIMEOUT_SECS);
        let start = std::time::Instant::now();
        loop {
            let remaining = deadline.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                return Err("diar-helper timed out during embedding".to_string());
            }
            let frame = self
                .read_frame(remaining)
                .await?
                .ok_or_else(|| "diar-helper exited unexpectedly".to_string())?;
            match frame["type"].as_str() {
                Some("response") => {
                    return frame["embedding"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_f64())
                                .map(|v| v as f32)
                                .collect()
                        })
                        .ok_or_else(|| "malformed embedding result".to_string());
                }
                Some("error") => {
                    return Err(frame["message"]
                        .as_str()
                        .unwrap_or("diar-helper error")
                        .to_string());
                }
                _ => continue,
            }
        }
    }

    async fn send_line(&mut self, line: &str) -> Result<(), String> {
        let mut frame = line.to_string();
        frame.push('\n');
        self.stdin
            .write_all(frame.as_bytes())
            .await
            .map_err(|e| format!("failed to write to diar-helper: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("failed to flush diar-helper stdin: {e}"))
    }

    /// Reads the next protocol frame; None on EOF.
    async fn read_frame(&mut self, deadline: Duration) -> Result<Option<serde_json::Value>, String> {
        let mut response = String::new();
        let read = timeout(deadline, self.stdout.read_line(&mut response))
            .await
            .map_err(|_| "diar-helper timed out".to_string())?
            .map_err(|e| format!("diar-helper read error: {e}"))?;
        if read == 0 {
            return Ok(None);
        }
        let value: serde_json::Value = serde_json::from_str(response.trim())
            .map_err(|e| format!("invalid reply from diar-helper: {e}"))?;
        Ok(Some(value))
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

impl Drop for DiarHelper {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"{\"type\":\"shutdown\"}\n");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
    }
}
