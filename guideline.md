# Tauri Plugin Whisper - Integration Guideline

This document explains how to integrate the `tauri-plugin-whisper` plugin into another Tauri v2 application.

## 1. Add the Dependency

In your Tauri application's `src-tauri/Cargo.toml`, add the plugin as a dependency. You can point to the local path or a git repository:

```toml
[dependencies]
tauri-plugin-whisper = { path = "path/to/tauri-plugin-whisper", features = ["full", "metal"] }
```

### Available Features
* `metal`: Enables Apple Metal (GPU) acceleration (macOS only).
* `cuda`: Enables NVIDIA CUDA acceleration (Windows/Linux).
* `diarization`: Enables speaker diarization (separating who said what) using Pyannote and ERes2NetV2.
* `vad`: Enables Voice Activity Detection using Silero VAD.
* `screencapturekit`: Enables system audio capture on macOS (requires macOS 13.0+).
* `full`: Enables all the main features (Diarization, VAD, SCK).

## 2. Initialize the Plugin in Rust

In your `src-tauri/src/lib.rs` (or `main.rs`), register the plugin with the Tauri builder:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register the Whisper Plugin
        .plugin(tauri_plugin_whisper::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## 3. macOS Permissions (Important)

If you plan to capture microphone or system audio on macOS, you must add the following permissions to your `src-tauri/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app requires microphone access to transcribe your speech.</string>
<key>NSScreenCaptureUsageDescription</key>
<string>This app requires screen capture access to record meeting audio.</string>
```

## 4. Frontend Integration

You can interact with the plugin directly from your frontend (React, Vue, Svelte) using Tauri's `invoke` command.

### Example: Downloading & Loading Models

```typescript
import { invoke } from '@tauri-apps/api/core';

// 1. Download models
await invoke('plugin:whisper|download_model', { modelId: 'large-v3-turbo' });
await invoke('plugin:whisper|download_silero_vad_model');
await invoke('plugin:whisper|download_diarization_models');

// 2. Discover downloaded models
const modelsInfo = await invoke('plugin:whisper|get_downloaded_models');

// 3. Load the model into GPU/RAM
await invoke('plugin:whisper|load_model', { 
  modelPath: modelsInfo.whisper_models[0].path,
  useGpu: true,
  backend: 'whisper'
});
```

### Example: Starting the Stream & Listening for Transcripts

```typescript
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// Listen for transcriptions
const unlisten = await listen('whisper-partial', (event) => {
    console.log("Partial result:", event.payload.text);
});

const unlistenFinal = await listen('whisper-segment', (event) => {
    console.log(`Speaker ${event.payload.speaker_id} said: ${event.payload.text}`);
});

// Start the processing pipeline
await invoke('plugin:whisper|start_stream', { 
  language: 'tr', // or 'auto'
  latencyMode: 'balanced' // or 'low_latency'
});
```

## 5. Feeding Audio to the Plugin

The plugin expects raw `16 kHz, 32-bit float, mono` PCM audio data. You have two options for feeding audio:

### Option A: From Rust (Recommended for Performance)
Use `cpal` or the plugin's built-in ScreenCaptureKit commands to record audio in Rust, and push chunks directly to the plugin state. This avoids IPC overhead. (See the `tauri-whisper-demo`'s `src-tauri/src/lib.rs` for a full `cpal` example).

```rust
use tauri_plugin_whisper::{WhisperPluginState, state::{AudioMessage, AudioChannel}};

// ... inside your audio callback ...
let state = app_handle.state::<WhisperPluginState>();
let stream_guard = state.stream.lock().unwrap();
if let Some(ref stream_handle) = *stream_guard {
    let _ = stream_handle.sender.send(AudioMessage::Chunk {
        data: chunk, // Vec<f32> at 16kHz Mono
        channel: AudioChannel::Mic, // Or AudioChannel::System
    });
}
```

### Option B: From Frontend
If you capture audio in the browser (e.g., using `MediaRecorder` or `AudioWorklet`), you can send chunks via IPC:

```typescript
// Float32Array containing 16kHz Mono PCM data
await invoke('plugin:whisper|push_audio_chunk', {
  samples: Array.from(float32Array),
  channel: 'Mic' // 'Mic' or 'System'
});
```

## 6. Voice Profiles (Diarization)

If diarization is enabled, the plugin automatically saves voice profiles to `<app_data_dir>/voice_profiles.json`. It will recognize returning speakers across sessions.
* Rename a speaker in UI? Just map `speaker_0` to `"Ahmet"` in your frontend state (e.g. `localStorage`).
* Delete a speaker profile? Call `invoke('plugin:whisper|delete_voice_profile', { speakerId: 0 })`.
