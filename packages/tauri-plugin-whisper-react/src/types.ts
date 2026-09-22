export type AudioChannel = 'Mic' | 'System';

export interface AudioContext {
  language?: string;
}

export interface SegmentPayload {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface DiarizedSegmentPayload {
  speaker_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  channel?: AudioChannel;
}

export interface DiarizedResultPayload {
  segments: DiarizedSegmentPayload[];
  processing_time_ms: number;
  num_speakers: number;
}

export interface PartialResultPayload {
  text: string;
  segment_index?: number;
  start_ms?: number;
  end_ms?: number;
  is_partial?: boolean;
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

export interface DownloadedWhisperModel {
  id: string;
  path: string;
}

export interface DownloadedModelsInfo {
  whisper_models: DownloadedWhisperModel[];
  vad_model_path: string | null;
  diarization_model_dir: string | null;
}

export interface CapturableApp {
  name: string;
  bundle_id: string;
  is_meeting_app: boolean;
}

export interface VoiceProfile {
  id: number;
  name?: string | null;
  sample_count: number;
  is_verified: boolean;
}

export interface RecordingInfo {
  path: string;
  duration_ms: number;
  size_bytes: number;
  created_at: number;
}

export interface RecordingTranscriptSegment {
  speaker_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface RecordingTranscript {
  segments: RecordingTranscriptSegment[];
  duration_ms: number;
  processing_time_ms: number;
  num_speakers: number;
}

export interface RecordingTranscribeProgressPayload {
  processed_ms: number;
  total_ms: number;
  percent: number;
}

export type BackendType = 'whisper' | 'qwen3-asr';
export type LanguageMode = 'auto' | 'tr' | 'en';
export type LatencyMode = 'balanced' | 'low_latency';
export type AudioSource = 'mic' | 'sck' | 'both';
export type RecordingMode = 'live' | 'record';
