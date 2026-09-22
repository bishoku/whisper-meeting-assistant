use std::path::Path;
use log::info;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::asr_backend::{clean_whisper_text, AsrBackend, DecodingStrategy, SegmentCallback, TranscriptSegment};
use crate::error::{Result, WhisperError};

#[derive(Default)]
pub struct WhisperBackend {
    ctx: Option<WhisperContext>,
    state: Option<whisper_rs::WhisperState>,
}

impl AsrBackend for WhisperBackend {
    fn load(&mut self, model_path: &Path, use_gpu: bool) -> Result<()> {
        info!("whisper backend: loading model from {}", model_path.display());
        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu(use_gpu);
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().unwrap_or_default(),
            ctx_params,
        ).map_err(|e| WhisperError::ModelLoadFailed(format!("{e}")))?;

        let state = ctx.create_state()
            .map_err(|e| WhisperError::ModelLoadFailed(format!("Failed to create state: {e}")))?;

        self.ctx = Some(ctx);
        self.state = Some(state);
        info!("whisper backend: model and persistent state loaded");
        Ok(())
    }

    fn transcribe_advanced(
        &mut self,
        pcm: &[f32],
        language: Option<&str>,
        strategy: DecodingStrategy,
        on_segment: Option<SegmentCallback>,
    ) -> Result<Vec<TranscriptSegment>> {
        let ctx = self.ctx.as_ref().ok_or(WhisperError::ModelNotLoaded)?;
        if self.state.is_none() {
            self.state = Some(ctx.create_state()
                .map_err(|e| WhisperError::InferenceFailed(format!("Failed to create state: {e}")))?);
        }
        let state = self.state.as_mut().unwrap();

        let sampling = match strategy {
            DecodingStrategy::Greedy => SamplingStrategy::Greedy { best_of: 1 },
            DecodingStrategy::BeamSearch { beam_size } => {
                SamplingStrategy::BeamSearch {
                    beam_size: beam_size.max(1) as i32,
                    patience: 1.0,
                }
            }
        };

        let mut params = FullParams::new(sampling);
        params.set_n_threads(num_cpus());
        params.set_translate(false);
        // CRITICAL: set_no_context(true) prevents Whisper from injecting hallucinated
        // leading and trailing ellipsis ("...") across chunk boundaries.
        params.set_no_context(true);
        params.set_single_segment(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_token_timestamps(true);

        // Anti-hallucination thresholds
        params.set_entropy_thold(2.8);
        params.set_logprob_thold(-1.0);
        params.set_no_speech_thold(0.6);

        if let Some(cb) = on_segment {
            params.set_segment_callback_safe(move |data: whisper_rs::SegmentCallbackData| {
                let cleaned = clean_whisper_text(&data.text);
                if !cleaned.is_empty() {
                    cb(crate::state::PartialResultPayload {
                        text: cleaned,
                        segment_index: data.segment,
                        start_ms: data.start_timestamp * 10,
                        end_ms: data.end_timestamp * 10,
                        is_partial: true,
                    });
                }
            });
        }

        if let Some(lang) = language {
            params.set_language(Some(lang));
            // Removed the long initial_prompt that was leaking into outputs.
        }

        state.full(params, pcm)
            .map_err(|e| WhisperError::InferenceFailed(format!("{e}")))?;

        let n_segments = state.full_n_segments();
        let mut segments = Vec::with_capacity(n_segments as usize);
        for i in 0..n_segments {
            if let Some(seg) = state.get_segment(i) {
                let segment_text = seg.to_str_lossy().unwrap_or_default().into_owned();
                let cleaned_text = clean_whisper_text(&segment_text);
                
                // Heuristic hallucination filter
                let lower_text = cleaned_text.to_lowercase();
                if cleaned_text.is_empty() 
                    || lower_text.contains("altyazı mk")
                    || lower_text.contains("tükçe dilbilgisi")
                    || lower_text.contains("türkçe dilbilgisi")
                    || lower_text.contains("amara.org") 
                    || lower_text.contains("altyazı:")
                {
                    continue;
                }

                let n_tokens = seg.n_tokens();
                let mut words = Vec::new();
                for j in 0..n_tokens {
                    if let Some(token) = seg.get_token(j) {
                        let text = token.to_str_lossy().unwrap_or_default().into_owned();
                        let trimmed = text.trim();
                        if trimmed.is_empty()
                            || trimmed == "..."
                            || trimmed == "…"
                            || trimmed == ".."
                            || (trimmed.starts_with('[') && trimmed.ends_with(']'))
                        {
                            continue;
                        }
                        let data = token.token_data();
                        words.push(crate::asr_backend::TranscriptWord {
                            text,
                            start_ms: data.t0 * 10,
                            end_ms: data.t1 * 10,
                        });
                    }
                }
                
                segments.push(TranscriptSegment {
                    text: cleaned_text,
                    start_ms: seg.start_timestamp() * 10,
                    end_ms: seg.end_timestamp() * 10,
                    language: language.map(String::from),
                    words,
                });
            }
        }
        Ok(segments)
    }

    fn name(&self) -> &str {
        "whisper"
    }
}

fn num_cpus() -> i32 {
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    (cpus / 2).max(1) as i32
}
