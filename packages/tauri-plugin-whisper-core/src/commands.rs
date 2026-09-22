//! Tauri commands exposed to the frontend (and to other backend modules).

use std::sync::{mpsc, Arc};

use log::info;
use tauri::{command, AppHandle, Manager, Runtime, State};

use crate::asr_backend::AsrBackend;
use crate::backends;
use crate::error::{Result, WhisperError};
use crate::state::{AudioContext, AudioMessage, StreamHandle, WhisperPluginState, RecordingSession};
use crate::worker;


// ──────────────────────────────────────────────────────────────────────
// load_model
// ──────────────────────────────────────────────────────────────────────

#[command]
pub fn load_model(
    model_path: String,
    use_gpu: bool,
    backend: Option<String>,
    state: State<'_, WhisperPluginState>,
) -> Result<()> {
    let backend_name = backend.as_deref().unwrap_or("whisper");
    info!("stt: loading model with backend '{backend_name}' from {model_path}");

    let mut asr: Box<dyn AsrBackend> = match backend_name {
        #[cfg(feature = "whisper")]
        "whisper" => Box::new(backends::whisper::WhisperBackend::default()),
        other => {
            return Err(WhisperError::ModelLoadFailed(format!("Unknown backend: {other}")));
        }
    };

    asr.load(std::path::Path::new(&model_path), use_gpu)?;

    let mut backend_guard = state.backend.lock().expect("backend mutex poisoned");
    *backend_guard = Some(asr);

    info!("stt: model loaded successfully via '{backend_name}'");
    Ok(())
}

#[cfg(feature = "diarization")]
#[command]
pub fn load_diarization_model<R: tauri::Runtime>(
    model_dir: Option<String>,
    max_speakers: Option<usize>,
    threshold: Option<f32>,
    state: State<'_, WhisperPluginState>,
    app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    let mut guard = state.diarization.lock().expect("diarization mutex poisoned");
    match model_dir {
        Some(dir) if !dir.trim().is_empty() => {
            let max_spk = max_speakers.unwrap_or(8);
            let th = threshold.unwrap_or(0.70);
            use crate::diarization::pipeline::{DiarizationPipeline, SpeakerProfile};
            use std::path::Path;
            use tauri::Manager;
            
            let mut pipeline = DiarizationPipeline::with_threshold(
                Path::new(&dir),
                max_spk,
                th,
            )?;

            // Auto-load profiles from disk
            if let Ok(app_data) = app_handle.path().app_data_dir() {
                let profiles_path = app_data.join("voice_profiles.json");
                if profiles_path.exists() {
                    if let Ok(json) = std::fs::read_to_string(&profiles_path) {
                        if let Ok(profiles) = serde_json::from_str::<Vec<SpeakerProfile>>(&json) {
                            pipeline.set_known_speakers(profiles);
                            info!("stt: loaded persistent voice profiles from disk.");
                        }
                    }
                }
            }

            *guard = Some(pipeline);
            info!("stt: diarization pipeline loaded successfully from '{dir}' (threshold={th})");
        }
        _ => {
            *guard = None;
            info!("stt: diarization pipeline disabled/unloaded");
        }
    }
    Ok(())
}

#[cfg(not(feature = "diarization"))]
#[command]
pub fn load_diarization_model<R: tauri::Runtime>(
    _model_dir: Option<String>,
    _max_speakers: Option<usize>,
    _threshold: Option<f32>,
    _state: State<'_, WhisperPluginState>,
    _app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    Err(WhisperError::ModelLoadFailed("diarization feature not compiled".into()))
}

#[cfg(feature = "diarization")]
#[command]
pub fn set_diarization_threshold(
    threshold: f32,
    state: State<'_, WhisperPluginState>,
) -> Result<()> {
    let mut guard = state.diarization.lock().expect("diarization mutex poisoned");
    if let Some(pipe) = guard.as_mut() {
        pipe.set_threshold(threshold);
        info!("stt: diarization threshold updated to {threshold}");
    }
    Ok(())
}

