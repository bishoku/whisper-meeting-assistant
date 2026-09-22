//! Background inference worker with Silero VAD and Dual-Channel separation.
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use log::{error, info, warn};
use tauri::{AppHandle, Emitter, Runtime};

use crate::asr_backend::AsrBackend;
use crate::state::{
    AudioChannel, AudioContext, AudioMessage, DiarizedResultPayload, DiarizedSegmentPayload,
    FinalResultPayload, SegmentPayload,
};

const RECV_TIMEOUT: Duration = Duration::from_millis(50);

pub fn run_worker<R: Runtime>(
    receiver: Receiver<AudioMessage>,
    backend: Arc<Mutex<Option<Box<dyn AsrBackend>>>>,
    app_handle: AppHandle<R>,
    audio_context: Option<AudioContext>,
    #[cfg(feature = "diarization")]
    diarization: Arc<Mutex<Option<crate::diarization::pipeline::DiarizationPipeline>>>,
    vad_model_path: Option<String>,
    recording: Arc<Mutex<Option<crate::state::RecordingSession>>>,
) {
    let latency_profile = match audio_context.as_ref().and_then(|c| c.latency_mode.as_deref()) {
        Some("low_latency") => crate::vad::LatencyProfile::LowLatency,
        _ => crate::vad::LatencyProfile::Balanced,
    };
    let is_record_only = audio_context.as_ref().and_then(|c| c.record_only).unwrap_or(false);
    info!(
        "stt worker: starting (record_only={}, vad_path={:?}, profile={:?})",
        is_record_only, vad_model_path, latency_profile
    );

    // Initialize VAD processors for Mic and System
    let vad_mic_model = vad_model_path
        .as_ref()
        .and_then(|p| crate::vad::SileroVad::new(p).ok());
    let vad_sys_model = vad_model_path
        .as_ref()
        .and_then(|p| crate::vad::SileroVad::new(p).ok());

    let mut proc_mic = crate::vad::VadStreamProcessor::with_profile(vad_mic_model, latency_profile);
    let mut proc_sys = crate::vad::VadStreamProcessor::with_profile(vad_sys_model, latency_profile);

    let stream_start = Instant::now();

    loop {
        match receiver.recv_timeout(RECV_TIMEOUT) {
            Ok(AudioMessage::Chunk { data, channel }) => {
                // If an active disk recording session exists, write samples to the WAV file
                if let Ok(mut rec_guard) = recording.lock() {
                    if let Some(ref mut session) = *rec_guard {
                        for &sample in &data {
                            let s = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            let _ = session.writer.write_sample(s);
                            session.sample_count += 1;
                        }
                    }
                }

                // If record_only mode is requested, skip live VAD and Whisper inference
                if is_record_only {
                    continue;
                }

                let utterances = match channel {
                    AudioChannel::Mic => proc_mic.process_samples(&data),
                    AudioChannel::System => proc_sys.process_samples(&data),
                };

                for utterance in utterances {
                    process_utterance(
                        &backend,
                        &utterance,
                        channel,
                        &app_handle,
                        &audio_context,
                        stream_start,
                        #[cfg(feature = "diarization")]
                        &diarization,
                    );
                }
            }
            Ok(AudioMessage::Stop) => {
                info!("stt worker: received Stop signal");
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                warn!("stt worker: channel disconnected — stopping");
                break;
            }
        }
    }

    // Flush any remaining speech on stream stop (if not record_only)
    if !is_record_only {
        if let Some(utterance) = proc_mic.flush() {
            process_utterance(
                &backend,
                &utterance,
                AudioChannel::Mic,
                &app_handle,
                &audio_context,
                stream_start,
                #[cfg(feature = "diarization")]
                &diarization,
            );
        }
        if let Some(utterance) = proc_sys.flush() {
            process_utterance(
                &backend,
                &utterance,
                AudioChannel::System,
                &app_handle,
                &audio_context,
                stream_start,
                #[cfg(feature = "diarization")]
                &diarization,
            );
        }
    }

    let _ = app_handle.emit("whisper-stream-stopped", ());
    info!("stt worker: stopped");
}

