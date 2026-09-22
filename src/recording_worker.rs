//! Batch transcription worker for pre-recorded audio files.
//!
//! This module implements the "record-then-transcribe" pipeline:
//! 1. Read a WAV file (16 kHz, mono, i16) into memory.
//! 2. Split into overlapping windows (default: 5-minute windows with 5s overlap)
//!    to keep peak RAM under control even for very long recordings.
//! 3. For each window: run Silero VAD to find speech segments, then Whisper STT.
//! 4. After all windows are transcribed, collect all speech segments into one
//!    big PCM buffer and run Pyannote diarization **once** over the entire audio.
//!    This "global batch diarization" gives the most consistent speaker IDs across
//!    the whole meeting — e.g. speaker_1 stays speaker_1 from minute 0 to 60.
//! 5. Merge STT segments with diarization segments and emit the final transcript.
//!
//! Progress events (`whisper-recording-transcribe-progress`) are emitted after
//! each window so the frontend can show a progress bar.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use log::{error, info, warn};
use tauri::{AppHandle, Emitter, Runtime};

use crate::asr_backend::AsrBackend;
use crate::error::{Result, WhisperError};
use crate::state::RecordingTranscribeProgressPayload;

// ── Constants ────────────────────────────────────────────────────────────────

/// Sample rate expected throughout the pipeline.
const SAMPLE_RATE: u32 = 16_000;

/// Window size in seconds for chunked STT inference.
const WINDOW_SECS: usize = 300; // 5 minutes
/// Overlap between consecutive windows to avoid cutting words at boundaries.
const OVERLAP_SECS: usize = 5;

// ── Public output types ───────────────────────────────────────────────────────

/// A single segment in the final recording transcript.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecordingTranscriptSegment {
    /// Speaker label, e.g. "speaker_1", "speaker_2", …
    pub speaker_id: String,
    pub text: String,
    /// Offset from the start of the recording, in milliseconds.
    pub start_ms: i64,
    pub end_ms: i64,
}

/// The complete transcript returned by `transcribe_recording`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecordingTranscript {
    pub segments: Vec<RecordingTranscriptSegment>,
    /// Total duration of the source recording in milliseconds.
    pub duration_ms: u64,
    /// Wall-clock time spent in transcription, in milliseconds.
    pub processing_time_ms: u64,
    /// Number of distinct speakers detected.
    pub num_speakers: usize,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// A raw STT segment with a global time offset already applied.
#[derive(Debug, Clone)]
struct RawSegment {
    text: String,
    start_ms: i64,
    end_ms: i64,
}

// ── Main entry point ──────────────────────────────────────────────────────────

