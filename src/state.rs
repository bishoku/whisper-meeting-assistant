use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::path::PathBuf;
use std::time::Instant;

use crate::asr_backend::AsrBackend;

// ──────────────────────────────────────────────────────────────────────
// Audio channels — separates local mic from remote system audio
// ──────────────────────────────────────────────────────────────────────

/// Represents the physical or virtual source of audio in a meeting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AudioChannel {
    /// Local user's microphone (Guaranteed "You" / "Sen").
    #[default]
    Mic,
    /// Remote meeting participants via ScreenCaptureKit (Teams, Zoom, etc.).
    System,
}

// ──────────────────────────────────────────────────────────────────────
// Messages sent through the MPSC channel to the inference worker.
// ──────────────────────────────────────────────────────────────────────

/// A message the main thread sends to the background inference worker.
pub enum AudioMessage {
    /// A chunk of raw PCM f32 audio samples (16 kHz, mono) tagged with its source channel.
    Chunk {
        data: Vec<f32>,
        channel: AudioChannel,
    },
    /// Graceful shutdown signal.
    Stop,
}

// ──────────────────────────────────────────────────────────────────────
// Stream handle — owns the sender half and the worker join handle.
// ──────────────────────────────────────────────────────────────────────

/// Handle to an active streaming session.
/// Stored in managed state while a stream is running.
pub struct StreamHandle {
    /// Sender half of the MPSC channel.
    pub sender: mpsc::Sender<AudioMessage>,
    /// Join handle for the background worker thread.
    pub worker: Option<thread::JoinHandle<()>>,
}

// ──────────────────────────────────────────────────────────────────────
// Recording session — an active disk-based audio capture.
// ──────────────────────────────────────────────────────────────────────

/// An active recording session that writes PCM samples to a WAV file on disk.
/// This is completely independent of the live-stream session — both can run simultaneously.
pub struct RecordingSession {
    /// Absolute path to the .wav file being written.
    pub file_path: PathBuf,
    /// hound WAV writer (i16 PCM, 16 kHz, mono, buffered).
    pub writer: hound::WavWriter<std::io::BufWriter<std::fs::File>>,
    /// Total i16 samples written so far (used to calculate duration).
    pub sample_count: u64,
    /// Wall-clock time when recording started.
    pub started_at: Instant,
}

// ──────────────────────────────────────────────────────────────────────
// Plugin state — managed by Tauri's state system.
// ──────────────────────────────────────────────────────────────────────

#[cfg(feature = "diarization")]
use crate::diarization::pipeline::DiarizationPipeline;

/// Top-level plugin state managed via `app.manage()`.
///
/// All fields use `Arc<Mutex<Option<_>>>` so commands can:
/// 1. Cheaply clone the `Arc` to move into spawned threads.
/// 2. Lock the `Mutex` for short critical sections.
/// 3. Check `Option` to see whether a model/stream is active.
pub struct WhisperPluginState {
    /// The loaded ASR backend (set by `load_model`).
    pub backend: Arc<Mutex<Option<Box<dyn AsrBackend>>>>,
    /// The active live-stream handle (set by `start_stream`, cleared by `stop_stream`).
    pub stream: Arc<Mutex<Option<StreamHandle>>>,
    #[cfg(feature = "diarization")]
    pub diarization: Arc<Mutex<Option<DiarizationPipeline>>>,
    /// Active ScreenCaptureKit session handle (macOS 15+).
    #[cfg(feature = "screencapturekit")]
    pub sck_handle: Arc<Mutex<Option<crate::sck::SckCaptureHandle>>>,
    /// Optional path to Silero VAD model.
    pub vad_model_path: Arc<Mutex<Option<String>>>,
    /// Active disk-based recording session (independent of `stream`).
    pub recording: Arc<Mutex<Option<RecordingSession>>>,
}

impl Default for WhisperPluginState {
    fn default() -> Self {
        Self {
            backend: Arc::new(Mutex::new(None)),
            stream: Arc::new(Mutex::new(None)),
            #[cfg(feature = "diarization")]
            diarization: Arc::new(Mutex::new(None)),
            #[cfg(feature = "screencapturekit")]
            sck_handle: Arc::new(Mutex::new(None)),
            vad_model_path: Arc::new(Mutex::new(None)),
            recording: Arc::new(Mutex::new(None)),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// Audio context — metadata for a streaming session.
// ──────────────────────────────────────────────────────────────────────

/// Optional metadata attached to a streaming session.
/// Intended for future speaker diarisation, language hints, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioContext {
    /// Identifier for the audio source (e.g. a mic id or meeting id).
    pub source_id: Option<String>,
    /// BCP-47 language hint (e.g. `"en"`, `"tr"`). `None` = auto-detect.
    pub language: Option<String>,
    /// Latency / resource profile: `"balanced"` (default) or `"low_latency"`.
    pub latency_mode: Option<String>,
    /// When true, write incoming audio to disk recording (if active) and skip live Whisper inference.
    #[serde(default)]
    pub record_only: Option<bool>,
}

// ──────────────────────────────────────────────────────────────────────
// Event payloads emitted to the frontend via Tauri events.
// ──────────────────────────────────────────────────────────────────────

/// Emitted for every new segment detected during inference.
#[derive(Debug, Clone, Serialize)]
pub struct PartialResultPayload {
    pub text: String,
    pub segment_index: i32,
    /// Segment start time in milliseconds.
    pub start_ms: i64,
    /// Segment end time in milliseconds.
    pub end_ms: i64,
    pub is_partial: bool,
}

/// Emitted after a full inference pass completes.
#[derive(Debug, Clone, Serialize)]
pub struct FinalResultPayload {
    pub segments: Vec<SegmentPayload>,
    /// Wall-clock time the inference pass took, in milliseconds.
    pub processing_time_ms: u64,
}

/// A single transcribed segment.
#[derive(Debug, Clone, Serialize)]
pub struct SegmentPayload {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// Progress payload for model downloads.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
}

/// A segment with speaker attribution and audio source channel.
#[derive(Debug, Clone, Serialize)]
pub struct DiarizedSegmentPayload {
    pub speaker_id: String,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub channel: AudioChannel,
}

/// Result payload with speaker diarization.
#[derive(Debug, Clone, Serialize)]
pub struct DiarizedResultPayload {
    pub segments: Vec<DiarizedSegmentPayload>,
    pub processing_time_ms: u64,
    pub num_speakers: usize,
}

// ──────────────────────────────────────────────────────────────────────
// Recording payloads
// ──────────────────────────────────────────────────────────────────────

/// Emitted periodically during `transcribe_recording` to report processing progress.
#[derive(Debug, Clone, Serialize)]
pub struct RecordingTranscribeProgressPayload {
    /// How many milliseconds of audio have been processed so far.
    pub processed_ms: u64,
    /// Total duration of the recording in milliseconds.
    pub total_ms: u64,
    /// Percentage complete (0.0–100.0).
    pub percent: f64,
}
