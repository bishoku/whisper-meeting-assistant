//! Model download from HuggingFace with progress events.

use std::path::PathBuf;

use futures_util::StreamExt;
use log::{error, info};
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{Result, WhisperError};
use crate::state::DownloadProgressPayload;

// ──────────────────────────────────────────────────────────────────────
// Known models → HuggingFace URLs
// ──────────────────────────────────────────────────────────────────────

/// Returns the HuggingFace direct-download URL for a given model id.
fn model_url(model_id: &str) -> Result<String> {
    let filename = match model_id {
        "tiny" => "ggml-tiny.bin",
        "tiny.en" => "ggml-tiny.en.bin",
        "base" => "ggml-base.bin",
        "base.en" => "ggml-base.en.bin",
        "small" => "ggml-small.bin",
        "small.en" => "ggml-small.en.bin",
        "medium" => "ggml-medium.bin",
        "medium.en" => "ggml-medium.en.bin",
        "large-v1" => "ggml-large-v1.bin",
        "large-v2" => "ggml-large-v2.bin",
        "large-v3" => "ggml-large-v3.bin",
        "large-v3-turbo" => "ggml-large-v3-turbo.bin",
        other => {
            return Err(WhisperError::DownloadFailed(format!(
                "Unknown model id: `{other}`. Expected one of: tiny, tiny.en, base, base.en, \
                 small, small.en, medium, medium.en, large-v1, large-v2, large-v3, large-v3-turbo"
            )));
        }
    };

    Ok(format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{filename}"
    ))
}

/// Returns the local filename for a given model id.
fn model_filename(model_id: &str) -> String {
    format!("ggml-{model_id}.bin")
}

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────

/// Downloads a Whisper GGML model from HuggingFace to `<models_dir>/<filename>`.
///
/// Emits `whisper-download-progress` events during the download.
/// Returns the absolute path to the downloaded file on success.
pub async fn download_model<R: Runtime>(
    model_id: &str,
    models_dir: PathBuf,
    app_handle: &AppHandle<R>,
) -> Result<String> {
    let url = model_url(model_id)?;
    let filename = model_filename(model_id);
    let dest = models_dir.join(&filename);

    info!("whisper download: {model_id} → {}", dest.display());

    // Ensure the models directory exists.
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| WhisperError::DownloadFailed(format!("Failed to create models dir: {e}")))?;

    // If the file already exists, return immediately.
    if dest.exists() {
        info!("whisper download: model already exists at {}", dest.display());
        return Ok(dest.to_string_lossy().into_owned());
    }

    let dest_str = dest.to_string_lossy().into_owned();
    download_file(&url, dest, model_id, None, app_handle).await?;

    info!("whisper download: complete → {}", dest_str);
    Ok(dest_str)
}

async fn download_file<R: Runtime>(
    url: &str,
    dest: std::path::PathBuf,
    model_id: &str,
    expected_sha256: Option<&str>,
    app_handle: &AppHandle<R>,
) -> Result<()> {
    if dest.exists() {
        return Ok(());
    }

    let response = reqwest::get(url)
        .await
        .map_err(|e| WhisperError::DownloadFailed(format!("HTTP request failed: {e}")))?;

    if !response.status().is_success() {
        return Err(WhisperError::DownloadFailed(format!(
            "HTTP {} for {}",
            response.status(),
            url
        )));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let tmp_dest = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp_dest)
        .await
        .map_err(|e| WhisperError::DownloadFailed(format!("Failed to create file: {e}")))?;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| WhisperError::DownloadFailed(format!("Stream error: {e}")))?;

        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| WhisperError::DownloadFailed(format!("Write error: {e}")))?;

        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        let payload = DownloadProgressPayload {
            model_id: model_id.to_string(),
            downloaded,
            total,
            percent,
        };

        if let Err(e) = app_handle.emit("whisper-core-download-progress", &payload) {
            error!("whisper download: failed to emit progress: {e}");
        }
    }

    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| WhisperError::DownloadFailed(format!("Flush error: {e}")))?;
    drop(file);

    if let Some(expected) = expected_sha256 {
        info!("whisper download: verifying checksum for {}", dest.display());
        let file_bytes = tokio::fs::read(&tmp_dest)
            .await
            .map_err(|e| WhisperError::DownloadFailed(format!("Failed to read for hash: {e}")))?;
        
        use sha2::Digest;
        let mut hasher = sha2::Sha256::new();
        hasher.update(&file_bytes);
        let computed_hash = hex::encode(hasher.finalize());
        
        if computed_hash != expected {
            let _ = tokio::fs::remove_file(&tmp_dest).await;
            error!("whisper download: checksum mismatch for {}", dest.display());
            return Err(WhisperError::DownloadFailed(format!(
                "Checksum mismatch for {}. Expected: {}, Got: {}",
                model_id, expected, computed_hash
            )));
        }
        info!("whisper download: checksum OK for {}", dest.display());
    }

    tokio::fs::rename(&tmp_dest, &dest)
        .await
        .map_err(|e| WhisperError::DownloadFailed(format!("Rename error: {e}")))?;

    Ok(())
}


pub async fn download_diarization_models<R: Runtime>(
    models_dir: PathBuf,
    app_handle: &AppHandle<R>,
) -> Result<String> {
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| WhisperError::DownloadFailed(format!("Failed to create models dir: {e}")))?;

    let pyannote_url = "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx";
    let pyannote_dest = models_dir.join("segmentation.onnx");
    let pyannote_hash = "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079";
    download_file(pyannote_url, pyannote_dest, "segmentation.onnx", Some(pyannote_hash), app_handle).await?;

    let speaker_url = "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx";
    let speaker_dest = models_dir.join("embedding.onnx");
    let speaker_hash = "bf1a75b9930474cf3389ef415e6e5d38ca96fea4a3a00f7e301d080a58ee2239";
    download_file(speaker_url, speaker_dest, "embedding.onnx", Some(speaker_hash), app_handle).await?;

    Ok(models_dir.to_string_lossy().into_owned())
}

/// Downloads the lightweight Silero VAD model (~2.3 MB).
pub async fn download_silero_vad_model<R: Runtime>(
    models_dir: PathBuf,
    app_handle: &AppHandle<R>,
) -> Result<String> {
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| WhisperError::DownloadFailed(format!("Failed to create models dir: {e}")))?;

    let url = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";
    let dest = models_dir.join("silero_vad.onnx");
    let silero_hash = "33e232c003430cc9b41dd01a844a4e8412a0d594d9c6884ad404bfa4722e4967";
    download_file(url, dest.clone(), "silero_vad.onnx", Some(silero_hash), app_handle).await?;

    Ok(dest.to_string_lossy().into_owned())
}