/// Read `wav_path`, transcribe with Whisper + optionally diarize, return transcript.
///
/// This function is **synchronous** and is intended to be called from a dedicated
/// `tokio::task::spawn_blocking` block so it doesn't block the async runtime.
pub fn run_batch_transcription<R: Runtime>(
    wav_path: &Path,
    language: Option<&str>,
    backend: Arc<Mutex<Option<Box<dyn AsrBackend>>>>,
    #[cfg(feature = "diarization")]
    diarization: Arc<Mutex<Option<crate::diarization::pipeline::DiarizationPipeline>>>,
    vad_model_path: Option<String>,
    app_handle: &AppHandle<R>,
) -> Result<RecordingTranscript> {
    let wall_start = Instant::now();
    info!("recording_worker: starting batch transcription of {:?}", wav_path);

    // ── 1. Load WAV file ──────────────────────────────────────────────────────
    let all_samples = read_wav_as_f32(wav_path)?;
    let total_samples = all_samples.len();
    let duration_ms = (total_samples as f64 / SAMPLE_RATE as f64 * 1000.0) as u64;
    info!(
        "recording_worker: loaded {} samples ({:.1}s)",
        total_samples,
        duration_ms as f64 / 1000.0
    );

    if total_samples == 0 {
        return Ok(RecordingTranscript {
            segments: vec![],
            duration_ms: 0,
            processing_time_ms: 0,
            num_speakers: 0,
        });
    }

    // ── 2. Windowed Whisper STT ───────────────────────────────────────────────
    let window_samples = WINDOW_SECS * SAMPLE_RATE as usize;
    let overlap_samples = OVERLAP_SECS * SAMPLE_RATE as usize;
    let step_samples = window_samples - overlap_samples;

    let mut raw_segments: Vec<RawSegment> = Vec::new();
    let mut window_start = 0usize;
    let mut window_idx = 0usize;

    // Pre-initialize VAD for speech filtering within each window.
    // If VAD is unavailable we still transcribe the full window (slower but correct).
    let use_vad = vad_model_path.is_some();

    while window_start < total_samples {
        let window_end = (window_start + window_samples).min(total_samples);
        let window = &all_samples[window_start..window_end];

        let offset_ms = (window_start as f64 / SAMPLE_RATE as f64 * 1000.0) as i64;

        // Run VAD to extract speech utterances from this window.
        let utterances = extract_speech_utterances(window, &vad_model_path, use_vad);

        for utterance in &utterances {
            let uttr_samples = &window[utterance.start..utterance.end];
            let uttr_offset_ms = offset_ms + (utterance.start as f64 / SAMPLE_RATE as f64 * 1000.0) as i64;

            let segs = {
                let mut guard = backend.lock().expect("backend mutex poisoned");
                let b = match guard.as_mut() {
                    Some(b) => b,
                    None => {
                        error!("recording_worker: no backend loaded");
                        return Err(WhisperError::ModelNotLoaded);
                    }
                };
                match b.transcribe_advanced(
                    uttr_samples,
                    language,
                    crate::asr_backend::DecodingStrategy::BeamSearch { beam_size: 3 },
                    None,
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        warn!("recording_worker: whisper failed on window {window_idx}: {e}");
                        vec![]
                    }
                }
            };

            for seg in segs {
                if seg.text.trim().is_empty() {
                    continue;
                }
                raw_segments.push(RawSegment {
                    text: seg.text.trim().to_string(),
                    start_ms: uttr_offset_ms + seg.start_ms,
                    end_ms: uttr_offset_ms + seg.end_ms,
                });
            }
        }

        // Emit progress event
        let processed_ms = (window_end as f64 / SAMPLE_RATE as f64 * 1000.0) as u64;
        let percent = (processed_ms as f64 / duration_ms as f64 * 100.0).min(100.0);
        let _ = app_handle.emit(
            "whisper-recording-transcribe-progress",
            &RecordingTranscribeProgressPayload {
                processed_ms,
                total_ms: duration_ms,
                percent,
            },
        );

        window_idx += 1;
        if window_end == total_samples {
            break;
        }
        window_start += step_samples;
    }

    info!(
        "recording_worker: STT done — {} raw segments from {} windows",
        raw_segments.len(),
        window_idx
    );

    // If we have no text at all, return early.
    if raw_segments.is_empty() {
        return Ok(RecordingTranscript {
            segments: vec![],
            duration_ms,
            processing_time_ms: wall_start.elapsed().as_millis() as u64,
            num_speakers: 0,
        });
    }

    // ── 3. Global batch diarization ───────────────────────────────────────────
    // Run Pyannote over the *entire* audio in one shot for maximum consistency.
    #[cfg(feature = "diarization")]
    let final_segments = {
        let mut diar_guard = diarization.lock().expect("diarization mutex poisoned");
        if let Some(pipeline) = diar_guard.as_mut() {
            // Pre-seed with existing persistent profiles if memory is empty
            use tauri::Manager;
            if pipeline.get_known_speakers().is_empty() {
                if let Ok(app_data) = app_handle.path().app_data_dir() {
                    let profiles_path = app_data.join("voice_profiles.json");
                    if profiles_path.exists() {
                        if let Ok(json) = std::fs::read_to_string(&profiles_path) {
                            if let Ok(disk_profiles) = serde_json::from_str::<Vec<crate::diarization::pipeline::SpeakerProfile>>(&json) {
                                pipeline.set_known_speakers(disk_profiles);
                                info!("recording_worker: loaded persistent voice profiles from disk.");
                            }
                        }
                    }
                }
            }

            let segs = match pipeline.diarize(&all_samples) {
                Ok(speaker_segs) => {
                    info!(
                        "recording_worker: diarization returned {} speaker segments",
                        speaker_segs.len()
                    );
                    merge_stt_with_diarization(&raw_segments, &speaker_segs)
                }
                Err(e) => {
                    warn!("recording_worker: diarization failed ({e}), falling back to no-speaker labels");
                    raw_segments
                        .into_iter()
                        .map(|s| RecordingTranscriptSegment {
                            speaker_id: "speaker_unknown".into(),
                            text: s.text,
                            start_ms: s.start_ms,
                            end_ms: s.end_ms,
                        })
                        .collect()
                }
            };

            // Save learned profiles to disk
            let updated_profiles = pipeline.get_known_speakers();
            if !updated_profiles.is_empty() {
                if let Ok(app_data) = app_handle.path().app_data_dir() {
                    let profiles_path = app_data.join("voice_profiles.json");
                    std::fs::create_dir_all(profiles_path.parent().unwrap()).ok();
                    if let Ok(json) = serde_json::to_string_pretty(&updated_profiles) {
                        let _ = std::fs::write(&profiles_path, json);
                        info!("recording_worker: saved {} persistent voice profiles to disk.", updated_profiles.len());
                    }
                }
            }

            segs
        } else {
            // Diarization not loaded — label everything as speaker_unknown.
            raw_segments
                .into_iter()
                .map(|s| RecordingTranscriptSegment {
                    speaker_id: "speaker_unknown".into(),
                    text: s.text,
                    start_ms: s.start_ms,
                    end_ms: s.end_ms,
                })
                .collect()
        }
    };

    #[cfg(not(feature = "diarization"))]
    let final_segments: Vec<RecordingTranscriptSegment> = raw_segments
        .into_iter()
        .map(|s| RecordingTranscriptSegment {
            speaker_id: "speaker_unknown".into(),
            text: s.text,
            start_ms: s.start_ms,
            end_ms: s.end_ms,
        })
        .collect();

    let num_speakers = {
        let mut ids: Vec<&str> = final_segments.iter().map(|s| s.speaker_id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        ids.len()
    };

    let processing_time_ms = wall_start.elapsed().as_millis() as u64;
    info!(
        "recording_worker: done. {} segments, {} speakers, {:.1}s processing time",
        final_segments.len(),
        num_speakers,
        processing_time_ms as f64 / 1000.0
    );

    Ok(RecordingTranscript {
        segments: final_segments,
        duration_ms,
        processing_time_ms,
        num_speakers,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Read a WAV file and convert samples to f32 in [-1.0, 1.0].
/// Supports i16 and i32 WAV files at 16 kHz mono (resampling is NOT done here;
/// the caller / frontend is responsible for providing 16 kHz mono audio).
fn read_wav_as_f32(path: &Path) -> Result<Vec<f32>> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| WhisperError::InferenceFailed(format!("Cannot open WAV: {e}")))?;

    let spec = reader.spec();
    info!(
        "recording_worker: WAV spec — {}Hz, {} ch, {} bits, {:?}",
        spec.sample_rate, spec.channels, spec.bits_per_sample, spec.sample_format
    );

    // We always record 16 kHz mono i16, but be defensive.
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            match spec.bits_per_sample {
                16 => reader
                    .samples::<i16>()
                    .filter_map(|s| s.ok())
                    .map(|s| s as f32 / i16::MAX as f32)
                    .collect(),
                32 => reader
                    .samples::<i32>()
                    .filter_map(|s| s.ok())
                    .map(|s| s as f32 / i32::MAX as f32)
                    .collect(),
                bits => {
                    return Err(WhisperError::InferenceFailed(format!(
                        "Unsupported WAV bit depth: {bits}"
                    )))
                }
            }
        }
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
    };

    // Downmix stereo → mono if needed (take the average of L+R).
    if spec.channels == 2 {
        Ok(samples
            .chunks_exact(2)
            .map(|pair| (pair[0] + pair[1]) * 0.5)
            .collect())
    } else {
        Ok(samples)
    }
}

