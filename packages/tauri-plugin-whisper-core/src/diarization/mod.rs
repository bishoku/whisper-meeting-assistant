//! Speaker diarization module.
//!
//! Uses sherpa-onnx for offline speaker segmentation and embedding extraction.

#[cfg(feature = "diarization")]
pub mod pipeline;
#[cfg(feature = "diarization")]
pub mod merger;
