//! CallPilot e2e regression harness.
//!
//! Drives the REAL production audio pipeline outside the Tauri runtime so the
//! regression suite exercises the same implementations the app uses:
//!
//!   transcribe - decode_audio_file (ffmpeg) -> to_whisper_format (16k mono)
//!               -> Silero ContinuousVadProcessor -> Parakeet/Whisper engine
//!   diarize    - decode_to_16k_wav (ffmpeg) -> diar-helper (sherpa-onnx)
//!   align      - the exact production turn-to-segment alignment
//!   summarize  - llama-helper (llama.cpp) + the production summarizer
//!
//! No production models, recordings, or configuration are touched: all model
//! downloads go to the caller-provided models dir, all artifacts to the
//! caller-provided output paths.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use app_lib::audio::decoder::decode_audio_file;
use app_lib::audio::vad::ContinuousVadProcessor;
use app_lib::llm_engine::helper::LlamaHelper;
use app_lib::llm_engine::models::{format_prompt, get_model_by_id, SamplingParams};
use app_lib::llm_engine::summary;
use app_lib::parakeet_engine::ParakeetEngine;
use app_lib::speaker_engine::helper::{DiarHelper, DiarSegment};
use app_lib::speaker_engine::models as diar_models;
use app_lib::whisper_engine::WhisperEngine;
use clap::{Parser, Subcommand};
use serde::Serialize;