fn process_utterance<R: Runtime>(
    backend: &Arc<Mutex<Option<Box<dyn AsrBackend>>>>,
    samples: &[f32],
    channel: AudioChannel,
    app_handle: &AppHandle<R>,
    audio_context: &Option<AudioContext>,
    stream_start: Instant,
    #[cfg(feature = "diarization")]
    diarization: &Arc<Mutex<Option<crate::diarization::pipeline::DiarizationPipeline>>>,
) {
    let start = Instant::now();
    let language = audio_context.as_ref().and_then(|ctx| ctx.language.as_deref());

    let handle_clone = app_handle.clone();
    let partial_cb = std::sync::Arc::new(move |partial: crate::state::PartialResultPayload| {
        let _ = handle_clone.emit("whisper-partial-result", &partial);
    });

    // Run transcription on the speech utterance using fast Greedy decoding + live partial callback
    let segments = {
        let mut guard = backend.lock().expect("backend mutex poisoned");
        let b = match guard.as_mut() {
            Some(b) => b,
            None => {
                error!("stt worker: no backend loaded");
                return;
            }
        };
        match b.transcribe_advanced(
            samples,
            language,
            crate::asr_backend::DecodingStrategy::Greedy,
            Some(partial_cb),
        ) {
            Ok(segs) => segs,
            Err(e) => {
                error!("stt worker: inference failed: {e}");
                return;
            }
        }
    };

    if segments.is_empty() {
        return;
    }

    // Calculate wall-clock meeting timestamps
    let now_ms = stream_start.elapsed().as_millis() as i64;
    let utterance_duration_ms = (samples.len() as f64 / 16000.0 * 1000.0) as i64;
    let base_start_ms = (now_ms - utterance_duration_ms).max(0);

    let final_segments: Vec<SegmentPayload> = segments
        .iter()
        .map(|s| SegmentPayload {
            text: s.text.trim().to_string(),
            start_ms: base_start_ms + s.start_ms,
            end_ms: base_start_ms + s.end_ms,
        })
        .filter(|s| !s.text.is_empty())
        .collect();

    if final_segments.is_empty() {
        return;
    }

    let elapsed = start.elapsed().as_millis() as u64;

    // Emit standard final result
    let _ = app_handle.emit(
        "whisper-final-result",
        &FinalResultPayload {
            segments: final_segments.clone(),
            processing_time_ms: elapsed,
        },
    );

    // Speaker attribution:
    // If Mic: speaker is 100% "Sen" (You) without running Pyannote
    // If System: run Pyannote diarization if loaded, else "Katılımcı"
    let mut diarized_segments = Vec::new();

    match channel {
        AudioChannel::Mic => {
            for seg in &final_segments {
                diarized_segments.push(DiarizedSegmentPayload {
                    speaker_id: "Sen".to_string(),
                    text: seg.text.clone(),
                    start_ms: seg.start_ms,
                    end_ms: seg.end_ms,
                    channel,
                });
            }
        }
        AudioChannel::System => {
            #[cfg(feature = "diarization")]
            {
                let mut diar_guard = diarization.lock().expect("diarization mutex poisoned");
                if let Some(pipeline) = diar_guard.as_mut() {
                    if let Ok(spk_segs) = pipeline.diarize_with_offset(samples, base_start_ms) {
                        let merged = crate::diarization::merger::merge(&segments, &spk_segs);
                        for m in merged {
                            diarized_segments.push(DiarizedSegmentPayload {
                                speaker_id: m.speaker_id,
                                text: m.text.trim().to_string(),
                                start_ms: base_start_ms + m.start_ms,
                                end_ms: base_start_ms + m.end_ms,
                                channel,
                            });
                        }
                    }
                }
            }

            if diarized_segments.is_empty() {
                for seg in &final_segments {
                    diarized_segments.push(DiarizedSegmentPayload {
                        speaker_id: "Katılımcı".to_string(),
                        text: seg.text.clone(),
                        start_ms: seg.start_ms,
                        end_ms: seg.end_ms,
                        channel,
                    });
                }
            }
        }
    }

    let num_speakers = diarized_segments
        .iter()
        .map(|s| &s.speaker_id)
        .collect::<std::collections::HashSet<_>>()
        .len();

    let d_payload = DiarizedResultPayload {
        segments: diarized_segments,
        processing_time_ms: elapsed,
        num_speakers,
    };
    let _ = app_handle.emit("whisper-diarized-result", &d_payload);
}
