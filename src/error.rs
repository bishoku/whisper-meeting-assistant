use serde::{Serialize, Serializer};

/// All errors that the whisper plugin can surface to the frontend.
#[derive(Debug, thiserror::Error)]
pub enum WhisperError {
    #[error("No model is loaded. Call `load_model` first.")]
    ModelNotLoaded,

    #[error("Failed to load whisper model: {0}")]
    ModelLoadFailed(String),

    #[error("A stream is already active. Call `stop_stream` before starting a new one.")]
    StreamAlreadyActive,

    #[error("No active stream. Call `start_stream` first.")]
    StreamNotActive,

    #[error("A recording is already active. Call `stop_recording` first.")]
    RecordingAlreadyActive,

    #[error("No active recording. Call `start_recording` first.")]
    RecordingNotActive,

    #[error("Failed to send audio to the worker: {0}")]
    ChannelSendFailed(String),

    #[error("Inference failed: {0}")]
    InferenceFailed(String),

    #[error("Model download failed: {0}")]
    DownloadFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}


// Tauri commands require errors to be `Serialize`.
// We serialize every variant as its Display string.
impl Serialize for WhisperError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, WhisperError>;