#[cfg(not(feature = "diarization"))]
#[command]
pub fn set_diarization_threshold(
    _threshold: f32,
    _state: State<'_, WhisperPluginState>,
) -> Result<()> {
    Ok(())
}

#[cfg(feature = "diarization")]
#[command]
pub fn merge_speakers<R: tauri::Runtime>(
    source_speaker: String,
    target_speaker: String,
    state: State<'_, WhisperPluginState>,
    app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    use tauri::Manager;
    let parse_id = |s: &str| -> Option<usize> {
        s.strip_prefix("speaker_")
            .and_then(|num| num.parse::<usize>().ok())
    };
    if let (Some(s_id), Some(t_id)) = (parse_id(&source_speaker), parse_id(&target_speaker)) {
        let mut guard = state.diarization.lock().expect("diarization mutex poisoned");
        if let Some(pipe) = guard.as_mut() {
            pipe.merge_speakers(s_id, t_id);
            log::info!("stt: merged speaker {source_speaker} into {target_speaker}");
            
            // Save to disk immediately
            let profiles = pipe.get_known_speakers();
            if let Ok(app_data) = app_handle.path().app_data_dir() {
                let profiles_path = app_data.join("voice_profiles.json");
                if let Ok(json) = serde_json::to_string_pretty(&profiles) {
                    let _ = std::fs::write(&profiles_path, json);
                }
            }
        }
    }
    Ok(())
}

