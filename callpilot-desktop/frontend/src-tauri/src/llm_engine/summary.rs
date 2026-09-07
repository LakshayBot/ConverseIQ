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
///
/// Action items are STRUCTURED objects (title/assignee/priority/source) so
/// the Actions tab can offer completion state, reassignment and "Add Today".
/// `followUps` no longer exists as a top-level key - follow-ups are folded
/// into `actionItems` with `source: "follow_up"`.
pub const SUMMARY_SCHEMA_PROMPT: &str = r#"Return a JSON object with EXACTLY these keys and no others:
{
  "summary": "3-5 sentence executive summary of the meeting",
  "keyPoints": ["key discussion point", ...],
  "decisions": ["decision made", ...],
  "actionItems": [
    {
      "title": "string - the task, concise and actionable",
      "assignee": "you | team_member | unassigned",
      "priority": "high | medium | low",
      "source": "action_item | follow_up"
    }
  ],
  "customerRequirements": ["requirement or need the customer expressed", ...],
  "objections": ["objection, concern, or pain point raised", ...]
}
Action item guidance:
- assignee reflects who was given the task in the transcript: "you" when the rep (Speaker 1) was assigned it or took it on, "team_member" when a named colleague or team was assigned it, "unassigned" when it is unclear or the buyer must act.
- priority: "high" when the task is deal-critical or time-bound, "medium" for normal next steps, "low" for nice-to-haves.
- source: "action_item" for a task the model would classify as an action item, "follow_up" for a commitment to follow up later (send info, schedule next call, check back).
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

/// Assignee of an action item, matching the schema enum exposed to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionItemAssignee {
    You,
    TeamMember,
    Unassigned,
}

/// Priority of an action item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionItemPriority {
    High,
    Medium,
    Low,
}

/// Whether the item was an action item or a folded-in follow-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionItemSource {
    ActionItem,
    FollowUp,
}

/// A structured action item as produced by the new summary schema.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ActionItem {
    pub title: String,
    pub assignee: ActionItemAssignee,
    pub priority: ActionItemPriority,
    pub source: ActionItemSource,
}

/// Normalises `actionItems` in a parsed summary value in place.
///
/// Structured objects are validated against [`ActionItem`] - any entry
/// missing a required field (e.g. the model omitted `priority`) is DROPPED
/// rather than failing the whole summary, mirroring the extract_json
/// fallback philosophy: a partially-usable summary beats none. Legacy
/// string-array items (older models / saved summaries) are left untouched -
/// the UI handles them as read-only text.
pub fn normalize_action_items(summary: &mut serde_json::Value) {
    let Some(items) = summary.get_mut("actionItems").and_then(|v| v.as_array_mut()) else {
        return;
    };

    let mut normalized = Vec::with_capacity(items.len());
    let mut dropped = 0usize;
    for item in items.drain(..) {
        if item.is_string() {
            // Legacy plain-string item - keep as-is.
            normalized.push(item);
            continue;
        }
        match serde_json::from_value::<ActionItem>(item.clone()) {
            Ok(parsed) => normalized.push(item),
            Err(_) => dropped += 1,
        }
    }

    if dropped > 0 {
        log::warn!("summary actionItems: dropped {dropped} malformed entr(y/ies)");
    }
    summary["actionItems"] = serde_json::Value::Array(normalized);
}

/// Focused system prompt for action-item-ONLY extraction. Never re-summarises -
/// the model returns a bare JSON array of structured items (or []).
pub const ACTION_ITEMS_SCHEMA_PROMPT: &str = r#"You are extracting action items from a sales call transcript.
Return ONLY a JSON array of action items. Each item must have:
  "title": string - the task, concise and actionable,
  "assignee": "you" | "team_member" | "unassigned",
  "priority": "high" | "medium" | "low",
  "source": "action_item" | "follow_up"
Assignee "you" means the sales rep (first speaker); "team_member" means a mentioned colleague or team was assigned the task; "unassigned" when it is unclear or the buyer must act.
Return [] if there is nothing actionable. Return only valid JSON, no explanation."#;