/// A speech utterance within a window (sample indices, relative to window start).
struct Utterance {
    start: usize,
    end: usize,
}

/// Extract speech regions from `window` using Silero VAD with sentence-boundary hang-over (~704ms),
/// or return the whole window as a single utterance if VAD is not loaded.
fn extract_speech_utterances(
    window: &[f32],
    vad_model_path: &Option<String>,
    use_vad: bool,
) -> Vec<Utterance> {
    if !use_vad {
        return vec![Utterance { start: 0, end: window.len() }];
    }

    let path = match vad_model_path.as_ref() {
        Some(p) => p,
        None => return vec![Utterance { start: 0, end: window.len() }],
    };

    let mut vad = match crate::vad::SileroVad::new(path) {
        Ok(v) => v,
        Err(e) => {
            warn!("recording_worker: VAD init failed ({e}), using full window");
            return vec![Utterance { start: 0, end: window.len() }];
        }
    };

    const FRAME_SIZE: usize = 512;                    // 32ms at 16kHz
    const THRESHOLD: f32 = 0.40;
    const NEG_THRESHOLD: f32 = 0.25;
    const MIN_SPEECH_FRAMES: usize = 3;              // ~96ms speech onset
    const MIN_SILENCE_FRAMES: usize = 22;            // ~704ms silence (natural sentence boundary)
    const MAX_UTTERANCE_SAMPLES: usize = 16_000 * 20;// 20s max continuous utterance
    const PADDING_FRAMES: usize = 4;                 // 128ms padding around speech

    let mut utterances: Vec<Utterance> = Vec::new();
    let mut is_speaking = false;
    let mut speech_start_frame = 0;
    let mut speech_frames = 0;
    let mut silence_frames = 0;

    let n_frames = window.len() / FRAME_SIZE;
    for i in 0..n_frames {
        let frame = &window[i * FRAME_SIZE..(i + 1) * FRAME_SIZE];
        let sum_sq: f32 = frame.iter().map(|&x| x * x).sum();
        let rms = (sum_sq / FRAME_SIZE as f32).sqrt();

        let prob = if rms < 0.003 {
            0.05
        } else {
            vad.predict(frame).unwrap_or(0.1)
        };

        if prob >= THRESHOLD {
            speech_frames += 1;
            silence_frames = 0;

            if !is_speaking && speech_frames >= MIN_SPEECH_FRAMES {
                is_speaking = true;
                // Include pre-speech padding so onset consonants are never clipped
                speech_start_frame = i.saturating_sub(speech_frames + PADDING_FRAMES);
            }
        } else if prob < NEG_THRESHOLD {
            silence_frames += 1;
            speech_frames = 0;

            if is_speaking && silence_frames >= MIN_SILENCE_FRAMES {
                is_speaking = false;
                // Include post-speech padding (up to end of speech, not full trailing silence)
                let speech_end_frame = (i.saturating_sub(silence_frames) + PADDING_FRAMES).min(n_frames);
                let start = speech_start_frame * FRAME_SIZE;
                let end = (speech_end_frame * FRAME_SIZE).min(window.len());

                // Utterance must be at least 400ms
                if end.saturating_sub(start) >= 6400 {
                    utterances.push(Utterance { start, end });
                }
            }
        } else {
            // Ambiguous prob between 0.25 and 0.40: keep previous state
            if is_speaking {
                silence_frames = 0;
            }
        }

        // Split long continuous speech if utterance exceeds 20 seconds
        if is_speaking {
            let current_len = (i - speech_start_frame) * FRAME_SIZE;
            if current_len >= MAX_UTTERANCE_SAMPLES {
                let start = speech_start_frame * FRAME_SIZE;
                let end = ((i + PADDING_FRAMES).min(n_frames) * FRAME_SIZE).min(window.len());
                if end > start {
                    utterances.push(Utterance { start, end });
                }
                speech_start_frame = i;
                silence_frames = 0;
            }
        }
    }

    // Flush last utterance if speaking at the end of the window
    if is_speaking {
        let start = speech_start_frame * FRAME_SIZE;
        let end = window.len();
        if end.saturating_sub(start) >= 6400 {
            utterances.push(Utterance { start, end });
        }
    }

    if utterances.is_empty() {
        // Fallback: full window
        vec![Utterance { start: 0, end: window.len() }]
    } else {
        utterances
    }
}

