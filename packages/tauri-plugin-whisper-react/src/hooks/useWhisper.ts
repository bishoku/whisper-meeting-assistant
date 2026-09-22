import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  AudioContext,
  DiarizedSegmentPayload,
  DownloadedModelsInfo,
  DownloadProgressPayload,
  BackendType,
} from '../types';
import * as api from '../api';

export interface UseWhisperOptions {
  autoLoadDownloadedModels?: boolean;
}

export function useWhisper(options: UseWhisperOptions = {}) {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [partialText, setPartialText] = useState('');
  const [segments, setSegments] = useState<DiarizedSegmentPayload[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressPayload | null>(null);
  const [modelsInfo, setModelsInfo] = useState<DownloadedModelsInfo | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const info = await api.getDownloadedModels();
      if (isMountedRef.current) {
        setModelsInfo(info);
      }
      return info;
    } catch (err) {
      console.error('Failed to get downloaded models:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (options.autoLoadDownloadedModels !== false) {
      refreshModels();
    }
  }, [options.autoLoadDownloadedModels, refreshModels]);

  // Set up event listeners
  useEffect(() => {
    let unlistenPartial: (() => void) | undefined;
    let unlistenFinal: (() => void) | undefined;
    let unlistenDiarized: (() => void) | undefined;
    let unlistenDownload: (() => void) | undefined;
    let unlistenStop: (() => void) | undefined;

    const setup = async () => {
      unlistenPartial = await api.onPartialResult((payload) => {
        setPartialText(payload.text);
      });

      unlistenDiarized = await api.onDiarizedResult((payload) => {
        setPartialText('');
        setSegments((prev) => [...prev, ...payload.segments]);
      });

      unlistenFinal = await api.onFinalResult((payload) => {
        setPartialText('');
        // If diarization is not active, convert FinalResultPayload segments
        setSegments((prev) => {
          const newSegs: DiarizedSegmentPayload[] = payload.segments.map((s) => ({
            speaker_id: 'Speaker',
            text: s.text,
            start_ms: s.start_ms,
            end_ms: s.end_ms,
          }));
          return [...prev, ...newSegs];
        });
      });

      unlistenDownload = await api.onDownloadProgress((payload) => {
        setDownloadProgress(payload);
        if (payload.percent >= 100) {
          setTimeout(() => {
            if (isMountedRef.current) setDownloadProgress(null);
            refreshModels();
          }, 800);
        }
      });

      unlistenStop = await api.onStreamStopped(() => {
        setIsRunning(false);
      });
    };

    setup();

    return () => {
      unlistenPartial?.();
      unlistenFinal?.();
      unlistenDiarized?.();
      unlistenDownload?.();
      unlistenStop?.();
    };
  }, [refreshModels]);

  const start = useCallback(async (context?: AudioContext) => {
    setIsLoading(true);
    try {
      await api.startStream(context);
      setIsRunning(true);
      setPartialText('');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setIsLoading(true);
    try {
      await api.stopStream();
      setIsRunning(false);
      setPartialText('');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const load = useCallback(async (modelPath: string, useGpu: boolean = true, backend: BackendType = 'whisper') => {
    setIsLoading(true);
    try {
      await api.loadModel(modelPath, useGpu, backend);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const download = useCallback(async (modelId: string) => {
    setIsLoading(true);
    try {
      const path = await api.downloadModel(modelId);
      await refreshModels();
      return path;
    } finally {
      setIsLoading(false);
    }
  }, [refreshModels]);

  const clearSegments = useCallback(() => {
    setSegments([]);
    setPartialText('');
  }, []);

  return {
    isRunning,
    isLoading,
    partialText,
    segments,
    downloadProgress,
    modelsInfo,
    start,
    stop,
    load,
    download,
    refreshModels,
    clearSegments,
  };
}
