//! ScreenCaptureKit audio capture backend.
//!
//! Captures system audio (from a specific app like Teams/Zoom) and microphone
//! simultaneously using Apple's ScreenCaptureKit framework (macOS 15+).
//!
//! No extra software installation required — only a one-time "Screen & System Audio Recording"
//! permission grant from the user.

#[cfg(feature = "screencapturekit")]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[cfg(feature = "screencapturekit")]
use log::{info, warn};

#[cfg(feature = "screencapturekit")]
use screencapturekit::prelude::*;
#[cfg(feature = "screencapturekit")]
use screencapturekit::cm::CMSampleBufferExt;
#[cfg(feature = "screencapturekit")]
use screencapturekit::stream::configuration::audio::AudioSampleRate;

#[cfg(feature = "screencapturekit")]
use crate::state::AudioMessage;

// ── Known meeting app bundle IDs ──────────────────────────────────────────────

#[cfg(feature = "screencapturekit")]
const MEETING_APPS: &[(&str, &str)] = &[
    ("com.microsoft.teams",       "Microsoft Teams"),
    ("com.microsoft.teams2",      "Microsoft Teams (new)"),
    ("us.zoom.xos",               "Zoom"),
    ("com.google.meet",           "Google Meet"),
    ("com.webex.meetingmanager",  "Webex"),
    ("com.skype.skype",           "Skype"),
    ("com.discord",               "Discord"),
    ("com.slack.Slack",           "Slack"),
];

// ── Permission Helpers ────────────────────────────────────────────────────────

#[cfg(all(feature = "screencapturekit", target_os = "macos"))]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub fn has_screen_capture_permission() -> bool {
    #[cfg(all(feature = "screencapturekit", target_os = "macos"))]
    unsafe {
        CGPreflightScreenCaptureAccess()
    }
    #[cfg(not(all(feature = "screencapturekit", target_os = "macos")))]
    false
}

pub fn request_screen_capture_permission() -> bool {
    #[cfg(all(feature = "screencapturekit", target_os = "macos"))]
    unsafe {
        CGRequestScreenCaptureAccess()
    }
    #[cfg(not(all(feature = "screencapturekit", target_os = "macos")))]
    false
}

// ── Public types ──────────────────────────────────────────────────────────────

/// Info about a running capturable application.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CapturableApp {
    pub name: String,
    pub bundle_id: String,
    /// Whether this is a known meeting app.
    pub is_meeting_app: bool,
}

// ── List running apps ─────────────────────────────────────────────────────────

/// Returns all running apps that SCK can capture audio from.
/// On macOS 15+ this includes both system apps and background processes.
#[cfg(feature = "screencapturekit")]
pub fn list_capturable_apps() -> Result<Vec<CapturableApp>, String> {
    if !has_screen_capture_permission() {
        // Explicitly trigger the macOS permission prompt / register app in System Settings
        request_screen_capture_permission();
        return Err("permission_denied: Ekran ve Sistem Sesi Kaydı izni gerekli.".into());
    }

    let content = SCShareableContent::get()
        .map_err(|e| format!("SCShareableContent::get failed: {e}"))?;

    let mut apps: Vec<CapturableApp> = content
        .applications()
        .iter()
        .map(|app| {
            let bundle_id = app.bundle_identifier().to_string();
            let name = app.application_name().to_string();
            let is_meeting_app = MEETING_APPS
                .iter()
                .any(|(id, _)| *id == bundle_id.as_str());
            CapturableApp { name, bundle_id, is_meeting_app }
        })
        .collect();

    // Sort: meeting apps first, then alphabetical.
    apps.sort_by(|a, b| {
        b.is_meeting_app
            .cmp(&a.is_meeting_app)
            .then(a.name.cmp(&b.name))
    });

    Ok(apps)
}

#[cfg(not(feature = "screencapturekit"))]
pub fn list_capturable_apps() -> Result<Vec<CapturableApp>, String> {
    Err("screencapturekit feature not enabled".into())
}

// ── Capture state ─────────────────────────────────────────────────────────────

/// Wraps a running SCStream + a stop flag so the Tauri command can shut it down.
#[cfg(feature = "screencapturekit")]
pub struct SckCaptureHandle {
    stream:  Mutex<Option<SCStream>>,
    running: Arc<AtomicBool>,
}

#[cfg(feature = "screencapturekit")]
impl SckCaptureHandle {
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.stream.lock() {
            if let Some(ref mut stream) = *guard {
                if let Err(e) = stream.stop_capture() {
                    warn!("SCStream stop error: {e}");
                }
            }
            *guard = None;
        }
    }
}

// ── Stream output handler ─────────────────────────────────────────────────────

/// Receives CMSampleBuffers from SCK for a specific channel (System or Mic),
/// downmixes if necessary, and forwards PCM chunks to the worker.
#[cfg(feature = "screencapturekit")]
struct ChannelAudioHandler {
    sender:  std::sync::mpsc::Sender<AudioMessage>,
    channel: crate::state::AudioChannel,
    buf:     Mutex<Vec<f32>>,
    chunk_n: usize,  // how many f32 samples per chunk (200ms @ 16kHz = 3200)
}

