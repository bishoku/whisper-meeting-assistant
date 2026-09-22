//! Trait definition for pluggable ASR (Automatic Speech Recognition) backends.

use crate::error::Result;
use std::path::Path;

use crate::state::PartialResultPayload;
use std::sync::Arc;

/// A single transcribed word with timestamps.
#[derive(Debug, Clone)]
pub struct TranscriptWord {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// A single transcribed segment with timestamps.
#[derive(Debug, Clone)]
pub struct TranscriptSegment {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub language: Option<String>,
    pub words: Vec<TranscriptWord>,
}

/// Decoding strategy for ASR inference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodingStrategy {
    /// Fast greedy decoding (best_of = 1), optimized for low-latency live streaming.
    Greedy,
    /// High-precision beam search decoding, ideal for offline/batch file transcription.
    BeamSearch { beam_size: usize },
}

impl Default for DecodingStrategy {
    fn default() -> Self {
        Self::Greedy
    }
}

/// Callback type for real-time partial segment emissions during inference.
pub type SegmentCallback = Arc<dyn Fn(PartialResultPayload) + Send + Sync + 'static>;

/// Pluggable backend for speech-to-text inference.
///
/// Implementations must be `Send` so they can be moved into a worker thread.
pub trait AsrBackend: Send {
    /// Load a model from a path. `model_path` is a file for Whisper or a directory for Qwen3-ASR.
    fn load(&mut self, model_path: &Path, use_gpu: bool) -> Result<()>;

    /// Run inference on raw PCM f32 samples (16 kHz, mono).
    /// Default implementation delegates to `transcribe_advanced` using greedy decoding.
    fn transcribe(
        &mut self,
        pcm_16khz_mono: &[f32],
        language: Option<&str>,
    ) -> Result<Vec<TranscriptSegment>> {
        self.transcribe_advanced(pcm_16khz_mono, language, DecodingStrategy::Greedy, None)
    }

    /// Advanced inference with customizable decoding strategy and optional partial callback.
    fn transcribe_advanced(
        &mut self,
        pcm_16khz_mono: &[f32],
        language: Option<&str>,
        strategy: DecodingStrategy,
        on_segment: Option<SegmentCallback>,
    ) -> Result<Vec<TranscriptSegment>>;

    /// Human-readable name of this backend (e.g. "whisper", "qwen3-asr").
    fn name(&self) -> &str;
}

/// Cleans raw ASR output text by stripping hallucinated leading/trailing ellipsis ("...", "…"),
/// bullet points, and normalizing whitespace.
pub fn clean_whisper_text(raw: &str) -> String {
    let mut text = raw.trim();

    // Strip leading ellipsis, punctuation anomalies, and bullets
    while let Some(stripped) = text
        .strip_prefix("...")
        .or_else(|| text.strip_prefix('…'))
        .or_else(|| text.strip_prefix(".."))
        .or_else(|| text.strip_prefix("- "))
        .or_else(|| text.strip_prefix("• "))
    {
        text = stripped.trim_start();
    }

    // Strip trailing ellipsis
    while let Some(stripped) = text
        .strip_suffix("...")
        .or_else(|| text.strip_suffix('…'))
        .or_else(|| text.strip_suffix(".."))
    {
        text = stripped.trim_end();
    }

    text.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_whisper_text() {
        assert_eq!(clean_whisper_text("...şu anda..."), "şu anda");
        assert_eq!(clean_whisper_text("...20 milyonun üzerinde..."), "20 milyonun üzerinde");
        assert_eq!(clean_whisper_text("…Sayın Süleyman Soylu…"), "Sayın Süleyman Soylu");
        assert_eq!(clean_whisper_text("..konuğumuz.."), "konuğumuz");
        assert_eq!(
            clean_whisper_text("...ülke tam kapanıyor. 17 gün boyunca..."),
            "ülke tam kapanıyor. 17 gün boyunca"
        );
        assert_eq!(clean_whisper_text("Normal konuşma metni."), "Normal konuşma metni.");
    }
}
