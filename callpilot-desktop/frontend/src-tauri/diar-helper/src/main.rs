//! CallPilot bundled speaker diarization sidecar.
//!
//! Runs sherpa-onnx (speaker segmentation + speaker embedding + clustering)
//! over a newline-delimited JSON protocol on stdin/stdout. stdout is reserved
//! for protocol messages; all diagnostics go to stderr.
//!
//! Requests:
//!   {"type":"diarize","audio_path":...,"segmentation_model":...,"embedding_model":...,
//!    "num_speakers":null|int,"cluster_threshold":0.5,"min_duration_on":0.3,"min_duration_off":0.5}
//!   {"type":"embed","samples_b64":"...","sample_rate":16000,"embedding_model":...}
//!   {"type":"ping"}
//!   {"type":"shutdown"}
//!
//! Responses:
//!   {"type":"progress","processed":n,"total":m,"percent":p}
//!   {"type":"response","segments":[{"start":..,"end":..,"speaker":..}],...}
//!   {"type":"response","embedding":[...]}
//!   {"type":"error","message":"..."}
//!   {"type":"pong"}
//!   {"type":"goodbye"}
//!
//! The `diarize` request expects a 16 kHz mono WAV file (the caller decodes
//! the meeting recording with ffmpeg first). The `embed` request takes raw
//! 16 kHz mono f32 samples base64-encoded and returns the speaker embedding
//! vector (used by the app for live incremental speaker matching).

use std::io::{BufRead, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sherpa_rs::diarize::{Diarize, DiarizeConfig};
use sherpa_rs::speaker_id::{EmbeddingExtractor, ExtractorConfig};

/// Exit after this much idle time.
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    Diarize {
        audio_path: String,
        segmentation_model: String,
        embedding_model: String,
        num_speakers: Option<i32>,
        cluster_threshold: Option<f32>,
        min_duration_on: Option<f32>,
        min_duration_off: Option<f32>,
    },
    Embed {
        samples_b64: String,
        sample_rate: u32,
        embedding_model: String,
    },
    Ping,
    Shutdown,
}

#[derive(Serialize, Clone)]
struct Segment {
    start: f32,
    end: f32,
    speaker: i32,
}

fn send_response(value: serde_json::Value) {
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{}", value);
    let _ = stdout.flush();
}

fn send_error(message: impl Into<String>) {
    send_response(json!({ "type": "error", "message": message.into() }));
}

fn eprintln_diag(args: std::fmt::Arguments) {
    eprintln!("[diar-helper] {}", args);
}

/// Cached model state - keeps loaded models alive across requests so a
/// meeting only pays the model-load cost once.
struct ModelState {
    diarize: Option<Diarize>,
    diarize_key: Option<String>,
    extractor: Option<EmbeddingExtractor>,
    extractor_model: Option<String>,
}

impl ModelState {
    fn new() -> Self {
        Self {
            diarize: None,
            diarize_key: None,
            extractor: None,
            extractor_model: None,
        }
    }

    fn diarize(&mut self, segmentation_model: &str, embedding_model: &str, config: &DiarizeConfig) -> Result<&mut Diarize, String> {
        let key = format!("{segmentation_model}\0{embedding_model}");
        if self.diarize.is_none() || self.diarize_key.as_deref() != Some(key.as_str()) {
            eprintln_diag(format_args!("loading diarization models (seg: {segmentation_model}, emb: {embedding_model})"));
            let diarize = Diarize::new(segmentation_model, embedding_model, config.clone())
                .map_err(|e| format!("failed to load diarization models: {e}"))?;
            self.diarize = Some(diarize);
            self.diarize_key = Some(key);
        }
        Ok(self.diarize.as_mut().unwrap())
    }

    fn extractor(&mut self, model: &str) -> Result<&mut EmbeddingExtractor, String> {
        if self.extractor.is_none() || self.extractor_model.as_deref() != Some(model) {
            eprintln_diag(format_args!("loading speaker embedding model: {model}"));
            let extractor = EmbeddingExtractor::new(ExtractorConfig {
                model: model.to_string(),
                ..Default::default()
            })
            .map_err(|e| format!("failed to load speaker embedding model: {e}"))?;
            self.extractor = Some(extractor);
            self.extractor_model = Some(model.to_string());
        }
        Ok(self.extractor.as_mut().unwrap())
    }
}

