export type AudioChannel = 'Mic' | 'System';

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
  channel: AudioChannel;
}

export interface DiarizedResultPayload {
  segments: DiarizedSegmentPayload[];
  processing_time_ms: number;
  num_speakers: number;
}

export interface PartialResultPayload {
  text: string;
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

export type AudioSource = 'mic' | 'sck' | 'both';
export type BackendType = 'whisper';
export type LanguageMode = 'auto' | 'tr' | 'en';
export type LatencyMode = 'balanced' | 'low_latency';

/** Whether the user wants live STT or disk-record-then-transcribe. */
export type RecordingMode = 'live' | 'record';

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

export interface MeetingSpeaker {
  id: string;          // e.g. "Sen", "speaker_0", "Katılımcı"
  displayName: string; // e.g. "Ahmet", "Sen", etc.
  channel: AudioChannel;
  color: string;
  isYou: boolean;
  totalWords: number;
  lastActiveMs: number;
}

export interface SavedMeeting {
  id: string;
  title: string;
  createdAt: string; // ISO date string
  durationMs: number;
  segments: {
    speaker_id: string;
    text: string;
    start_ms: number;
    end_ms: number;
    channel?: AudioChannel;
  }[];
  audioSource?: string;
  speakers: string[];
  wavPath?: string;
}
