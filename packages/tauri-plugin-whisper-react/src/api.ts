import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AudioContext,
  CapturableApp,
  DiarizedResultPayload,
  DownloadedModelsInfo,
  DownloadProgressPayload,
  FinalResultPayload,
  PartialResultPayload,
  RecordingInfo,
  RecordingTranscript,
  RecordingTranscribeProgressPayload,
  VoiceProfile,
  BackendType,
} from './types';

// ================= Streaming & Model Commands =================

export async function loadModel(
  modelPath: string,
  useGpu: boolean = true,
  backend: BackendType = 'whisper',
): Promise<void> {
  return invoke('plugin:whisper-core|load_model', {
    modelPath,
    useGpu,
    backend,
  });
}

export async function startStream(context?: AudioContext): Promise<void> {
  return invoke('plugin:whisper-core|start_stream', { context });
}

export async function pushAudioChunk(samples: number[]): Promise<void> {
  return invoke('plugin:whisper-core|push_audio_chunk', { samples });
}

export async function stopStream(): Promise<void> {
  return invoke('plugin:whisper-core|stop_stream');
}

export async function downloadModel(modelId: string): Promise<string> {
  return invoke('plugin:whisper-core|download_model', { modelId });
}

export async function downloadSileroVadModel(): Promise<string> {
  return invoke('plugin:whisper-core|download_silero_vad_model');
}

export async function loadVadModel(modelPath: string | null = null): Promise<void> {
  return invoke('plugin:whisper-core|load_vad_model', { modelPath });
}

export async function downloadDiarizationModels(): Promise<string> {
  return invoke('plugin:whisper-core|download_diarization_models');
}

export async function loadDiarizationModel(
  modelDir: string,
  maxSpeakers: number = 8,
): Promise<void> {
  return invoke('plugin:whisper-core|load_diarization_model', {
    modelDir,
    maxSpeakers,
  });
}

export async function setDiarizationThreshold(threshold: number): Promise<void> {
  return invoke('plugin:whisper-core|set_diarization_threshold', { threshold });
}

export async function getDownloadedModels(): Promise<DownloadedModelsInfo> {
  return invoke('plugin:whisper-core|get_downloaded_models');
}

export async function listBackends(): Promise<string[]> {
  return invoke('plugin:whisper-core|list_backends');
}

export async function downloadQwen3Model(): Promise<string> {
  return invoke('plugin:whisper-core|download_qwen3_model');
}

// ================= Voice Profile & Speaker Commands =================

export async function getVoiceProfiles(): Promise<VoiceProfile[]> {
  return invoke('plugin:whisper-core|get_voice_profiles');
}

export async function renameVoiceProfile(speakerId: number, name: string): Promise<void> {
  return invoke('plugin:whisper-core|rename_voice_profile', { speakerId, name });
}

export async function deleteVoiceProfile(speakerId: number): Promise<void> {
  return invoke('plugin:whisper-core|delete_voice_profile', { speakerId });
}

export async function clearVoiceProfiles(): Promise<void> {
  return invoke('plugin:whisper-core|clear_voice_profiles');
}

export async function mergeSpeakers(targetSpeakerId: number, sourceSpeakerId: number): Promise<void> {
  return invoke('plugin:whisper-core|merge_speakers', { targetSpeakerId, sourceSpeakerId });
}

// ================= ScreenCaptureKit System Audio Commands =================

export async function checkScreenCapturePermission(): Promise<boolean> {
  return invoke('plugin:whisper-core|check_screen_capture_permission');
}

export async function requestScreenCapturePermission(): Promise<boolean> {
  return invoke('plugin:whisper-core|request_screen_capture_permission');
}

export async function listCapturableApps(): Promise<CapturableApp[]> {
  return invoke('plugin:whisper-core|list_capturable_apps');
}

export async function startSckCapture(bundleId?: string): Promise<void> {
  return invoke('plugin:whisper-core|start_sck_capture', { bundleId });
}

export async function stopSckCapture(): Promise<void> {
  return invoke('plugin:whisper-core|stop_sck_capture');
}

// ================= Record-then-Transcribe Commands =================

export async function startRecording(outputPath?: string): Promise<string> {
  return invoke('plugin:whisper-core|start_recording', { outputPath });
}

export async function pushRecordingChunk(samples: number[]): Promise<void> {
  return invoke('plugin:whisper-core|push_recording_chunk', { pcmData: samples });
}

export async function stopRecording(): Promise<RecordingInfo> {
  return invoke('plugin:whisper-core|stop_recording');
}

export async function transcribeRecording(
  recordingPath: string,
  language?: string,
): Promise<RecordingTranscript> {
  return invoke('plugin:whisper-core|transcribe_recording', {
    recordingPath,
    language,
  });
}

export async function listRecordings(): Promise<RecordingInfo[]> {
  return invoke('plugin:whisper-core|list_recordings');
}

export async function deleteRecording(recordingPath: string): Promise<void> {
  return invoke('plugin:whisper-core|delete_recording', { recordingPath });
}

// ================= Event Listeners =================

export async function onPartialResult(
  handler: (payload: PartialResultPayload) => void,
): Promise<UnlistenFn> {
  return listen<PartialResultPayload>('whisper-core-partial-result', (event) => {
    handler(event.payload);
  });
}

export async function onFinalResult(
  handler: (payload: FinalResultPayload) => void,
): Promise<UnlistenFn> {
  return listen<FinalResultPayload>('whisper-core-final-result', (event) => {
    handler(event.payload);
  });
}

export async function onDiarizedResult(
  handler: (payload: DiarizedResultPayload) => void,
): Promise<UnlistenFn> {
  return listen<DiarizedResultPayload>('whisper-core-diarized-result', (event) => {
    handler(event.payload);
  });
}

export async function onDownloadProgress(
  handler: (payload: DownloadProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgressPayload>('whisper-core-download-progress', (event) => {
    handler(event.payload);
  });
}

export async function onStreamStopped(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen('whisper-core-stream-stopped', () => {
    handler();
  });
}

export async function onRecordingTranscribeProgress(
  handler: (payload: RecordingTranscribeProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<RecordingTranscribeProgressPayload>(
    'whisper-core-recording-transcribe-progress',
    (event) => {
      handler(event.payload);
    },
  );
}