fn handle_diarize(
    state: &mut ModelState,
    audio_path: &str,
    segmentation_model: &str,
    embedding_model: &str,
    num_speakers: Option<i32>,
    cluster_threshold: Option<f32>,
    min_duration_on: Option<f32>,
    min_duration_off: Option<f32>,
) -> Result<(), String> {
    if !Path::new(audio_path).exists() {
        return Err(format!("audio file not found: {audio_path}"));
    }
    if !Path::new(segmentation_model).exists() {
        return Err(format!("segmentation model not found: {segmentation_model}"));
    }
    if !Path::new(embedding_model).exists() {
        return Err(format!("embedding model not found: {embedding_model}"));
    }

    let (samples, sample_rate) = sherpa_rs::read_audio_file(audio_path)
        .map_err(|e| format!("failed to read audio file (must be 16 kHz mono wav): {e}"))?;
    if sample_rate != 16000 {
        return Err(format!("audio must be 16 kHz, got {sample_rate}"));
    }

    let config = DiarizeConfig {
        num_clusters: num_speakers,
        threshold: cluster_threshold,
        min_duration_on,
        min_duration_off,
        ..Default::default()
    };

    let diarize = state.diarize(segmentation_model, embedding_model, &config)?;

    let progress = move |processed: i32, total: i32| -> i32 {
        let percent = if total > 0 {
            (100 * processed / total).clamp(0, 100) as u8
        } else {
            0
        };
        let _ = send_response(json!({
            "type": "progress",
            "processed": processed,
            "total": total,
            "percent": percent,
        }));
        0
    };

    eprintln_diag(format_args!("diarizing {} ({} samples)", audio_path, samples.len()));
    let segments: Vec<Segment> = diarize
        .compute(samples, Some(Box::new(progress)))
        .map_err(|e| format!("diarization failed: {e}"))?
        .into_iter()
        .map(|s| Segment { start: s.start, end: s.end, speaker: s.speaker })
        .collect();

    send_response(json!({ "type": "response", "segments": segments }));
    Ok(())
}

fn handle_embed(
    state: &mut ModelState,
    samples_b64: &str,
    sample_rate: u32,
    embedding_model: &str,
) -> Result<(), String> {
    if !Path::new(embedding_model).exists() {
        return Err(format!("embedding model not found: {embedding_model}"));
    }

    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, samples_b64)
        .map_err(|e| format!("invalid samples payload: {e}"))?;
    if bytes.len() % 4 != 0 {
        return Err("samples payload is not f32-aligned".to_string());
    }
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    let extractor = state.extractor(embedding_model)?;
    let embedding = extractor
        .compute_speaker_embedding(samples, sample_rate)
        .map_err(|e| format!("embedding extraction failed: {e}"))?;

    send_response(json!({ "type": "response", "embedding": embedding }));
    Ok(())
}

fn main() {
    eprintln_diag(format_args!("diar-helper starting"));
    let mut state = ModelState::new();
    let stdin = std::io::stdin();
    let mut reader = std::io::BufReader::new(stdin.lock());
    let mut last_activity = Instant::now();

    loop {
        if last_activity.elapsed() > IDLE_TIMEOUT {
            send_response(json!({ "type": "goodbye" }));
            return;
        }

        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                // EOF - exit cleanly.
                return;
            }
            Ok(_) => {}
            Err(e) => {
                eprintln_diag(format_args!("read error: {e}"));
                return;
            }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        last_activity = Instant::now();
        let request: Request = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                send_error(format!("invalid request: {e}"));
                continue;
            }
        };

        match request {
            Request::Ping => {
                send_response(json!({ "type": "pong" }));
            }
            Request::Shutdown => {
                send_response(json!({ "type": "goodbye" }));
                return;
            }
            Request::Diarize {
                audio_path,
                segmentation_model,
                embedding_model,
                num_speakers,
                cluster_threshold,
                min_duration_on,
                min_duration_off,
            } => {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    handle_diarize(
                        &mut state,
                        &audio_path,
                        &segmentation_model,
                        &embedding_model,
                        num_speakers,
                        cluster_threshold,
                        min_duration_on,
                        min_duration_off,
                    )
                }));
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => send_error(e),
                    Err(panic) => {
                        let msg = panic
                            .downcast_ref::<String>()
                            .map(|s| s.as_str())
                            .or_else(|| panic.downcast_ref::<&str>().copied())
                            .unwrap_or("diarize panicked");
                        send_error(format!("diarization failed: {msg}"));
                    }
                }
            }
            Request::Embed {
                samples_b64,
                sample_rate,
                embedding_model,
            } => {
                if let Err(e) = handle_embed(&mut state, &samples_b64, sample_rate, &embedding_model) {
                    send_error(e);
                }
            }
        }
    }
}