/// Extracts the first balanced JSON ARRAY from a model response, tolerating
/// markdown fences and surrounding prose. Falls back to an `actionItems`
/// array nested in an object for models that wrap the array anyway.
fn extract_json_array(raw: &str) -> Option<Vec<serde_json::Value>> {
    let text = raw.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text);
    let text = text.strip_suffix("```").unwrap_or(text).trim();

    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end > start {
        if let Ok(array) = serde_json::from_str::<serde_json::Value>(&text[start..=end]) {
            if let Some(items) = array.as_array() {
                return Some(items.clone());
            }
        }
    }

    // Model wrapped the array in an object ({"actionItems": [...]}) - reuse
    // the object extractor and pull the key out.
    let obj = extract_json(text)?;
    obj.get("actionItems")?.as_array().cloned()
}

/// Deduplicates extracted items by title similarity. Simple lowercased
/// substring containment is enough: chunked extraction frequently repeats
/// the same commitment across chunk boundaries, and one of
/// "send the accuracy report" / "send the accuracy report to the buyer"
/// is redundant in the UI.
fn dedupe_action_items(mut items: Vec<ActionItem>) -> Vec<ActionItem> {
    items.dedup_by(|a, b| {
        let ta = a.title.trim().to_lowercase();
        let tb = b.title.trim().to_lowercase();
        !ta.is_empty() && !tb.is_empty() && (ta.contains(&tb) || tb.contains(&ta))
    });
    items
}

