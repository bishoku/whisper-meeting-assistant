import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  RecordingInfo,
  RecordingTranscript,
  RecordingTranscribeProgressPayload,
} from '../types';
import * as api from '../api';

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [recordingInfo, setRecordingInfo] = useState<RecordingInfo | null>(null);
  const [savedRecordings, setSavedRecordings] = useState<RecordingInfo[]>([]);

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<RecordingTranscribeProgressPayload | null>(null);
  const [transcript, setTranscript] = useState<RecordingTranscript | null>(null);

  const timerRef = useRef<number | null>(null);

  const refreshRecordings = useCallback(async () => {
    try {
      const list = await api.listRecordings();
      setSavedRecordings(list);
      return list;
    } catch (err) {
      console.error('Failed to list recordings:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    refreshRecordings();
  }, [refreshRecordings]);

  // Listen for transcribe progress
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await api.onRecordingTranscribeProgress((payload) => {
        setTranscribeProgress(payload);
      });
    };
    setup();
    return () => {
      unlisten?.();
    };
  }, []);

  const startRecording = useCallback(async (outputPath?: string) => {
    const path = await api.startRecording(outputPath);
    setIsRecording(true);
    setRecordingDurationMs(0);

    const start = Date.now();
    timerRef.current = window.setInterval(() => {
      setRecordingDurationMs(Date.now() - start);
    }, 200);

    return path;
  }, []);

  const stopRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const info = await api.stopRecording();
      setIsRecording(false);
      setRecordingInfo(info);
      await refreshRecordings();
      return info;
    } catch (err) {
      setIsRecording(false);
      throw err;
    }
  }, [refreshRecordings]);

  const transcribe = useCallback(async (recordingPath: string, language?: string) => {
    setIsTranscribing(true);
    setTranscribeProgress({ processed_ms: 0, total_ms: 0, percent: 0 });
    try {
      const result = await api.transcribeRecording(recordingPath, language);
      setTranscript(result);
      return result;
    } finally {
      setIsTranscribing(false);
      setTranscribeProgress(null);
    }
  }, []);

  const deleteRecording = useCallback(async (recordingPath: string) => {
    await api.deleteRecording(recordingPath);
    await refreshRecordings();
  }, [refreshRecordings]);

  return {
    isRecording,
    recordingDurationMs,
    recordingInfo,
    savedRecordings,
    isTranscribing,
    transcribeProgress,
    transcript,
    startRecording,
    stopRecording,
    transcribe,
    refreshRecordings,
    deleteRecording,
  };
}
