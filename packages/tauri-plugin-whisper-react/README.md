# tauri-plugin-whisper-react

Official React SDK and hooks for [tauri-plugin-whisper-core](https://crates.io/crates/tauri-plugin-whisper-core).

Part of the [Whisper Meeting Assistant](https://github.com/bishoku/whisper-meeting-assistant) project.

[![NPM Version](https://img.shields.io/npm/v/tauri-plugin-whisper-react.svg)](https://www.npmjs.com/package/tauri-plugin-whisper-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **`useWhisper()`:** Real-time speech-to-text streaming, model downloading, model loading, and live transcript accumulation with partial/final segments.
- **`useDiarization()`:** Multi-speaker management, speaker renaming, merging, profile clearing, and similarity threshold tuning.
- **`useRecording()`:** Meeting WAV audio recorder, recording timer, and offline speaker-attributed transcription with a progress bar.
- **`useSystemAudio()`:** macOS ScreenCaptureKit permissions, list capturable meeting applications (Zoom, Teams, Meet), and system audio streaming.
- **Low-level Typed API:** Direct typed access to all Tauri IPC commands and event listeners.

---

## Installation

```bash
npm install tauri-plugin-whisper-react @tauri-apps/api
# or
pnpm add tauri-plugin-whisper-react @tauri-apps/api
```

Make sure your Tauri backend includes `tauri-plugin-whisper-core` in `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-whisper-core = { version = "0.1", features = ["full", "metal"] }
```

and has permission enabled in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "core:default",
    "whisper-core:default"
  ]
}
```

---

## Quick Start (React Hooks)

### 1. Live Streaming Transcription

```tsx
import React from 'react';
import { useWhisper } from 'tauri-plugin-whisper-react';

export function LiveTranscription() {
  const { isRunning, start, stop, partialText, segments } = useWhisper();

  return (
    <div>
      <button onClick={() => (isRunning ? stop() : start())}>
        {isRunning ? 'Stop Listening' : 'Start Listening'}
      </button>

      {partialText && <p style={{ color: 'gray' }}>{partialText}</p>}

      <div>
        {segments.map((seg, idx) => (
          <div key={idx}>
            <strong>[{seg.speaker_id}]</strong> {seg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 2. Speaker Diarization & Voice Profiles

```tsx
import React from 'react';
import { useDiarization } from 'tauri-plugin-whisper-react';

export function ParticipantManager() {
  const { profiles, renameProfile, deleteProfile } = useDiarization();

  return (
    <ul>
      {profiles.map((p) => (
        <li key={p.id}>
          Speaker #{p.id}: {p.name || 'Unnamed'}
          <button onClick={() => renameProfile(p.id, prompt('New name:') || '')}>
            Rename
          </button>
          <button onClick={() => deleteProfile(p.id)}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
```

### 3. Record-then-Transcribe Offline

```tsx
import React from 'react';
import { useRecording } from 'tauri-plugin-whisper-react';

export function MeetingRecorder() {
  const {
    isRecording,
    recordingDurationMs,
    startRecording,
    stopRecording,
    transcribe,
    isTranscribing,
    transcribeProgress,
    transcript,
  } = useRecording();

  const handleStop = async () => {
    const info = await stopRecording();
    await transcribe(info.path, 'tr');
  };

  return (
    <div>
      {isRecording ? (
        <button onClick={handleStop}>Stop Recording ({(recordingDurationMs / 1000).toFixed(1)}s)</button>
      ) : (
        <button onClick={() => startRecording()}>Start Recording Meeting</button>
      )}

      {isTranscribing && (
        <p>Transcribing: {transcribeProgress?.percent.toFixed(0)}%</p>
      )}

      {transcript && (
        <div>
          <h3>Meeting Transcript:</h3>
          {transcript.segments.map((seg, i) => (
            <p key={i}>[{seg.speaker_id}]: {seg.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## License

MIT License. Copyright (c) 2026 bishoku.