// ── STT + Diarization merger ──────────────────────────────────────────────────

/// Merge Whisper text segments with Pyannote speaker segments.
///
/// Strategy: for each STT segment, find the diarization speaker segment whose
/// time range overlaps the most with the STT segment's midpoint.
#[cfg(feature = "diarization")]
fn merge_stt_with_diarization(
    stt: &[RawSegment],
    diar: &[crate::diarization::pipeline::SpeakerSegment],
) -> Vec<RecordingTranscriptSegment> {
    let mut segments: Vec<RecordingTranscriptSegment> = stt.iter()
        .map(|seg| {
            let mid_ms = (seg.start_ms + seg.end_ms) / 2;

            // Find the diarization segment that contains (or is closest to) the midpoint.
            let speaker_id = diar
                .iter()
                .filter(|d| d.start_ms <= mid_ms && d.end_ms >= mid_ms)
                .min_by_key(|d| {
                    // Prefer segments with the most overlap.
                    let overlap_start = d.start_ms.max(seg.start_ms);
                    let overlap_end = d.end_ms.min(seg.end_ms);
                    // Negate overlap so min_by_key picks the most overlapping.
                    -(overlap_end - overlap_start).max(0)
                })
                .or_else(|| {
                    // No exact overlap — pick closest by distance.
                    diar.iter().min_by_key(|d| {
                        (d.start_ms - mid_ms).abs().min((d.end_ms - mid_ms).abs())
                    })
                })
                .map(|d| format!("speaker_{}", d.speaker_id))
                .unwrap_or_else(|| "speaker_unknown".to_string());

            RecordingTranscriptSegment {
                speaker_id,
                text: seg.text.clone(),
                start_ms: seg.start_ms,
                end_ms: seg.end_ms,
            }
        })
        .collect();

    if segments.len() < 2 {
        return segments;
    }

    // Glitch smoothing pass: absorb isolated 1-word or sub-400ms turns surrounded by same speaker
    if segments.len() >= 3 {
        for i in 1..(segments.len() - 1) {
            let prev_spk = segments[i - 1].speaker_id.clone();
            let next_spk = segments[i + 1].speaker_id.clone();
            let curr_spk = segments[i].speaker_id.clone();

            if prev_spk == next_spk && curr_spk != prev_spk {
                let duration = segments[i].end_ms - segments[i].start_ms;
                let word_count = segments[i].text.split_whitespace().count();
                let gap_prev = segments[i].start_ms - segments[i - 1].end_ms;
                let gap_next = segments[i + 1].start_ms - segments[i].end_ms;

                if (word_count <= 1 || duration < 400) && gap_prev < 600 && gap_next < 600 {
                    segments[i].speaker_id = prev_spk;
                }
            }
        }
    }

    // Consolidation pass: merge consecutive segments of same speaker if gap <= 1500ms
    let mut consolidated: Vec<RecordingTranscriptSegment> = Vec::with_capacity(segments.len());
    for seg in segments {
        if let Some(last) = consolidated.last_mut() {
            let gap = seg.start_ms - last.end_ms;
            if last.speaker_id == seg.speaker_id && gap <= 1500 {
                let clean_last = crate::asr_backend::clean_whisper_text(&last.text);
                let clean_seg = crate::asr_backend::clean_whisper_text(&seg.text);
                if !clean_last.is_empty() && !clean_seg.is_empty() {
                    last.text = format!("{clean_last} {clean_seg}");
                } else if !clean_seg.is_empty() {
                    last.text = clean_seg;
                }
                last.end_ms = last.end_ms.max(seg.end_ms);
                continue;
            }
        }
        consolidated.push(seg);
    }

    consolidated
}
