use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{command, AppHandle, Manager};
use tauri_plugin_whisper::{WhisperPluginState, state::AudioMessage};

/// Shared shutdown flag — the cpal::Stream itself is !Send so it
/// lives on the thread that created it. We only share the flag.
struct AudioCaptureState {
    /// Set to `true` to signal the capture thread to stop.
    running: Arc<AtomicBool>,
    /// Join handle for the capture thread.
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Default for AudioCaptureState {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            thread: Mutex::new(None),
        }
    }
}

#[command]
fn start_capture(app_handle: AppHandle, capture_state: tauri::State<'_, AudioCaptureState>) -> Result<(), String> {
    // Prevent double-start.
    if capture_state.running.load(Ordering::SeqCst) {
        return Err("Already capturing".into());
    }

    let running = capture_state.running.clone();
    running.store(true, Ordering::SeqCst);

    let app = app_handle.clone();

    // Spawn a dedicated thread that owns the cpal::Stream.
    let handle = std::thread::Builder::new()
        .name("audio-capture".into())
        .spawn(move || {
            if let Err(e) = run_capture(app, running.clone()) {
                log::error!("audio capture error: {e}");
            }
            running.store(false, Ordering::SeqCst);
        })
        .map_err(|e| e.to_string())?;

    *capture_state.thread.lock().unwrap() = Some(handle);
    Ok(())
}

/// Runs on the capture thread — creates the cpal stream and blocks
/// until `running` is set to false.
fn run_capture(app: AppHandle, running: Arc<AtomicBool>) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("No input device found")?;
    let config = device.default_input_config().map_err(|e| e.to_string())?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;

    let target_rate: usize = 16_000;
    let chunk_samples: usize = target_rate * 200 / 1000; // 3200 samples = 200ms

    let source_rate = sample_rate as f64;
    let target_rate_f64 = target_rate as f64;

    let sender = {
        let state = app.state::<WhisperPluginState>();
        let stream_guard = state.stream.lock().unwrap();
        stream_guard.as_ref().map(|sh| sh.sender.clone())
    }
    .ok_or("Whisper stream is not active. Call start_stream first.")?;

    let mut buffer: Vec<f32> = Vec::with_capacity(chunk_samples * 2);

    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Downmix to mono.
                let mono: Vec<f32> = data
                    .chunks(channels)
                    .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                    .collect();

                // Linear resampling → 16 kHz.
                let ratio = target_rate_f64 / source_rate;
                let resampled_len = (mono.len() as f64 * ratio) as usize;
                let mut resampled = Vec::with_capacity(resampled_len);
                for i in 0..resampled_len {
                    let src_idx = i as f64 / ratio;
                    let idx = src_idx as usize;
                    let frac = (src_idx - idx as f64) as f32;
                    let sample = if idx + 1 < mono.len() {
                        mono[idx] * (1.0 - frac) + mono[idx + 1] * frac
                    } else if idx < mono.len() {
                        mono[idx]
                    } else {
                        0.0
                    };
                    resampled.push(sample);
                }

                // Accumulate and push full chunks to whisper.
                buffer.extend_from_slice(&resampled);

                while buffer.len() >= chunk_samples {
                    let chunk: Vec<f32> = buffer.drain(..chunk_samples).collect();
                    let _ = sender.send(AudioMessage::Chunk {
                        data: chunk,
                        channel: tauri_plugin_whisper::state::AudioChannel::Mic,
                    });
                }
            },
            |err| {
                log::error!("cpal stream error: {err}");
            },
            None,
        )
        .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    // Block this thread until told to stop.
    while running.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // Stream is dropped here, stopping capture.
    drop(stream);
    Ok(())
}

#[command]
fn stop_capture(capture_state: tauri::State<'_, AudioCaptureState>) -> Result<(), String> {
    capture_state.running.store(false, Ordering::SeqCst);

    // Wait for the capture thread to finish.
    if let Some(handle) = capture_state.thread.lock().unwrap().take() {
        let _ = handle.join();
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_whisper::init())
        .manage(AudioCaptureState::default())
        .invoke_handler(tauri::generate_handler![start_capture, stop_capture])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
