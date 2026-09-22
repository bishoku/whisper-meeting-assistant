import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ================= Types =================

export interface AudioContext {
  language?: string;
}

export interface SegmentPayload {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface PartialResultPayload {
  text: string;
  segment_index: number;
  start_ms: number;
  end_ms: number;
  is_partial: boolean;
}

export interface FinalResultPayload {
  segments: SegmentPayload[];
  processing_time_ms: number;
}

export interface DownloadProgressPayload {
  model_id: string;
  downloaded: number;
  total: number;
  percent: number;
}

export interface DiarizedSegmentPayload {
  speaker_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface DiarizedResultPayload {
  segments: DiarizedSegmentPayload[];
  processing_time_ms: number;
  num_speakers: number;
}

// ── Record-then-transcribe types ──────────────────────────────────────────────

/** Metadata returned by startRecording / stopRecording / listRecordings. */
export interface RecordingInfo {
  /** Absolute path to the .wav file on disk. */
  path: string;
  /** Duration of the recording in milliseconds. */
  duration_ms: number;
  /** File size in bytes (~110 MB per hour). */
  size_bytes: number;
  /** Unix timestamp (seconds) of the recording file. */
  created_at: number;
}

/** A single speaker-attributed segment in the offline transcript. */
export interface RecordingTranscriptSegment {
  /**
   * Speaker label assigned by Pyannote, e.g. "speaker_1", "speaker_2", …
   * "speaker_unknown" is used when diarization is not loaded.
   */
  speaker_id: string;
  text: string;
  /** Offset from the start of the recording, in milliseconds. */
  start_ms: number;
  end_ms: number;
}

/** Full transcript returned by transcribeRecording(). */
export interface RecordingTranscript {
  segments: RecordingTranscriptSegment[];
  /** Total duration of the source recording in milliseconds. */
  duration_ms: number;
  /** Wall-clock time spent in transcription, in milliseconds. */
  processing_time_ms: number;
  /** Number of distinct speakers detected. */
  num_speakers: number;
}

/** Emitted periodically during transcribeRecording() to track progress. */
export interface RecordingTranscribeProgressPayload {
  /** How many milliseconds of audio have been processed so far. */
  processed_ms: number;
  /** Total duration of the recording in milliseconds. */
  total_ms: number;
  /** Percentage complete (0.0–100.0). */
  percent: number;
}

// ================= Streaming Commands =================

export async function loadModel(
  modelPath: string,
  useGpu: boolean = true,
  backend: 'whisper' | 'qwen3-asr' = 'whisper',
): Promise<void> {
  return invoke('plugin:whisper|load_model', {
    modelPath,
    useGpu,
    backend,
  });
}

export async function startStream(context?: AudioContext): Promise<void> {
  return invoke('plugin:whisper|start_stream', { context });
}

export async function pushAudioChunk(samples: number[]): Promise<void> {
  return invoke('plugin:whisper|push_audio_chunk', { samples });
}

export async function stopStream(): Promise<void> {
  return invoke('plugin:whisper|stop_stream');
}

export async function downloadModel(modelId: string): Promise<string> {
  return invoke('plugin:whisper|download_model', { modelId });
}

export async function listBackends(): Promise<string[]> {
  return invoke('plugin:whisper|list_backends');
}

export async function downloadQwen3Model(): Promise<string> {
  return invoke('plugin:whisper|download_qwen3_model');
}

export async function downloadDiarizationModels(): Promise<string> {
  return invoke('plugin:whisper|download_diarization_models');
}

export async function loadDiarizationModel(
  modelDir: string,
  maxSpeakers: number = 8,
): Promise<void> {
  return invoke('plugin:whisper|load_diarization_model', {
    modelDir,
    maxSpeakers,
  });
}

// ================= Record-then-Transcribe Commands =================

/**
 * Start recording microphone (or any PCM source) to a WAV file on disk.
 *
 * @param outputPath  Optional absolute path for the .wav file.
 *                    If omitted, a timestamped file is created in
 *                    `<appData>/recordings/`.
 * @returns Absolute path to the file being written.
 *
 * @example
 * ```ts
 * const filePath = await startRecording();
 * // ... call pushRecordingChunk() for each audio chunk ...
 * const info = await stopRecording();
 * ```
 */
export async function startRecording(outputPath?: string): Promise<string> {
  return invoke('plugin:whisper|start_recording', { outputPath });
}

/**
 * Write a chunk of raw PCM f32 samples (16 kHz, mono) to the active recording.
 *
 * Call this alongside (or instead of) pushAudioChunk(). Both can be called
 * in the same audio callback — one writes to disk, the other feeds the
 * live STT worker.
 */
export async function pushRecordingChunk(samples: number[]): Promise<void> {
  return invoke('plugin:whisper|push_recording_chunk', { pcmData: samples });
}

/**
 * Finalize the WAV file and close the recording session.
 *
 * @returns RecordingInfo with path, duration, and file size.
 */
export async function stopRecording(): Promise<RecordingInfo> {
  return invoke('plugin:whisper|stop_recording');
}

/**
 * Transcribe a previously saved WAV file with full speaker diarization.
 *
 * This may take a while for long recordings — use `onRecordingTranscribeProgress`
 * to show a progress bar.
 *
 * Requires: `loadModel()` called before. `loadDiarizationModel()` is optional
 * but strongly recommended for speaker attribution.
 *
 * @param recordingPath Absolute path to a .wav file (returned by stopRecording).
 * @param language      BCP-47 language hint, e.g. "tr", "en". Omit for auto-detect.
 * @returns RecordingTranscript with per-speaker, time-stamped segments.
 *
 * @example
 * ```ts
 * const transcript = await transcribeRecording(info.path, 'tr');
 * for (const seg of transcript.segments) {
 *   console.log(`[${seg.speaker_id}] ${seg.start_ms}ms → ${seg.end_ms}ms: ${seg.text}`);
 * }
 * ```
 */
export async function transcribeRecording(
  recordingPath: string,
  language?: string,
): Promise<RecordingTranscript> {
  return invoke('plugin:whisper|transcribe_recording', {
    recordingPath,
    language,
  });
}

/**
 * List all .wav recordings saved in the app's data directory.
 * Results are sorted newest-first.
 */
export async function listRecordings(): Promise<RecordingInfo[]> {
  return invoke('plugin:whisper|list_recordings');
}

/**
 * Delete a recording file from disk.
 * @param recordingPath Absolute path to the .wav file.
 */
export async function deleteRecording(recordingPath: string): Promise<void> {
  return invoke('plugin:whisper|delete_recording', { recordingPath });
}

// ================= Streaming Event Listeners =================

export async function onPartialResult(
  handler: (payload: PartialResultPayload) => void,
): Promise<UnlistenFn> {
  return listen<PartialResultPayload>('whisper-partial-result', (event) => {
    handler(event.payload);
  });
}

export async function onFinalResult(
  handler: (payload: FinalResultPayload) => void,
): Promise<UnlistenFn> {
  return listen<FinalResultPayload>('whisper-final-result', (event) => {
    handler(event.payload);
  });
}

export async function onDownloadProgress(
  handler: (payload: DownloadProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgressPayload>('whisper-download-progress', (event) => {
    handler(event.payload);
  });
}

export async function onDiarizedResult(
  handler: (payload: DiarizedResultPayload) => void,
): Promise<UnlistenFn> {
  return listen<DiarizedResultPayload>('whisper-diarized-result', (event) => {
    handler(event.payload);
  });
}

export async function onStreamStopped(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen('whisper-stream-stopped', () => {
    handler();
  });
}

// ================= Recording Event Listeners =================

/**
 * Listen for progress events emitted during `transcribeRecording()`.
 *
 * @example
 * ```ts
 * const unlisten = await onRecordingTranscribeProgress((p) => {
 *   setProgress(p.percent);
 * });
 * const transcript = await transcribeRecording(path, 'tr');
 * unlisten();
 * ```
 */
export async function onRecordingTranscribeProgress(
  handler: (payload: RecordingTranscribeProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<RecordingTranscribeProgressPayload>(
    'whisper-recording-transcribe-progress',
    (event) => {
      handler(event.payload);
    },
  );
}