/// Extracts ONLY the action items from a transcript - the focused companion
/// to [`summarize_meeting`] for pre-existing meetings that predate the
/// structured schema. Same injected-`llm` architecture (the caller wires the
/// llama-helper sidecar in commands.rs), same chunk budget, and a
/// dedupe-by-title pass across chunks instead of an LLM synthesis pass.
///
/// `emit` reports ("extracting" | "deduplicating", percent).
pub async fn extract_action_items_only<F, E>(
    transcript: &str,
    mut llm: F,
    emit: E,
) -> Result<Vec<ActionItem>, String>
where
    F: FnMut(String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>>,
    E: Fn(String, u8) + Send + 'static,
{
    let cleaned = transcript.trim();
    if cleaned.is_empty() {
        return Err("The meeting has no transcript to extract action items from.".to_string());
    }

    let chunks = split_chunks(cleaned, CHUNK_BUDGET_CHARS);
    let n = chunks.len();

    let mut all: Vec<ActionItem> = Vec::new();
    for (i, chunk) in chunks.iter().enumerate() {
        emit("extracting".to_string(), (i as f64 / n as f64 * 90.0) as u8);
        let prompt = format!(
            "{ACTION_ITEMS_SCHEMA_PROMPT}\n\nTranscript segment:\n{chunk}\n\nReturn ONLY the JSON array."
        );
        let raw = llm(prompt).await?;
        let Some(values) = extract_json_array(&raw) else {
            return Err("The model returned an unreadable action item list.".to_string());
        };
        for value in values {
            // Malformed entries are dropped, not fatal - same fallback
            // philosophy as normalize_action_items.
            if let Ok(item) = serde_json::from_value::<ActionItem>(value) {
                all.push(item);
            }
        }
    }

    emit("deduplicating".to_string(), 95);
    Ok(dedupe_action_items(all))
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
        let mut value = extract_json(&raw)
            .ok_or_else(|| "The model returned an unreadable summary.".to_string())?;
        normalize_action_items(&mut value);
        return Ok(value);
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
    let mut value = extract_json(&raw)
        .ok_or_else(|| "The model returned an unreadable final summary.".to_string())?;
    normalize_action_items(&mut value);
    Ok(value)
}

#[cfg(test)]
mod action_item_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_action_item_schema_parses_structured() {
        let mut summary = json!({
            "summary": "Discussed accuracy and pricing.",
            "actionItems": [
                {
                    "title": "Send the accuracy benchmark report",
                    "assignee": "you",
                    "priority": "high",
                    "source": "action_item"
                },
                {
                    "title": "Schedule the follow-up call for next week",
                    "assignee": "team_member",
                    "priority": "medium",
                    "source": "follow_up"
                }
            ]
        });

        normalize_action_items(&mut summary);

        let items = summary["actionItems"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        let parsed: Vec<ActionItem> = items
            .iter()
            .map(|v| serde_json::from_value::<ActionItem>(v.clone()).expect("item should deserialise"))
            .collect();
        assert_eq!(parsed[0].title, "Send the accuracy benchmark report");
        assert_eq!(parsed[0].assignee, ActionItemAssignee::You);
        assert_eq!(parsed[0].priority, ActionItemPriority::High);
        assert_eq!(parsed[0].source, ActionItemSource::ActionItem);
        assert_eq!(parsed[1].assignee, ActionItemAssignee::TeamMember);
        assert_eq!(parsed[1].priority, ActionItemPriority::Medium);
        assert_eq!(parsed[1].source, ActionItemSource::FollowUp);
    }

    #[test]
    fn test_action_item_schema_rejects_missing_priority() {
        let mut summary = json!({
            "summary": "Discussed next steps.",
            "actionItems": [
                {
                    "title": "Task with no priority",
                    "assignee": "unassigned",
                    "source": "action_item"
                },
                {
                    "title": "Valid task",
                    "assignee": "you",
                    "priority": "low",
                    "source": "follow_up"
                }
            ]
        });

        normalize_action_items(&mut summary);

        // Graceful fallback: the malformed entry is dropped, the valid one
        // survives, and the overall summary still parses.
        let items = summary["actionItems"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        let parsed: ActionItem =
            serde_json::from_value(items[0].clone()).expect("surviving item should deserialise");
        assert_eq!(parsed.title, "Valid task");
    }

    #[test]
    fn normalize_keeps_legacy_string_items_untouched() {
        let mut summary = json!({
            "summary": "Legacy summary.",
            "actionItems": ["Send the deck", "Follow up with procurement"]
        });

        normalize_action_items(&mut summary);

        let items = summary["actionItems"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|v| v.is_string()));
    }

    #[tokio::test]
    async fn test_extract_action_items_only_parses_and_dedupes() {
        // Two chunks: the second repeats the first item with extra words
        // (substring match) plus a malformed entry that must be dropped.
        let responses: Vec<&str> = vec![
            r#"[{"title":"Send the accuracy report","assignee":"you","priority":"high","source":"action_item"}]"#,
            r#"```json
[{"title":"Send the accuracy report to the buyer","assignee":"you","priority":"high","source":"action_item"},{"title":"Schedule follow-up","assignee":"team_member","priority":"medium","source":"follow_up"},{"title":"broken item","assignee":"you"}]
```"#,
        ];
        let mut calls = 0usize;
        let llm = move |_prompt: String| {
            let raw = responses[calls.min(responses.len() - 1)].to_string();
            calls += 1;
            Box::pin(async move { Ok::<String, String>(raw) })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        };

        // Two chunks, each under the budget but forced by explicit content
        // length: build a transcript of two distinct segments.
        let seg = "Segment sentence. ".repeat(CHUNK_BUDGET_CHARS / 19);
        let transcript = format!("{seg}\n{seg}");

        let items = extract_action_items_only(&transcript, llm, |_, _| {})
            .await
            .expect("extraction should succeed");

        // Dedupe collapses the repeated title (substring match); the
        // malformed entry (missing priority/source) is dropped.
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Send the accuracy report");
        assert_eq!(items[1].title, "Schedule follow-up");
        assert_eq!(items[1].source, ActionItemSource::FollowUp);
    }

    #[test]
    fn test_extract_json_array_handles_fenced_and_wrapped_output() {
        // Bare fenced array.
        let items = extract_json_array("```json\n[{\"a\":1}]\n```").unwrap();
        assert_eq!(items.len(), 1);
        // Prose + object-wrapped array (models that ignore the bare-array rule).
        let items = extract_json_array("Sure! {\"actionItems\": [{\"a\":1},{\"a\":2}]}").unwrap();
        assert_eq!(items.len(), 2);
        // No array at all.
        assert!(extract_json_array("no json here").is_none());
    }
}
