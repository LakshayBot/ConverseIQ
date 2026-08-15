//! Speaker diarization model catalog (two tiers) + tuning defaults.
//!
//! Models are ONNX files from the official sherpa-onnx releases
//! (k2-fsa/sherpa-onnx GitHub release tags). Each tier needs a speaker
//! embedding model (for both offline clustering and live matching) and the
//! pyannote segmentation model (speech-region segmentation, only used
//! offline - live mode reuses the app's own Silero VAD segments). The
//! segmentation model ships as a tar.bz2 (both fp32 + int8 inside); the
//! tier picks which contained file to use.

use serde::Serialize;

/// One downloadable speaker-identification model tier.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarModelDef {
    /// Stable id used for selection + persistence ("fast" | "accurate").
    pub id: &'static str,
    /// Display name for the UI.
    pub name: &'static str,
    pub description: &'static str,
    /// Speaker embedding ONNX file name on disk.
    pub embedding_file: &'static str,
    pub embedding_url: &'static str,
    /// Approximate embedding model size in MiB.
    pub embedding_size_mb: u64,
    /// pyannote segmentation tar.bz2 (shared by both tiers, per-tier copies).
    pub segmentation_tar_url: &'static str,
    pub segmentation_tar_size_mb: u64,
    /// Which file inside the tar this tier uses.
    pub segmentation_file: &'static str,
    /// Expected extracted segmentation file size in MiB (validation floor).
    pub segmentation_size_mb: u64,
    /// Cluster threshold for offline diarization (higher = fewer speakers).
    pub cluster_threshold: f32,
    /// Cosine similarity threshold for live speaker matching (higher = fewer
    /// new speakers, more splits; lower = more merging).
    pub similarity_threshold: f32,
    /// Minimum cosine similarity before a live segment is considered a match.
    pub similarity_floor: f32,
}

const fn model(
    id: &'static str,
    name: &'static str,
    description: &'static str,
    embedding_file: &'static str,
    embedding_url: &'static str,
    embedding_size_mb: u64,
    segmentation_file: &'static str,
    segmentation_size_mb: u64,
    cluster_threshold: f32,
    similarity_threshold: f32,
    similarity_floor: f32,
) -> DiarModelDef {
    DiarModelDef {
        id,
        name,
        description,
        embedding_file,
        embedding_url,
        embedding_size_mb,
        segmentation_tar_url: SEGMENTATION_TAR_URL,
        segmentation_tar_size_mb: SEGMENTATION_TAR_SIZE_MB,
        segmentation_file,
        segmentation_size_mb,
        cluster_threshold,
        similarity_threshold,
        similarity_floor,
    }
}

pub const SEGMENTATION_TAR_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";
pub const SEGMENTATION_TAR_SIZE_MB: u64 = 7;

pub static DIAR_MODEL_CATALOG: std::sync::LazyLock<Vec<DiarModelDef>> =
    std::sync::LazyLock::new(|| {
        vec![
            model(
                "fast",
                "Fast (Best for laptops)",
                "Lower resource usage. Best for most laptops and meetings with a few speakers.",
                "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
                37,
                "model.int8.onnx",
                // int8 segmentation is 1.47 MB - the floor must stay under it
                // (≥90% validation).
                1,
                0.5,
                0.82,
                0.70,
            ),
            model(
                "accurate",
                "Accurate (Better separation)",
                "Higher resource usage. Better speaker separation for long or crowded meetings.",
                "nemo_en_titanet_large.onnx",
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_large.onnx",
                96,
                "model.onnx",
                6,
                0.5,
                0.80,
                0.68,
            ),
        ]
    });

pub fn get_model_by_id(id: &str) -> Option<&'static DiarModelDef> {
    DIAR_MODEL_CATALOG.iter().find(|m| m.id == id)
}

/// Default live-mode config used when none is persisted.
pub fn default_diar_config() -> crate::speaker_engine::DiarConfig {
    crate::speaker_engine::DiarConfig::default()
}
