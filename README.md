# Whisper Meeting Assistant

<p align="center">
  <strong>Private, 100% Offline AI Meeting Transcription & Speaker Diarization for macOS</strong>
  <br />
  <em>Powered by Whisper.cpp, Silero VAD, Pyannote Diarization, and Tauri v2</em>
</p>

<p align="center">
  <a href="https://github.com/bishoku/whisper-meeting-assistant/releases/latest">
    <img src="https://img.shields.io/github/v/release/bishoku/whisper-meeting-assistant?label=Download%20macOS%20DMG&style=for-the-badge&color=blue" alt="Download DMG" />
  </a>
</p>

<p align="center">
  <a href="https://crates.io/crates/tauri-plugin-whisper-core">
    <img src="https://img.shields.io/crates/v/tauri-plugin-whisper-core.svg?style=flat-square&label=crates.io" alt="Crates.io" />
  </a>
  <a href="https://www.npmjs.com/package/tauri-plugin-whisper-react">
    <img src="https://img.shields.io/npm/v/tauri-plugin-whisper-react.svg?style=flat-square&label=npm" alt="npm" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License: MIT" />
  </a>
  <a href="https://github.com/bishoku/whisper-meeting-assistant/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/bishoku/whisper-meeting-assistant/ci.yml?style=flat-square&label=CI" alt="CI Status" />
  </a>
</p>

---

## Overview

**Whisper Meeting Assistant** is a desktop application designed for privacy-conscious professionals who want automated meeting transcripts without sending confidential audio to third-party cloud servers. Everything runs entirely on your Mac using Apple Silicon Metal acceleration.

---

## Key Features

- 🔒 **100% Private & Offline:** Zero telemetry, no cloud APIs. Your meeting audio and transcripts never leave your machine.
- ⚡ **Metal GPU Acceleration:** Optimized for Apple Silicon (M1, M2, M3, M4) with minimal battery drain and real-time response.
- 👥 **Smart Speaker Diarization:** Identifies distinct speakers using Pyannote neural embeddings. Name participants, build persistent voice profiles across meetings, and merge duplicate speakers.
- 🔇 **Silero Voice Activity Detection (VAD):** Filters background noise, breaths, and silence to eliminate hallucinations and reduce CPU usage.
- 🖥️ **System Audio Capture (macOS ScreenCaptureKit):** Record and transcribe remote participants from Zoom, Google Meet, Microsoft Teams, and Slack Huddles with zero virtual audio cables.
- 🎙️ **Dual Transcription Modes:**
  - **Live Streaming Mode:** Real-time speech-to-text with instantaneous text streaming and speaker badges.
  - **Record-then-Transcribe Mode:** Records high-fidelity 16 kHz audio directly to disk for long meetings, then processes offline with multi-pass diarization and a progress bar.
- 📂 **Meeting Archive & Export:** Search past meetings, replay audio, and export transcripts to Markdown, TXT, or JSON with timestamped speaker turns.

---

## Monorepo Architecture

This repository is structured as a product-first monorepo consisting of the desktop application and its modular open-source developer libraries:

```
whisper-meeting-assistant/
├── apps/
│   └── desktop/                            # 🍏 Flagship macOS Desktop Application (Tauri v2 + React)
│
├── packages/
│   ├── tauri-plugin-whisper-core/          # 🦀 Rust Tauri v2 Plugin (published to crates.io)
│   └── tauri-plugin-whisper-react/         # 📦 React SDK & Hooks (published to npm)
│
├── .github/
│   └── workflows/
│       ├── ci.yml                          # Continuous Integration (tests & type checks)
│       └── release.yml                     # Unified release (DMG, Crates.io, NPM)
│
└── README.md
```

---

## For Developers

Want to add offline Whisper transcription and speaker diarization to your own Tauri v2 apps? You can use the standalone plugin and React SDK directly:

### 1. Tauri Plugin (`tauri-plugin-whisper-core`)

Add the Rust crate to your `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-whisper-core = { version = "0.1", features = ["full", "metal"] }
```

Register in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_whisper_core::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

Enable capability in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "core:default",
    "whisper-core:default"
  ]
}
```

### 2. React SDK (`tauri-plugin-whisper-react`)

Install from npm:

```bash
npm install tauri-plugin-whisper-react @tauri-apps/api
```

Use in React components:

```tsx
import { useWhisper, useDiarization, useRecording } from 'tauri-plugin-whisper-react';

export function MeetingRecorder() {
  const { isRunning, start, stop, segments, partialText } = useWhisper();
  const { profiles, renameProfile } = useDiarization();

  return (
    <div>
      <button onClick={() => (isRunning ? stop() : start())}>
        {isRunning ? 'Stop' : 'Start'}
      </button>
      <p>{partialText}</p>
      {segments.map((s, idx) => (
        <div key={idx}>[{s.speaker_id}]: {s.text}</div>
      ))}
    </div>
  );
}
```

---

## Local Development & Building

### Prerequisites

- **macOS** 13.0+ (Apple Silicon recommended)
- **Xcode Command Line Tools:** `xcode-select --install`
- **Rust:** `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js:** v20+

### Setup & Run

```bash
# 1. Clone repository
git clone https://github.com/bishoku/whisper-meeting-assistant.git
cd whisper-meeting-assistant

# 2. Install workspace dependencies
npm install

# 3. Build SDK
npm run build:sdk

# 4. Run Desktop App in development mode
npm run dev
```

### Run Tests

```bash
# Run all 12 plugin tests (Whisper, VAD, Diarization, Merger)
npm run test:plugin
```

---

## License

This project is open-source under the [MIT License](LICENSE).