#[derive(Parser)]
#[command(name = "e2e-harness", about = "CallPilot e2e regression harness")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Transcribes audio through the real decode -> VAD -> STT pipeline.
    Transcribe {
        #[arg(long)]
        audio: PathBuf,
        #[arg(long, default_value = "parakeet")]
        engine: String,
        #[arg(long, default_value = "parakeet-tdt-0.6b-v3-int8")]
        model: String,
        /// Directory that receives downloaded models (never the app's).
        #[arg(long)]
        models_dir: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Runs the real diar-helper (sherpa-onnx) on the audio file.
    Diarize {
        #[arg(long)]
        audio: PathBuf,
        /// Tier dir containing the embedding + segmentation ONNX files
        /// (names come from the production catalog).
        #[arg(long)]
        tier_dir: PathBuf,
        #[arg(long, default_value = "fast")]
        tier: String,
        #[arg(long)]
        helper: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Aligns diarization turns to transcript segments (production logic).
    Align {
        #[arg(long)]
        transcript: PathBuf,
        #[arg(long)]
        turns: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Runs the real llama-helper local summarization on a transcript.
    Summarize {
        #[arg(long)]
        transcript: PathBuf,
        #[arg(long)]
        gguf: PathBuf,
        #[arg(long, default_value = "qwen3.5-2b-q4")]
        model: String,
        #[arg(long)]
        helper: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
}

#[derive(Serialize, serde::Deserialize)]
struct TranscriptSegment {
    sequence: u64,
    start_secs: f64,
    end_secs: f64,
    text: String,
    confidence: Option<f32>,
}

#[derive(Serialize, serde::Deserialize)]
struct TurnsOutput {
    segments: Vec<DiarSegment>,
}

#[derive(Serialize)]
struct AssignmentsOutput {
    /// segment index -> speaker cluster index (None = unassigned)
    assignments: Vec<Option<u32>>,
    total_segments: usize,
    assigned_segments: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let cli = Cli::parse();
    match cli.command {
        Commands::Transcribe {
            audio,
            engine,
            model,
            models_dir,
            out,
        } => run_transcribe(audio, &engine, &model, models_dir, out).await,
        Commands::Diarize {
            audio,
            tier_dir,
            tier,
            helper,
            out,
        } => run_diarize(audio, tier_dir, &tier, helper, out).await,
        Commands::Align {
            transcript,
            turns,
            out,
        } => run_align(transcript, turns, out),
        Commands::Summarize {
            transcript,
            gguf,
            model,
            helper,
            out,
        } => run_summarize(transcript, gguf, &model, helper, out).await,
    }
}

/// The exact production chain: ffmpeg decode -> 16k mono -> Silero VAD ->
/// STT engine (Parakeet TDT or whisper-rs).
async fn run_transcribe(
    audio: PathBuf,
    engine: &str,
    model: &str,
    models_dir: PathBuf,
    out: PathBuf,
) -> Result<()> {
    log::info!("decode: {}", audio.display());
    let decoded = decode_audio_file(&audio)
        .map_err(|e| anyhow!("decode_audio_file failed: {e}"))?;
    let samples_16k = decoded.to_whisper_format();
    log::info!(
        "decoded {}s at {}Hz {}ch -> {} samples @16k",
        decoded.duration_seconds,
        decoded.sample_rate,
        decoded.channels,
        samples_16k.len()
    );

    // Real Silero VAD, fed in the same 600 ms windows the live pipeline uses.
    let mut vad = ContinuousVadProcessor::new(16000, 400)
        .map_err(|e| anyhow!("VAD init failed: {e}"))?;
    let mut segments = Vec::new();
    let window = 9600; // 600 ms @ 16k
    for chunk in samples_16k.chunks(window) {
        for seg in vad
            .process_audio(chunk)
            .map_err(|e| anyhow!("VAD process failed: {e}"))?
        {
            segments.push(seg);
        }
    }
    for seg in vad.flush().map_err(|e| anyhow!("VAD flush failed: {e}"))? {
        segments.push(seg);
    }
    log::info!("VAD produced {} speech segments", segments.len());
    if segments.is_empty() {
        return Err(anyhow!("no speech segments detected - is the audio valid?"));
    }

    // Real STT engine with its own isolated models dir (never the app's).
    let transcribed: Vec<TranscriptSegment> = match engine {
        "parakeet" => {
            let engine = ParakeetEngine::new_with_models_dir(Some(models_dir))
                .map_err(|e| anyhow!("parakeet engine init failed: {e}"))?;
            let available = engine
                .discover_models()
                .await
                .map_err(|e| anyhow!("discover_models failed: {e}"))?;
            if !available.iter().any(|m| {
                m.name == model
                    && matches!(
                        m.status,
                        app_lib::parakeet_engine::ModelStatus::Available
                    )
            }) {
                log::info!("model {model} not downloaded - downloading (real download path)");
                engine
                    .download_model(model, None)
                    .await
                    .map_err(|e| anyhow!("parakeet download failed: {e}"))?;
            }
            // Re-discover so the in-memory status map reflects the download
            // (load_model validates against this map - same as the app).
            engine
                .discover_models()
                .await
                .map_err(|e| anyhow!("discover_models (post-download) failed: {e}"))?;
            engine
                .load_model(model)
                .await
                .map_err(|e| anyhow!("parakeet load failed: {e}"))?;

            let mut out = Vec::new();
            for (i, seg) in segments.iter().enumerate() {
                let text = engine
                    .transcribe_audio(seg.samples.clone())
                    .await
                    .map_err(|e| anyhow!("parakeet transcribe failed: {e}"))?;
                let text = text.trim().to_string();
                if text.is_empty() {
                    log::debug!("segment {i} transcribed empty - skipped");
                    continue;
                }
                log::info!("[{}] {:.2}-{:.2}s: {text}", i + 1, seg.start_timestamp_ms / 1000.0, seg.end_timestamp_ms / 1000.0);
                out.push(TranscriptSegment {
                    sequence: out.len() as u64,
                    start_secs: seg.start_timestamp_ms / 1000.0,
                    end_secs: seg.end_timestamp_ms / 1000.0,
                    text,
                    confidence: None,
                });
            }
            out
        }
        "whisper" => {
            let engine = WhisperEngine::new_with_models_dir(Some(models_dir))
                .map_err(|e| anyhow!("whisper engine init failed: {e}"))?;
            let available = engine
                .discover_models()
                .await
                .map_err(|e| anyhow!("whisper discover failed: {e}"))?;
            if !available.iter().any(|m| {
                m.name == model
                    && matches!(
                        m.status,
                        app_lib::whisper_engine::ModelStatus::Available
                    )
            }) {
                log::info!("model {model} not downloaded - downloading (real download path)");
                engine
                    .download_model(model, None)
                    .await
                    .map_err(|e| anyhow!("whisper download failed: {e}"))?;
            }
            // Re-discover so the in-memory status map reflects the download
            // (load_model validates against this map - same as the app).
            engine
                .discover_models()
                .await
                .map_err(|e| anyhow!("whisper discover (post-download) failed: {e}"))?;
            engine
                .load_model(model)
                .await
                .map_err(|e| anyhow!("whisper load failed: {e}"))?;

            let mut out = Vec::new();
            for (i, seg) in segments.iter().enumerate() {
                let (text, confidence, _is_partial) = engine
                    .transcribe_audio_with_confidence(seg.samples.clone(), Some("en".to_string()))
                    .await
                    .map_err(|e| anyhow!("whisper transcribe failed: {e}"))?;
                let text = text.trim().to_string();
                if text.is_empty() {
                    continue;
                }
                log::info!("[{}] {:.2}-{:.2}s: {text}", i + 1, seg.start_timestamp_ms / 1000.0, seg.end_timestamp_ms / 1000.0);
                out.push(TranscriptSegment {
                    sequence: out.len() as u64,
                    start_secs: seg.start_timestamp_ms / 1000.0,
                    end_secs: seg.end_timestamp_ms / 1000.0,
                    text,
                    confidence: Some(confidence),
                });
            }
            out
        }
        other => return Err(anyhow!("unknown engine: {other}")),
    };

    if transcribed.is_empty() {
        return Err(anyhow!("transcription produced no non-empty segments"));
    }
    write_json(&transcribed, &out)?;
    Ok(())
}

/// The real diar-helper (sherpa-onnx) pipeline: decode to 16k wav (production
/// ffmpeg path), then `diarize` with the production tier definition.
async fn run_diarize(
    audio: PathBuf,
    tier_dir: PathBuf,
    tier: &str,
    helper: PathBuf,
    out: PathBuf,
) -> Result<()> {
    let def = diar_models::get_model_by_id(tier)
        .ok_or_else(|| anyhow!("unknown tier: {tier}"))?;

    let wav_path = std::env::temp_dir().join(format!(
        "callpilot-e2e-diar-{}.wav",
        std::process::id()
    ));
    app_lib::speaker_engine::commands::decode_to_16k_wav(&audio, &wav_path)
        .map_err(|e| anyhow!("decode_to_16k_wav failed: {e}"))?;

    let mut diar = DiarHelper::spawn_with_binary(helper)
        .await
        .map_err(|e| anyhow!("diar-helper spawn failed: {e}"))?;

    log::info!("diarizing {} (tier {tier})", audio.display());
    let segments = diar
        .diarize(&wav_path, &tier_dir, def, None, |percent| {
            log::info!("diarization progress: {percent}%");
        })
        .await
        .map_err(|e| anyhow!("diarize failed: {e}"))?;
    let _ = diar.shutdown().await;
    let _ = std::fs::remove_file(&wav_path);

    log::info!("diarization produced {} speaker turns", segments.len());
    write_json(&TurnsOutput { segments }, &out)?;
    Ok(())
}

/// The exact production alignment (commands::align_turns).
fn run_align(transcript: PathBuf, turns: PathBuf, out: PathBuf) -> Result<()> {
    let transcript: Vec<TranscriptSegment> = read_json(&transcript)?;
    let turns: TurnsOutput = read_json(&turns)?;

    let bounds: Vec<(f64, f64)> = transcript
        .iter()
        .map(|s| (s.start_secs, s.end_secs))
        .collect();
    let assignments = app_lib::speaker_engine::commands::align_turns(&bounds, &turns.segments);

    let assigned = assignments.iter().filter(|a| a.is_some()).count();
    log::info!(
        "aligned {} of {} segments to {} speaker turns",
        assigned,
        transcript.len(),
        turns.segments.len()
    );
    write_json(
        &AssignmentsOutput {
            total_segments: transcript.len(),
            assigned_segments: assigned,
            assignments,
        },
        &out,
    )?;
    Ok(())
}

/// The real llama-helper + production chunked summarizer. The GGUF model file
/// must already be downloaded by the orchestrator.
async fn run_summarize(
    transcript: PathBuf,
    gguf: PathBuf,
    model: &str,
    helper: PathBuf,
    out: PathBuf,
) -> Result<()> {
    let def = get_model_by_id(model).ok_or_else(|| anyhow!("unknown model: {model}"))?;
    let text = std::fs::read_to_string(&transcript).context("read transcript")?;

    let mut llm_helper = LlamaHelper::spawn_with_binary(helper)
        .await
        .map_err(|e| anyhow!("llama-helper spawn failed: {e}"))?;
    let helper = Arc::new(tokio::sync::Mutex::new(llm_helper));
    let helper_for_shutdown = helper.clone();
    let sampling: SamplingParams = def.sampling.clone();
    let template = def.template;
    let context_size = def.context_size;
    let path = gguf.clone();

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
        }) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
    };

    let emit = |_stage: String, percent: u8| log::info!("summary progress: {percent}%");
    let value = summary::summarize_meeting(&text, &mut llm, emit)
        .await
        .map_err(|e| anyhow!("summarize_meeting failed: {e}"))?;
    {
        let mut guard = helper_for_shutdown.lock().await;
        let _ = guard.shutdown().await;
    }
    write_json(&value, &out)?;
    Ok(())
}


fn write_json<T: Serialize>(value: &T, path: &PathBuf) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("create artifact dir")?;
    }
    let bytes = serde_json::to_vec_pretty(value).context("serialize")?;
    std::fs::write(path, bytes).context("write artifact")?;
    log::info!("wrote {}", path.display());
    Ok(())
}

fn read_json<T: for<'de> serde::Deserialize<'de>>(path: &PathBuf) -> Result<T> {
    let raw = std::fs::read_to_string(path).context("read json")?;
    serde_json::from_str(&raw).context("parse json")
}

