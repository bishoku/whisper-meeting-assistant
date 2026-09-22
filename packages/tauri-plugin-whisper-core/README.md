# tauri-plugin-whisper-core

High-performance, offline Speech-to-Text, Silero Voice Activity Detection (VAD), and Pyannote Speaker Diarization plugin for Tauri v2 powered by [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and ONNX Runtime.

Part of the [Whisper Meeting Assistant](https://github.com/bishoku/whisper-meeting-assistant) project.

[![Crates.io](https://img.shields.io/crates/v/tauri-plugin-whisper-core.svg)](https://crates.io/crates/tauri-plugin-whisper-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Offline Speech-to-Text:** Real-time and batch transcription via `whisper-rs` (whisper.cpp) with Apple Metal and NVIDIA CUDA acceleration.
- **Silero VAD:** Pre-filter silence and noise to prevent Whisper hallucinations and optimize CPU/GPU utilization.
- **Pyannote Speaker Diarization:** Multi-speaker segmentation, speaker embeddings, voice profiles, and speaker renaming/merging.
- **macOS System Audio:** ScreenCaptureKit loopback capture for transcribing Zoom, Google Meet, and Microsoft Teams meetings.
- **Record-then-Transcribe:** Stream audio directly to 16 kHz WAV files and run high-accuracy multi-speaker offline transcription.

---

## Installation

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-whisper-core = { version = "0.1", features = ["full", "metal"] }
```

### Feature Flags

| Feature | Description |
| :--- | :--- |
| `whisper` | Core whisper.cpp speech-to-text inference *(default)* |
| `metal` | Apple Silicon GPU acceleration via Metal |
| `cuda` | NVIDIA GPU acceleration via CUDA |
| `vad` | Silero Voice Activity Detection via ONNX Runtime |
| `diarization` | Pyannote speaker segmentation and embedding pipeline |
| `screencapturekit` | macOS ScreenCaptureKit system audio loopback capture |
| `full` | Enables `whisper`, `metal`, `diarization`, `vad`, and `screencapturekit` |

---

## Setup in Tauri v2

Register the plugin in your Tauri builder:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_whisper_core::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Enable permissions in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "core:default",
    "whisper-core:default"
  ]
}
```

---

## Frontend Integration

For React applications, use the official React SDK:

```bash
npm install tauri-plugin-whisper-react @tauri-apps/api
```

```tsx
import { useWhisper, useDiarization } from 'tauri-plugin-whisper-react';

export function MeetingRecorder() {
  const { isRunning, startStream, stopStream, segments, partialText } = useWhisper();
  const { voiceProfiles, renameVoiceProfile } = useDiarization();

  return (
    <div>
      <button onClick={() => isRunning ? stopStream() : startStream()}>
        {isRunning ? 'Stop' : 'Start'}
      </button>
      <p>{partialText}</p>
      {segments.map((s, idx) => (
        <p key={idx}>[{s.speaker_id}] {s.text}</p>
      ))}
    </div>
  );
}
```

---

## License

MIT License. Copyright (c) 2026 bishoku.
