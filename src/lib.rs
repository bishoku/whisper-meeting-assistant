//! `tauri-plugin-whisper` — Offline, real-time Speech-to-Text for Tauri v2.
//!
//! This plugin wraps [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
//! (via [`whisper-rs`]) to provide streaming transcription with hardware
//! acceleration (CUDA / Metal / CoreML).
//!
//! # Quick Start
//!
//! ```rust,ignore
//! tauri::Builder::default()
//!     .plugin(tauri_plugin_whisper::init())
//!     .run(tauri::generate_context!())
//!     .expect("error while running tauri application");
//! ```

mod asr_backend;
mod backends;
mod commands;
mod download;
mod error;
pub mod state;
mod mel;
mod worker;
mod recording_worker;

#[cfg(feature = "diarization")]
pub mod diarization;

pub mod sck;
pub mod vad;

pub use asr_backend::{AsrBackend, TranscriptSegment};
pub use error::{Result, WhisperError};
pub use state::{
    AudioChannel, AudioContext, DiarizedResultPayload, DiarizedSegmentPayload,
    DownloadProgressPayload, FinalResultPayload, PartialResultPayload,
    SegmentPayload, WhisperPluginState, RecordingTranscribeProgressPayload,
};
pub use recording_worker::{RecordingTranscript, RecordingTranscriptSegment};

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// Initialises the whisper plugin.
///
/// Call this from your Tauri builder:
/// ```rust,ignore
/// tauri::Builder::default()
///     .plugin(tauri_plugin_whisper::init())
///     // …
/// ```
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("whisper")
        .invoke_handler(tauri::generate_handler![
            commands::load_model,
            commands::start_stream,
            commands::push_audio_chunk,
            commands::stop_stream,
            commands::download_model,
            commands::download_diarization_models,
            commands::download_silero_vad_model,
            commands::load_vad_model,
            commands::get_downloaded_models,
            commands::list_backends,
            // Diarization (compiled in when feature is enabled, no-ops otherwise)
            commands::load_diarization_model,
            commands::set_diarization_threshold,
            commands::merge_speakers,
            commands::get_voice_profiles,
            commands::delete_voice_profile,
            commands::clear_voice_profiles,
            commands::rename_voice_profile,
            // ScreenCaptureKit
            commands::check_screen_capture_permission,
            commands::request_screen_capture_permission,
            commands::list_capturable_apps,
            commands::start_sck_capture,
            commands::stop_sck_capture,
            // Record-then-transcribe
            commands::start_recording,
            commands::push_recording_chunk,
            commands::stop_recording,
            commands::transcribe_recording,
            commands::list_recordings,
            commands::delete_recording,
        ])
        .setup(|app, _api| {
            app.manage(WhisperPluginState::default());
            Ok(())
        })
        .build()
}
