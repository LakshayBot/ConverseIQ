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
//! in commands.rs); `summarize_heuristic` is the zero-setup extractive fallback.

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

// ──────────────────────────────────────────────────────────────────────────────
// Built-in extractive summarizer - runs with ZERO setup (no Ollama, no model
// download). A statistical/feature-based fallback so every meeting gets a
// useful structured summary on the user's machine, even before they install a
// local LLM. The LLM path above is an optional quality upgrade on top.
// ──────────────────────────────────────────────────────────────────────────────

const STOPWORDS: &[&str] = &[
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "at", "by",
    "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do",
    "does", "did", "will", "would", "could", "should", "can", "may", "might", "shall", "not",
    "no", "yes", "so", "it", "its", "this", "that", "these", "those", "i", "you", "we", "they",
    "he", "she", "it's", "we're", "you're", "i'm", "there", "here", "then", "than", "just",
    "very", "really", "about", "which", "what", "when", "where", "who", "how", "why", "my",
    "your", "our", "their", "his", "her", "us", "them", "me", "him", "as", "if", "because",
    "also", "now", "okay", "ok", "um", "uh", "like", "know", "right", "well", "got", "get",
    "one", "two", "three", "let's", "going", "go", "think", "think", "something", "thing",
];

const CUE_ACTION: &[&str] = &[
    "we will", "we'll", "i will", "i'll", "i'm going to", "we're going to", "need to", "have to",
    "let's", "we should", "i should", "next step", "going to send", "send you", "will send",
    "will schedule", "set up", "arrange", "follow up with", "get back to", "plan to", "agreed to",
];

const CUE_DECISION: &[&str] = &[
    "we decided", "we've decided", "we agreed", "decision", "decided to", "agreed on",
    "let's go with", "final answer", "we'll go with", "signed", "confirmed",
];

const CUE_FOLLOWUP: &[&str] = &[
    "follow up", "circle back", "get back", "later this", "next week", "next month", "tomorrow",
    "send over", "share the", "touch base", "in the meantime", "i'll check", "we'll revisit",
];

const CUE_REQUIREMENT: &[&str] = &[
    "we need", "we want", "we require", "we're looking for", "looking for", "must have",
    "would like", "need it", "has to", "has to be", "should have", "requires", "requirement",
    "we're looking at", "important to us", "critical for us",
];

const CUE_OBJECTION: &[&str] = &[
    "but", "however", "unfortunately", "concern", "worried", "issue", "problem", "not sure",
    "too expensive", "budget", "we can't", "we can't afford", "not convinced", "hesitant",
    "the problem is", "our concern", "that's a concern",
];

fn to_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if ch == '.' || ch == '!' || ch == '?' || ch == '\n' {
            let trimmed = current.trim();
            if trimmed.chars().count() > 20 {
                sentences.push(trimmed.to_string());
            }
            current.clear();
        }
    }
    let trimmed = current.trim();
    if trimmed.chars().count() > 20 {
        sentences.push(trimmed.to_string());
    }
    sentences
}

fn significant_words(sentence: &str) -> Vec<String> {
    sentence
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|w| w.trim().to_lowercase())
        .filter(|w| w.chars().count() > 2 && !STOPWORDS.contains(&w.as_str()))
        .collect()
}

fn contains_any(sentence: &str, cues: &[&str]) -> bool {
    let lower = sentence.to_lowercase();
    cues.iter().any(|c| lower.contains(c))
}

fn cap_list(items: Vec<String>, max: usize) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let trimmed = item.split_whitespace().collect::<Vec<_>>().join(" ");
        if trimmed.chars().count() < 8 || !seen.insert(trimmed.to_lowercase()) {
            continue;
        }
        out.push(trimmed);
        if out.len() >= max {
            break;
        }
    }
    out
}

/// Produces a structured meeting summary without any external model.
pub fn summarize_heuristic(transcript: &str) -> serde_json::Value {
    let sentences = to_sentences(transcript);
    if sentences.is_empty() {
        return serde_json::json!({
            "summary": "No transcript available to summarize.",
            "keyPoints": [],
            "decisions": [],
            "actionItems": [],
            "customerRequirements": [],
            "objections": [],
            "followUps": [],
        });
    }

    // Word significance = document frequency.
    let mut freq: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for sentence in &sentences {
        for word in significant_words(sentence) {
            *freq.entry(word).or_default() += 1;
        }
    }

    // Score sentences: sum of significant-word frequencies (normalized) +
    // position bias (first and last sentences tend to be important).
    struct Scored {
        text: String,
        score: f64,
        index: usize,
    }
    let mut scored: Vec<Scored> = sentences
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let words = significant_words(s);
            let word_count = words.len().max(1) as f64;
            let mut score: f64 = 0.0;
            for word in words {
                score += *freq.get(&word).unwrap_or(&0) as f64;
            }
            score /= word_count;
            if i == 0 {
                score += 0.5;
            }
            if i + 1 == sentences.len() {
                score += 0.3;
            }
            Scored { text: s.clone(), score, index: i }
        })
        .collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let key_points = cap_list(
        scored.iter().map(|s| s.text.clone()).collect(),
        6,
    );

    let summary_text = {
        let mut acc = String::new();
        for (k, point) in key_points.iter().enumerate() {
            if k == 4 {
                break;
            }
            let trimmed = point.trim_end_matches(['.', '!', '?']);
            if !acc.is_empty() {
                acc.push(' ');
            }
            acc.push_str(trimmed);
            acc.push('.');
            if acc.chars().count() >= 600 {
                break;
            }
        }
        if acc.is_empty() {
            "Meeting transcript recorded.".to_string()
        } else {
            acc
        }
    };

    serde_json::json!({
        "summary": summary_text,
        "keyPoints": key_points,
        "decisions": cap_list(sentences.iter().filter(|s| contains_any(s, CUE_DECISION)).cloned().collect(), 4),
        "actionItems": cap_list(sentences.iter().filter(|s| contains_any(s, CUE_ACTION)).cloned().collect(), 6),
        "customerRequirements": cap_list(sentences.iter().filter(|s| contains_any(s, CUE_REQUIREMENT)).cloned().collect(), 5),
        "objections": cap_list(sentences.iter().filter(|s| contains_any(s, CUE_OBJECTION)).cloned().collect(), 5),
        "followUps": cap_list(sentences.iter().filter(|s| contains_any(s, CUE_FOLLOWUP)).cloned().collect(), 5),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heuristic_summarizes_without_model() {
        let transcript = "Hi Priya, thanks for joining. We are looking for a three phase meter for our distribution points.\n\
            We decided to run a pilot in two districts. We will send the quote by Friday.\n\
            One concern is the installation cost, but the built-in CTs help. Please follow up with the finance team next week.";
        let value = summarize_heuristic(transcript);
        assert!(value["summary"].as_str().unwrap_or("").chars().count() > 30);
        assert!(!value["actionItems"].as_array().unwrap().is_empty());
        assert!(!value["decisions"].as_array().unwrap().is_empty());
        assert!(!value["objections"].as_array().unwrap().is_empty());
        assert!(!value["followUps"].as_array().unwrap().is_empty());
        assert!(!value["customerRequirements"].as_array().unwrap().is_empty());
    }

    #[test]
    fn heuristic_handles_empty() {
        let value = summarize_heuristic("");
        assert!(value["summary"].as_str().is_some());
    }
}
