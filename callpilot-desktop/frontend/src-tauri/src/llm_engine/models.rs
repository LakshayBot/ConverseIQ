//! GGUF summarization model catalog + chat templates.
//!
//! Ported from the Meetily reference architecture: models are GGUF files
//! downloaded in-app into `app_data_dir/models/summary/` and run through the
//! bundled llama-helper (llama.cpp) sidecar. Each model defines its own
//! recommended sampling and chat template.

use serde::{Deserialize, Serialize};

/// Sampling parameters sent to llama-helper.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SamplingParams {
    pub temperature: f32,
    pub top_k: i32,
    pub top_p: f32,
    pub presence_penalty: f32,
    pub frequency_penalty: f32,
    pub repeat_penalty: f32,
    pub penalty_last_n: i32,
    pub stop_tokens: Vec<String>,
}

impl SamplingParams {
    /// Summary-tuned preset (mild temperature + repetition control).
    pub fn summary_preset(stop_tokens: Vec<String>) -> Self {
        Self {
            temperature: 0.5,
            top_k: 20,
            top_p: 0.8,
            presence_penalty: 0.3,
            frequency_penalty: 0.0,
            repeat_penalty: 1.05,
            penalty_last_n: 256,
            stop_tokens,
        }
    }
}

/// A downloadable GGUF summarization model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryModelDef {
    /// Stable id used for selection + persistence (e.g. "qwen3.5-2b-q4").
    pub id: &'static str,
    /// Display name for the UI.
    pub name: &'static str,
    /// GGUF file name on disk.
    pub gguf_file: &'static str,
    /// Chat template id ("gemma3" | "qwen3.5_nonthinking").
    pub template: &'static str,
    pub download_url: &'static str,
    /// Approximate file size in MiB.
    pub size_mb: u64,
    /// Context window in tokens (used for chunking).
    pub context_size: u32,
    pub layer_count: u32,
    pub sampling: SamplingParams,
    pub description: &'static str,
}

const fn model(
    id: &'static str,
    name: &'static str,
    gguf_file: &'static str,
    template: &'static str,
    download_url: &'static str,
    size_mb: u64,
    context_size: u32,
    layer_count: u32,
    sampling: SamplingParams,
    description: &'static str,
) -> SummaryModelDef {
    SummaryModelDef {
        id,
        name,
        gguf_file,
        template,
        download_url,
        size_mb,
        context_size,
        layer_count,
        sampling,
        description,
    }
}

/// Catalog of bundled GGUF summarization models (real HuggingFace URLs).
pub static SUMMARY_MODEL_CATALOG: std::sync::LazyLock<Vec<SummaryModelDef>> =
    std::sync::LazyLock::new(|| {
        vec![
            model(
                "qwen3.5-2b-q4",
                "Qwen 3.5 2B (Balanced)",
                "Qwen3.5-2B-Q4_K_M.gguf",
                "qwen3.5_nonthinking",
                "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
                1221,
                32768,
                24,
                SamplingParams::summary_preset(vec!["<|im_end|>".to_string()]),
                "Balanced model for local summaries. Good quality with modest hardware requirements.",
            ),
            model(
                "qwen3.5-4b-q4",
                "Qwen 3.5 4B (High quality)",
                "Qwen3.5-4B-Q4_K_M.gguf",
                "qwen3.5_nonthinking",
                "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
                2614,
                32768,
                32,
                SamplingParams::summary_preset(vec!["<|im_end|>".to_string()]),
                "Higher-quality local summaries. Requires more RAM.",
            ),
            model(
                "gemma3-1b-q8",
                "Gemma 3 1B (Fast)",
                "gemma-3-1b-it-Q8_0.gguf",
                "gemma3",
                "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q8_0.gguf",
                1019,
                32768,
                26,
                SamplingParams::summary_preset(vec!["<end_of_turn>".to_string()]),
                "Fastest model. Runs on any hardware with ~1GB RAM.",
            ),
            model(
                "gemma3-4b-q4",
                "Gemma 3 4B (Balanced)",
                "gemma-3-4b-it-Q4_K_M.gguf",
                "gemma3",
                "https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf",
                2374,
                32768,
                35,
                SamplingParams::summary_preset(vec!["<end_of_turn>".to_string()]),
                "Balanced Gemma model. Great quality/speed trade-off.",
            ),
        ]
    });

pub fn get_model_by_id(id: &str) -> Option<&'static SummaryModelDef> {
    SUMMARY_MODEL_CATALOG.iter().find(|m| m.id == id)
}

// ============================================================================
// Chat templates
// ============================================================================

/// Gemma 3 instruct template.
pub const GEMMA3_TEMPLATE: &str = "\
<start_of_turn>user
{system_prompt}<end_of_turn>
<start_of_turn>user
{user_prompt}<end_of_turn>
<start_of_turn>model
";

/// Qwen 3.5 non-thinking template (starts the assistant turn with an empty
/// think block so generation begins in direct-response mode).
pub const QWEN35_NONTHINKING_TEMPLATE: &str = "\
<|im_start|>system
{system_prompt}<|im_end|>
<|im_start|>user
{user_prompt}<|im_end|>
<|im_start|>assistant
<think>

</think>

";

fn escape_user_prompt_control_markers(user_prompt: &str) -> String {
    user_prompt
        .replace("<|im_start|>", "< |im_start| >")
        .replace("<|im_end|>", "< |im_end| >")
        .replace("<start_of_turn>", "< start_of_turn >")
        .replace("<end_of_turn>", "< end_of_turn >")
        .replace("<think>", "< think >")
        .replace("</think>", "< /think >")
}

/// Format a prompt using the model's chat template.
pub fn format_prompt(template: &str, system_prompt: &str, user_prompt: &str) -> String {
    let template_str = match template {
        "gemma3" => GEMMA3_TEMPLATE,
        _ => QWEN35_NONTHINKING_TEMPLATE,
    };
    template_str
        .replace("{system_prompt}", system_prompt)
        .replace("{user_prompt}", &escape_user_prompt_control_markers(user_prompt))
}

/// Default max tokens for local summary generation.
pub const DEFAULT_MAX_TOKENS: i32 = 4096;

/// How long a generation may take before the client gives up.
pub const GENERATION_TIMEOUT_SECS: u64 = 900;
