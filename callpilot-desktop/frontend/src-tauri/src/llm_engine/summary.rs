//! Local meeting summarization.
//!
//! The transcript is never sent anywhere - it is chunked and summarized by the
//! locally installed GGUF model (via the bundled llama-helper sidecar), then a
//! final synthesis produces the meeting summary. Long transcripts are handled
//! with a chunk -> intermediate summary -> final synthesis pass that preserves
//! meeting context (not a naive concatenation). Progress is reported as named
//! stages with a 0-100 value so the UI never looks frozen without faking
//! precision.
//!
//! Model inference is injected by the caller as `llm` (the helper wiring lives
//! in commands.rs).

use std::future::Future;
use std::pin::Pin;

/// Stable JSON schema the local model is asked to produce. Kept extensible -
/// the UI renders only the sections that contain data.
pub const SUMMARY_SCHEMA_PROMPT: &str = r#"Return a JSON object with EXACTLY these keys and no others:
{
  "summary": "3-5 sentence executive summary of the meeting",
  "keyPoints": ["key discussion point", ...],
  "decisions": ["decision made", ...],
  "actionItems": ["who/what should happen next", ...],
  "customerRequirements": ["requirement or need the customer expressed", ...],
  "objections": ["objection, concern, or pain point raised", ...],
  "followUps": ["follow-up item", ...]
}
Only include facts grounded in the transcript. If a category has no content, use an empty list. Never invent details."#;

/// Chars per chunk for the per-chunk pass. JSON output adds tokens, so we keep
/// a conservative budget even for high-context models.
const CHUNK_BUDGET_CHARS: usize = 2800;

/// Extracts the first balanced JSON object from a model response, tolerating
/// markdown fences and surrounding prose.
fn extract_json(raw: &str) -> Option<serde_json::Value> {
    let text = raw.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text);
    let text = text.strip_suffix("```").unwrap_or(text).trim();
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(&text[start..=end]).ok()
}

fn split_chunks(transcript: &str, budget: usize) -> Vec<String> {
    if transcript.chars().count() <= budget {
        return vec![transcript.to_string()];
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    let chars: Vec<char> = transcript.chars().collect();
    while start < chars.len() {
        let mut end = (start + budget).min(chars.len());
        // Try to break on a sentence/line boundary rather than mid-word.
        if end < chars.len() {
            if let Some(rel) = chars[start..end]
                .iter()
                .rposition(|c| *c == '\n' || *c == '.')
            {
                end = start + rel + 1;
            }
        }
        let chunk: String = chars[start..end].iter().collect();
        if !chunk.trim().is_empty() {
            chunks.push(chunk);
        }
        start = end;
    }
    chunks
}

fn chunk_prompt(chunk: &str) -> String {
    format!(
        "You are summarizing a segment of a sales meeting transcript.\n\nTranscript segment:\n{}\n\nReturn ONLY the JSON object.",
        chunk,
    )
}

fn synthesis_prompt(intermediate: &[String]) -> String {
    let combined = intermediate.join("\n\n---\n\n");
    format!(
        "You are synthesizing a complete meeting summary from several segment summaries below.\n\
         Produce ONE final summary of the whole meeting. Preserve the most important context, \
         decisions, action items, requirements, objections and follow-ups.\n\n\
         Segment summaries:\n{}\n\nReturn ONLY the JSON object.",
        if combined.is_empty() { "(no segments)" } else { &combined }
    )
}

/// Runs local summarization for a meeting transcript.
/// `llm` receives the USER prompt content (the caller formats the chat
/// template and runs inference) and returns the raw model output.
/// `emit` reports (stage, percent) where stage is one of
/// "preparing" | "summarizing" | "synthesizing" | "finalizing".
pub async fn summarize_meeting<F, E>(
    transcript: &str,
    mut llm: F,
    emit: E,
) -> Result<serde_json::Value, String>
where
    F: FnMut(String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>>,
    E: Fn(String, u8) + Send + 'static,
{
    emit("preparing".to_string(), 2);

    let cleaned = transcript.trim();
    if cleaned.is_empty() {
        return Err("The meeting has no transcript to summarize.".to_string());
    }

    let chunks = split_chunks(cleaned, CHUNK_BUDGET_CHARS);
    let n = chunks.len();

    if n == 1 {
        // Single pass: the whole transcript fits.
        emit("summarizing".to_string(), 40);
        let raw = llm(chunk_prompt(&chunks[0])).await?;
        emit("finalizing".to_string(), 90);
        return extract_json(&raw)
            .ok_or_else(|| "The model returned an unreadable summary.".to_string());
    }

    // Multi-pass: summarize each chunk, then synthesize.
    emit("summarizing".to_string(), 5);
    let mut intermediates = Vec::with_capacity(n);
    for (i, chunk) in chunks.iter().enumerate() {
        let raw = llm(chunk_prompt(chunk)).await?;
        let value = extract_json(&raw).ok_or_else(|| {
            format!("The model returned an unreadable summary for segment {}.", i + 1)
        })?;
        intermediates.push(value.to_string());
        let percent = 5 + ((i + 1) as f64 / n as f64 * 60.0) as u8;
        emit("summarizing".to_string(), percent.min(70));
    }

    emit("synthesizing".to_string(), 75);
    let raw = llm(synthesis_prompt(&intermediates)).await?;
    emit("finalizing".to_string(), 92);
    extract_json(&raw).ok_or_else(|| "The model returned an unreadable final summary.".to_string())
}