#[cfg(feature = "screencapturekit")]
impl ChannelAudioHandler {
    fn new(
        sender: std::sync::mpsc::Sender<AudioMessage>,
        channel: crate::state::AudioChannel,
        chunk_n: usize,
    ) -> Self {
        Self {
            sender,
            channel,
            buf: Mutex::new(Vec::with_capacity(chunk_n * 2)),
            chunk_n,
        }
    }

    /// Extract interleaved f32 PCM from a CMSampleBuffer and send chunks.
    fn handle_pcm(&self, sample: &CMSampleBuffer) {
        let Some(abl) = sample.audio_buffer_list() else { return };

        let mut out: Vec<f32> = Vec::new();

        for buf in abl.iter() {
            let bytes = buf.data();
            let n_channels = buf.number_channels() as usize;
            // SCK delivers 32-bit float PCM (kAudioFormatFlagIsFloat)
            let samples: &[f32] = bytemuck_cast(bytes);
            // Downmix to mono if stereo
            if n_channels <= 1 {
                out.extend_from_slice(samples);
            } else {
                for frame in samples.chunks(n_channels) {
                    let mono = frame.iter().sum::<f32>() / n_channels as f32;
                    out.push(mono);
                }
            }
        }

        if out.is_empty() {
            return;
        }

        let mut guard = self.buf.lock().unwrap();
        guard.extend_from_slice(&out);

        while guard.len() >= self.chunk_n {
            let chunk: Vec<f32> = guard.drain(..self.chunk_n).collect();
            if self.sender.send(AudioMessage::Chunk {
                data: chunk,
                channel: self.channel,
            }).is_err() {
                // Worker gone — stop silently.
            }
        }
    }
}

/// Safe cast from &[u8] to &[f32] — valid because SCK guarantees f32 PCM alignment.
#[cfg(feature = "screencapturekit")]
fn bytemuck_cast(bytes: &[u8]) -> &[f32] {
    let n = bytes.len() / 4;
    // SAFETY: SCK delivers 4-byte-aligned f32 PCM; pointer from Apple frameworks.
    unsafe { std::slice::from_raw_parts(bytes.as_ptr().cast::<f32>(), n) }
}

#[cfg(feature = "screencapturekit")]
impl SCStreamOutputTrait for ChannelAudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        match of_type {
            SCStreamOutputType::Audio | SCStreamOutputType::Microphone => self.handle_pcm(&sample),
            SCStreamOutputType::Screen => {}
        }
    }
}

// ── Start capture ─────────────────────────────────────────────────────────────

/// Start capturing system audio from `bundle_id` app + microphone.
///
/// Returns a `SckCaptureHandle` that must be kept alive; dropping or calling
/// `.stop()` stops the stream.
#[cfg(feature = "screencapturekit")]
pub fn start_sck_capture(
    bundle_id: &str,
    capture_mic: bool,
    sender: std::sync::mpsc::Sender<AudioMessage>,
) -> Result<SckCaptureHandle, String> {
    info!("sck: starting capture for bundle_id={bundle_id} (capture_mic={capture_mic})");

    let content = SCShareableContent::get()
        .map_err(|e| format!("SCShareableContent::get: {e}"))?;

    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or("No display found")?;

    // Find the target app by bundle ID.
    let apps = content.applications();
    let target_app = apps
        .iter()
        .find(|a| a.bundle_identifier() == bundle_id)
        .ok_or_else(|| format!("App not running: {bundle_id}"))?;

    // Content filter: capture only this app's audio (no other apps, no desktop).
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_including_applications(&[target_app], &[])
        .build();

    // Audio-only configuration at 16kHz mono — perfect for Whisper, no resampling needed.
    let mut config = SCStreamConfiguration::new()
        // Minimal video frame (required even for audio-only streams)
        .with_width(2)
        .with_height(2)
        // System audio (app output — remote participants)
        .with_captures_audio(true)
        .with_sample_rate(AudioSampleRate::Rate16000)
        .with_channel_count(1);

    if capture_mic {
        // Microphone (macOS 15+) — only when requested
        config = config.with_captures_microphone(true);
    }

    // 200ms chunks at 16kHz = 3200 samples
    let chunk_n = 16_000 * 200 / 1000;
    let sys_handler = ChannelAudioHandler::new(sender.clone(), crate::state::AudioChannel::System, chunk_n);

    let mut stream = SCStream::new(&filter, &config);

    // Register handler for system audio
    stream.add_output_handler(sys_handler, SCStreamOutputType::Audio);

    if capture_mic {
        let mic_handler = ChannelAudioHandler::new(sender, crate::state::AudioChannel::Mic, chunk_n);
        stream.add_output_handler(mic_handler, SCStreamOutputType::Microphone);
    }

    stream
        .start_capture()
        .map_err(|e| format!("SCStream::start_capture: {e}"))?;

    info!("sck: stream started");

    let running = Arc::new(AtomicBool::new(true));
    Ok(SckCaptureHandle {
        stream: Mutex::new(Some(stream)),
        running,
    })
}

#[cfg(not(feature = "screencapturekit"))]
pub fn start_sck_capture(
    _bundle_id: &str,
    _capture_mic: bool,
    _sender: std::sync::mpsc::Sender<crate::state::AudioMessage>,
) -> Result<(), String> {
    Err("screencapturekit feature not enabled".into())
}