#[cfg(not(feature = "diarization"))]
#[command]
pub fn merge_speakers<R: tauri::Runtime>(
    _source_speaker: String,
    _target_speaker: String,
    _state: State<'_, WhisperPluginState>,
    _app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// start_stream
// ──────────────────────────────────────────────────────────────────────

#[command]
pub fn start_stream<R: Runtime>(
    context: Option<AudioContext>,
    state: State<'_, WhisperPluginState>,
    app_handle: AppHandle<R>,
) -> Result<()> {
    let mut stream_guard = state.stream.lock().expect("stream mutex poisoned");
    if stream_guard.is_some() {
        return Err(WhisperError::StreamAlreadyActive);
    }
    {
        let backend_guard = state.backend.lock().expect("backend mutex poisoned");
        if backend_guard.is_none() {
            return Err(WhisperError::ModelNotLoaded);
        }
    }
    let (sender, receiver) = mpsc::channel::<AudioMessage>();
    let backend_arc = Arc::clone(&state.backend);
    #[cfg(feature = "diarization")]
    let diarization_arc = {
        use tauri::Manager;
        let mut d_guard = state.diarization.lock().expect("diarization mutex poisoned");
        if let Some(pipe) = d_guard.as_mut() {
            // Preserve existing profiles across sessions.
            // If the active pipeline has no profiles in memory yet, auto-load from disk.
            if pipe.get_known_speakers().is_empty() {
                if let Ok(app_data) = app_handle.path().app_data_dir() {
                    let profiles_path = app_data.join("voice_profiles.json");
                    if profiles_path.exists() {
                        if let Ok(json) = std::fs::read_to_string(&profiles_path) {
                            if let Ok(profiles) = serde_json::from_str::<Vec<crate::diarization::pipeline::SpeakerProfile>>(&json) {
                                pipe.set_known_speakers(profiles);
                                info!("stt: loaded persistent voice profiles on stream start.");
                            }
                        }
                    }
                }
            }
        }
        Arc::clone(&state.diarization)
    };
    let vad_model_path = state.vad_model_path.lock().unwrap().clone();
    let recording_arc = Arc::clone(&state.recording);

    let handle = std::thread::Builder::new()
        .name("stt-worker".into())
        .spawn(move || {
            worker::run_worker(
                receiver, 
                backend_arc, 
                app_handle, 
                context,
                #[cfg(feature = "diarization")]
                diarization_arc,
                vad_model_path,
                recording_arc,
            );
        })
        .map_err(|e| WhisperError::InferenceFailed(format!("Failed to spawn worker: {e}")))?;
    *stream_guard = Some(StreamHandle {
        sender,
        worker: Some(handle),
    });
    info!("stt: stream started");
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// push_audio_chunk
// ──────────────────────────────────────────────────────────────────────

/// Pushes raw PCM f32 samples (16 kHz, mono) into the active stream, tagged with its source channel.
///
/// This command returns immediately — it never blocks the UI thread.
/// The audio data is sent to the background worker via the MPSC channel.
#[command]
pub fn push_audio_chunk(
    pcm_data: Vec<f32>,
    channel: Option<crate::state::AudioChannel>,
    state: State<'_, WhisperPluginState>,
) -> Result<()> {
    let stream_guard = state.stream.lock().expect("stream mutex poisoned");
    let stream = stream_guard.as_ref().ok_or(WhisperError::StreamNotActive)?;

    stream
        .sender
        .send(AudioMessage::Chunk {
            data: pcm_data,
            channel: channel.unwrap_or_default(),
        })
        .map_err(|e| WhisperError::ChannelSendFailed(e.to_string()))?;

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// stop_stream
// ──────────────────────────────────────────────────────────────────────

/// Sends a `Stop` signal to the worker and waits for it to finish.
///
/// After this call, the stream handle is cleared and a new stream can be
/// started.
#[command]
pub fn stop_stream<R: tauri::Runtime>(state: State<'_, WhisperPluginState>, app_handle: tauri::AppHandle<R>) -> Result<()> {
    #[cfg(not(feature = "diarization"))]
    let _ = &app_handle;

    let mut stream_guard = state.stream.lock().expect("stream mutex poisoned");
    let mut stream = stream_guard.take().ok_or(WhisperError::StreamNotActive)?;

    // Send the stop signal (ignore error if worker already gone).
    let _ = stream.sender.send(AudioMessage::Stop);

    // Wait for the worker to finish.
    if let Some(handle) = stream.worker.take() {
        let _ = handle.join();
    }

    // Save diarization profiles persistently
    #[cfg(feature = "diarization")]
    {
        use tauri::Manager;
        let guard = state.diarization.lock().expect("mutex poisoned");
        if let Some(pipeline) = guard.as_ref() {
            let profiles = pipeline.get_known_speakers();
            if !profiles.is_empty() {
                if let Ok(app_data) = app_handle.path().app_data_dir() {
                    let profiles_path = app_data.join("voice_profiles.json");
                    std::fs::create_dir_all(profiles_path.parent().unwrap()).ok();
                    if let Ok(json) = serde_json::to_string_pretty(&profiles) {
                        std::fs::write(&profiles_path, json).ok();
                        info!("stt: saved {} voice profiles to disk.", profiles.len());
                    }
                }
            } else {
                info!("stt: stream had no active speaker profiles; existing disk profiles preserved.");
            }
        }
    }

    info!("whisper: stream stopped");
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// list_backends
// ──────────────────────────────────────────────────────────────────────

#[command]
#[allow(clippy::vec_init_then_push)]
pub fn list_backends() -> Vec<String> {
    let mut backends = Vec::new();
    #[cfg(feature = "whisper")]
    backends.push("whisper".to_string());
    backends
}

// ──────────────────────────────────────────────────────────────────────
// download_model
// ──────────────────────────────────────────────────────────────────────

/// Downloads a standard Whisper model from HuggingFace.
///
/// # Arguments
/// * `model_id` — one of: `tiny`, `tiny.en`, `base`, `base.en`, `small`,
///   `small.en`, `medium`, `medium.en`, `large-v1`, `large-v2`, `large-v3`,
///   `large-v3-turbo`.
///
/// Emits `whisper-download-progress` events during the download.
/// Returns the absolute path to the downloaded model file.
#[command]
pub async fn download_model<R: Runtime>(
    model_id: String,
    app_handle: AppHandle<R>,
) -> Result<String> {
    // Resolve the models directory inside the app's data dir.
    let models_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| WhisperError::DownloadFailed(format!("Cannot resolve app data dir: {e}")))?
        .join("whisper-models");

    crate::download::download_model(&model_id, models_dir, &app_handle).await
}



#[command]
pub async fn download_diarization_models<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<String> {
    let models_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| WhisperError::DownloadFailed(format!("Cannot resolve app data dir: {e}")))?
        .join("whisper-models");

    crate::download::download_diarization_models(models_dir, &app_handle).await
}

// ──────────────────────────────────────────────────────────────────────
// ScreenCaptureKit commands (macOS 15+, feature = "screencapturekit")
// ──────────────────────────────────────────────────────────────────────

/// Check if screen capture permission is granted.
#[command]
pub fn check_screen_capture_permission() -> bool {
    crate::sck::has_screen_capture_permission()
}

/// Request screen capture permission via macOS system dialog.
#[command]
pub fn request_screen_capture_permission() -> bool {
    crate::sck::request_screen_capture_permission()
}

/// Returns all running apps that SCK can capture audio from.
/// Meeting apps (Teams, Zoom, etc.) are sorted to the top.
#[command]
pub fn list_capturable_apps() -> Result<Vec<crate::sck::CapturableApp>> {
    crate::sck::list_capturable_apps().map_err(WhisperError::InferenceFailed)
}

/// Start capturing system audio from `bundle_id` + microphone via ScreenCaptureKit.
/// The audio is fed into the active whisper stream, same as microphone capture.
#[command]
pub fn start_sck_capture(
    bundle_id: String,
    capture_mic: Option<bool>,
    state: State<'_, WhisperPluginState>,
) -> Result<()> {
    #[cfg(feature = "screencapturekit")]
    {
        let guard = state.stream.lock().unwrap();
        let sender = guard
            .as_ref()
            .map(|s| s.sender.clone())
            .ok_or(WhisperError::ModelNotLoaded)?;
        drop(guard);

        let handle = crate::sck::start_sck_capture(&bundle_id, capture_mic.unwrap_or(false), sender)
            .map_err(WhisperError::InferenceFailed)?;

        *state.sck_handle.lock().unwrap() = Some(handle);
        Ok(())
    }
    #[cfg(not(feature = "screencapturekit"))]
    {
        let _ = (bundle_id, capture_mic, state);
        Err(WhisperError::InferenceFailed(
            "screencapturekit feature not enabled".into(),
        ))
    }
}

/// Stop SCK capture.
#[command]
pub fn stop_sck_capture(state: State<'_, WhisperPluginState>) -> Result<()> {
    #[cfg(feature = "screencapturekit")]
    {
        if let Some(handle) = state.sck_handle.lock().unwrap().take() {
            handle.stop();
        }
    }
    let _ = state;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// Silero VAD commands
// ──────────────────────────────────────────────────────────────────────

/// Configures or loads the Silero VAD ONNX model path.
/// Pass `None` or `null` to disable VAD and fallback to continuous streaming.
#[command]
pub fn load_vad_model(
    model_path: Option<String>,
    state: State<'_, WhisperPluginState>,
) -> Result<()> {
    info!("vad: configuring VAD model path: {model_path:?}");
    *state.vad_model_path.lock().unwrap() = model_path;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct VoiceProfileMeta {
    pub id: usize,
    pub name: Option<String>,
    pub sample_count: usize,
    pub is_verified: bool,
}

#[cfg(feature = "diarization")]
#[command]
pub fn get_voice_profiles<R: tauri::Runtime>(
    state: State<'_, WhisperPluginState>,
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<VoiceProfileMeta>> {
    use tauri::Manager;
    let mut profiles = vec![];
    
    // First try to get from active pipeline
    let guard = state.diarization.lock().expect("mutex poisoned");
    if let Some(pipeline) = guard.as_ref() {
        profiles = pipeline.get_known_speakers();
    }
    
    // If in-memory pipeline has no profiles, check persistent disk
    if profiles.is_empty() {
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let profiles_path = app_data.join("voice_profiles.json");
            if profiles_path.exists() {
                if let Ok(json) = std::fs::read_to_string(&profiles_path) {
                    if let Ok(disk_profiles) = serde_json::from_str::<Vec<crate::diarization::pipeline::SpeakerProfile>>(&json) {
                        profiles = disk_profiles;
                    }
                }
            }
        }
    }
    
    let meta = profiles.into_iter().map(|p| VoiceProfileMeta {
        id: p.speaker_id,
        name: p.name,
        sample_count: p.sample_count,
        is_verified: p.is_verified,
    }).collect();
    
    Ok(meta)
}

#[cfg(not(feature = "diarization"))]
#[command]
pub fn get_voice_profiles() -> Result<Vec<VoiceProfileMeta>> {
    Ok(vec![])
}

#[cfg(feature = "diarization")]
#[command]
pub fn delete_voice_profile<R: tauri::Runtime>(
    speaker_id: usize,
    state: State<'_, WhisperPluginState>,
    app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    use tauri::Manager;
    
    // 1. Update active pipeline if loaded
    let mut guard = state.diarization.lock().expect("mutex poisoned");
    if let Some(pipeline) = guard.as_mut() {
        let mut profiles = pipeline.get_known_speakers();
        profiles.retain(|p| p.speaker_id != speaker_id);
        pipeline.set_known_speakers(profiles);
    }
    
    // 2. Always update disk directly
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let profiles_path = app_data.join("voice_profiles.json");
        if profiles_path.exists() {
            if let Ok(json) = std::fs::read_to_string(&profiles_path) {
                if let Ok(mut disk_profiles) = serde_json::from_str::<Vec<crate::diarization::pipeline::SpeakerProfile>>(&json) {
                    disk_profiles.retain(|p| p.speaker_id != speaker_id);
                    if let Ok(new_json) = serde_json::to_string_pretty(&disk_profiles) {
                        std::fs::write(&profiles_path, new_json).ok();
                    }
                }
            }
        }
    }
    
    Ok(())
}

#[cfg(not(feature = "diarization"))]
#[command]
pub fn delete_voice_profile<R: tauri::Runtime>(
    _speaker_id: usize,
    _state: State<'_, WhisperPluginState>,
    _app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    Ok(())
}

#[cfg(feature = "diarization")]
#[command]
pub fn clear_voice_profiles<R: tauri::Runtime>(
    state: State<'_, WhisperPluginState>,
    app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    use tauri::Manager;
    let mut guard = state.diarization.lock().expect("mutex poisoned");
    if let Some(pipeline) = guard.as_mut() {
        pipeline.set_known_speakers(vec![]);
    }
    // Always clear from disk
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let profiles_path = app_data.join("voice_profiles.json");
        let _ = std::fs::remove_file(&profiles_path);
        let _ = std::fs::write(&profiles_path, "[]");
        info!("stt: cleared all voice profiles from memory and disk.");
    }
    Ok(())
}

#[cfg(not(feature = "diarization"))]
#[command]
pub fn clear_voice_profiles<R: tauri::Runtime>(
    _state: State<'_, WhisperPluginState>,
    _app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    Ok(())
}

#[cfg(feature = "diarization")]
#[command]
pub fn rename_voice_profile<R: tauri::Runtime>(
    speaker_id: usize,
    name: String,
    state: State<'_, WhisperPluginState>,
    app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    use tauri::Manager;

    // 1. Update active pipeline if loaded in memory
    let mut guard = state.diarization.lock().expect("mutex poisoned");
    if let Some(pipeline) = guard.as_mut() {
        pipeline.rename_speaker(speaker_id, name.clone());
    }

    // 2. Update persistent file on disk
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let profiles_path = app_data.join("voice_profiles.json");
        if profiles_path.exists() {
            if let Ok(json) = std::fs::read_to_string(&profiles_path) {
                if let Ok(mut disk_profiles) = serde_json::from_str::<Vec<crate::diarization::pipeline::SpeakerProfile>>(&json) {
                    if let Some(p) = disk_profiles.iter_mut().find(|p| p.speaker_id == speaker_id) {
                        p.name = Some(name.clone());
                        if let Ok(new_json) = serde_json::to_string_pretty(&disk_profiles) {
                            let _ = std::fs::write(&profiles_path, new_json);
                            info!("stt: renamed speaker_{speaker_id} to '{name}' in voice_profiles.json");
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[cfg(not(feature = "diarization"))]
#[command]
pub fn rename_voice_profile<R: tauri::Runtime>(
    _speaker_id: usize,
    _name: String,
    _state: State<'_, WhisperPluginState>,
    _app_handle: tauri::AppHandle<R>,
) -> Result<()> {
    Ok(())
}


/// Downloads the Silero VAD ONNX model (~2.3 MB) from official source.
#[command]
pub async fn download_silero_vad_model<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<String> {
    let models_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| WhisperError::DownloadFailed(format!("Cannot resolve app data dir: {e}")))?
        .join("whisper-models");

    crate::download::download_silero_vad_model(models_dir, &app_handle).await
}

// ──────────────────────────────────────────────────────────────────────
// Model Discovery command
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadedWhisperModel {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadedModelsInfo {
    pub whisper_models: Vec<DownloadedWhisperModel>,
    pub vad_model_path: Option<String>,
    pub diarization_model_dir: Option<String>,
}

/// Discovers models that have already been downloaded to the app data directory.
#[command]
pub async fn get_downloaded_models<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<DownloadedModelsInfo> {
    let models_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| WhisperError::DownloadFailed(format!("Cannot resolve app data dir: {e}")))?
        .join("whisper-models");

    let mut whisper_models = Vec::new();
    let mut vad_model_path = None;
    let mut diarization_model_dir = None;

    if models_dir.exists() {
        if let Ok(mut entries) = tokio::fs::read_dir(&models_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let fname = entry.file_name().to_string_lossy().into_owned();
                let full_path = entry.path().to_string_lossy().into_owned();
                if fname == "silero_vad.onnx" {
                    vad_model_path = Some(full_path);
                } else if fname == "segmentation.onnx" {
                    if models_dir.join("embedding.onnx").exists() {
                        diarization_model_dir = Some(models_dir.to_string_lossy().into_owned());
                    }
                } else if fname.starts_with("ggml-") && fname.ends_with(".bin") {
                    let model_id = fname
                        .trim_start_matches("ggml-")
                        .trim_end_matches(".bin")
                        .to_string();
                    whisper_models.push(DownloadedWhisperModel {
                        id: model_id,
                        path: full_path,
                    });
                }
            }
        }
    }

    Ok(DownloadedModelsInfo {
        whisper_models,
        vad_model_path,
        diarization_model_dir,
    })
}


// ══════════════════════════════════════════════════════════════════════
// RECORD-THEN-TRANSCRIBE API
// ══════════════════════════════════════════════════════════════════════
// These commands are completely independent of the live-stream commands
// above.  Both can be active simultaneously (e.g. record to disk while
// also streaming real-time transcription to the UI).

// ──────────────────────────────────────────────────────────────────────
// Recording metadata types
// ──────────────────────────────────────────────────────────────────────

/// Metadata about a saved recording file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecordingInfo {
    /// Absolute path to the .wav file.
    pub path: String,
    /// Duration of the recording in milliseconds.
    pub duration_ms: u64,
    /// File size in bytes.
    pub size_bytes: u64,
    /// Unix timestamp (seconds) when the file was last modified.
    pub created_at: u64,
}

// ──────────────────────────────────────────────────────────────────────
// start_recording
// ──────────────────────────────────────────────────────────────────────

/// Start recording PCM audio to a WAV file on disk.
///
/// The file is written as 16 kHz, mono, i16 PCM WAV — the native format
/// expected by Whisper — so no conversion is needed at transcription time.
///
/// `output_path`: optional absolute path for the `.wav` file.
/// If omitted, a timestamped file is created in `<app_data>/recordings/`.
///
/// Returns the absolute path to the file being written.
#[command]
pub fn start_recording<R: Runtime>(
    output_path: Option<String>,
    state: State<'_, WhisperPluginState>,
    app_handle: AppHandle<R>,
) -> Result<String> {
    let mut guard = state.recording.lock().expect("recording mutex poisoned");
    if guard.is_some() {
        return Err(WhisperError::InferenceFailed(
            "A recording is already active. Call stop_recording first.".into(),
        ));
    }

    // Determine output path.
    let file_path = if let Some(p) = output_path.filter(|s| !s.trim().is_empty()) {
        std::path::PathBuf::from(p)
    } else {
        let recordings_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| WhisperError::InferenceFailed(format!("Cannot resolve app data dir: {e}")))?
            .join("recordings");
        std::fs::create_dir_all(&recordings_dir)?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        recordings_dir.join(format!("recording_{ts}.wav"))
    };

    // Ensure parent directory exists.
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let writer = hound::WavWriter::create(&file_path, spec)
        .map_err(|e| WhisperError::InferenceFailed(format!("Cannot create WAV file: {e}")))?;

    let path_str = file_path.to_string_lossy().into_owned();
    *guard = Some(RecordingSession {
        file_path,
        writer,
        sample_count: 0,
        started_at: std::time::Instant::now(),
    });

    info!("recording: started → {path_str}");
    Ok(path_str)
}

// ──────────────────────────────────────────────────────────────────────
// push_recording_chunk
// ──────────────────────────────────────────────────────────────────────

/// Write a chunk of raw PCM f32 samples (16 kHz, mono) to the active recording.
///
/// This command returns immediately.  The samples are converted to i16 and
/// appended to the WAV file synchronously (the BufWriter makes this fast).
///
/// This call is independent of `push_audio_chunk` — you can call both in the
/// same event handler to simultaneously record to disk and stream for live STT.
#[command]
pub fn push_recording_chunk(
    pcm_data: Vec<f32>,
    state: State<'_, WhisperPluginState>,
) -> Result<()> {
    let mut guard = state.recording.lock().expect("recording mutex poisoned");
    let session = guard
        .as_mut()
        .ok_or_else(|| WhisperError::InferenceFailed("No active recording. Call start_recording first.".into()))?;

    for &sample in &pcm_data {
        // Clamp to [-1, 1] before converting to avoid i16 overflow.
        let s = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        session
            .writer
            .write_sample(s)
            .map_err(|e| WhisperError::InferenceFailed(format!("WAV write error: {e}")))?;
        session.sample_count += 1;
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// stop_recording
// ──────────────────────────────────────────────────────────────────────

/// Finalize the WAV file and close the recording session.
///
/// Returns `RecordingInfo` with the file path, duration, and size so the
/// frontend can immediately offer "Create transcript" to the user.
#[command]
pub fn stop_recording(state: State<'_, WhisperPluginState>) -> Result<RecordingInfo> {
    let mut guard = state.recording.lock().expect("recording mutex poisoned");
    let session = guard
        .take()
        .ok_or_else(|| WhisperError::InferenceFailed("No active recording.".into()))?;

    let duration_ms = (session.sample_count as f64 / 16_000.0 * 1000.0) as u64;
    let path_str = session.file_path.to_string_lossy().into_owned();

    // Finalizing the WAV header requires consuming the writer.
    session
        .writer
        .finalize()
        .map_err(|e| WhisperError::InferenceFailed(format!("Failed to finalize WAV: {e}")))?;

    let size_bytes = std::fs::metadata(&path_str)
        .map(|m| m.len())
        .unwrap_or(0);

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    info!("recording: stopped — {path_str} ({duration_ms} ms, {size_bytes} bytes)");

    Ok(RecordingInfo {
        path: path_str,
        duration_ms,
        size_bytes,
        created_at,
    })
}

// ──────────────────────────────────────────────────────────────────────
// transcribe_recording
// ──────────────────────────────────────────────────────────────────────

/// Transcribe a previously saved WAV file with full speaker diarization.
///
/// This is an async command that runs the heavy work in a blocking thread pool.
/// It emits `whisper-recording-transcribe-progress` events during processing
/// and returns the complete `RecordingTranscript` when done.
///
/// The returned segments include `speaker_id` (`"speaker_1"`, `"speaker_2"`, …),
/// `text`, `start_ms`, and `end_ms` — everything needed to render a timed,
/// speaker-attributed transcript.
#[command]
pub async fn transcribe_recording<R: Runtime>(
    recording_path: String,
    language: Option<String>,
    state: State<'_, WhisperPluginState>,
    app_handle: AppHandle<R>,
) -> Result<crate::recording_worker::RecordingTranscript> {
    {
        let guard = state.backend.lock().expect("backend mutex poisoned");
        if guard.is_none() {
            return Err(WhisperError::ModelNotLoaded);
        }
    }

    let path = std::path::PathBuf::from(&recording_path);
    if !path.exists() {
        return Err(WhisperError::InferenceFailed(format!(
            "Recording file not found: {recording_path}"
        )));
    }

    let backend_arc = Arc::clone(&state.backend);
    #[cfg(feature = "diarization")]
    let diarization_arc = Arc::clone(&state.diarization);
    let vad_model_path = state.vad_model_path.lock().unwrap().clone();
    let lang = language;
    let handle = app_handle.clone();

    // Run in a blocking thread so we don't block the async executor.
    tokio::task::spawn_blocking(move || {
        crate::recording_worker::run_batch_transcription(
            &path,
            lang.as_deref(),
            backend_arc,
            #[cfg(feature = "diarization")]
            diarization_arc,
            vad_model_path,
            &handle,
        )
    })
    .await
    .map_err(|e| WhisperError::InferenceFailed(format!("Transcription task panicked: {e}")))?
}

// ──────────────────────────────────────────────────────────────────────
// list_recordings
// ──────────────────────────────────────────────────────────────────────

/// List all `.wav` files in the app's recordings directory.
#[command]
pub async fn list_recordings<R: Runtime>(app_handle: AppHandle<R>) -> Result<Vec<RecordingInfo>> {
    let recordings_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| WhisperError::InferenceFailed(format!("Cannot resolve app data dir: {e}")))?
        .join("recordings");

    if !recordings_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    let mut entries = tokio::fs::read_dir(&recordings_dir)
        .await
        .map_err(|e| WhisperError::InferenceFailed(format!("Cannot read recordings dir: {e}")))?;

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        let path_str = path.to_string_lossy().into_owned();

        // Read duration from WAV header without loading all samples.
        let (duration_ms, size_bytes) = tokio::task::spawn_blocking({
            let p = path.clone();
            move || -> (u64, u64) {
                let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                let duration = hound::WavReader::open(&p)
                    .map(|r| {
                        let spec = r.spec();
                        let num_samples = r.len() as u64;
                        let ch = spec.channels as u64;
                        let sr = spec.sample_rate as u64;
                        if ch > 0 && sr > 0 {
                            num_samples * 1000 / (sr * ch)
                        } else {
                            0
                        }
                    })
                    .unwrap_or(0);
                (duration, size)
            }
        })
        .await
        .unwrap_or((0, 0));

        let created_at = entry
            .metadata()
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        results.push(RecordingInfo {
            path: path_str,
            duration_ms,
            size_bytes,
            created_at,
        });
    }

    // Sort newest first.
    results.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    Ok(results)
}

// ──────────────────────────────────────────────────────────────────────
// delete_recording
// ──────────────────────────────────────────────────────────────────────

/// Delete a recording file from disk.
#[command]
pub async fn delete_recording(recording_path: String) -> Result<()> {
    let path = std::path::PathBuf::from(&recording_path);
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| WhisperError::InferenceFailed(format!("Cannot delete recording: {e}")))?;
        info!("recording: deleted {recording_path}");
    }
    Ok(())
}
