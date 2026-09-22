import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  AudioSource,
  BackendType,
  CapturableApp,
  DiarizedResultPayload,
  DiarizedSegmentPayload,
  DownloadedModelsInfo,
  LanguageMode,
  LatencyMode,
  PartialResultPayload,
  RecordingMode,
  RecordingInfo,
  RecordingTranscript,
} from '../types';

export function useTauriWhisper() {
  // Session & Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [statusText, setStatusText] = useState('Modeller taranıyor...');
  const [statusType, setStatusType] = useState<'idle' | 'loading' | 'recording' | 'ready' | 'error'>('loading');
  const [meetingDuration, setMeetingDuration] = useState(0);

  // Mode: 'live' = anlık STT stream | 'record' = diske kaydet, sonra çevir
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('live');

  // Disk-recording state (only used in 'record' mode)
  const [isDiskRecording, setIsDiskRecording] = useState(false);
  const [diskRecordingInfo, setDiskRecordingInfo] = useState<RecordingInfo | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [offlineTranscript, setOfflineTranscript] = useState<RecordingTranscript | null>(null);

  // Transcription
  const [segments, setSegments] = useState<DiarizedSegmentPayload[]>([]);
  const [partialText, setPartialText] = useState<string>('');
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  // Speaker Customization Map (e.g. {"speaker_0": "Ahmet", "Sen": "Barış"})
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('whisper_speaker_map');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Settings & Model Config
  const [backend, setBackend] = useState<BackendType>('whisper');
  const [selectedWhisperModel, setSelectedWhisperModel] = useState('large-v3-turbo');


  const [vadEnabled, setVadEnabled] = useState(true);
  const [diarizationEnabled, setDiarizationEnabled] = useState(true);
  const [diarizationThreshold, setDiarizationThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('whisper_diarization_threshold');
    return saved ? parseFloat(saved) : 0.70;
  });
  const [audioSource, setAudioSource] = useState<AudioSource>('sck');
  const [selectedAppBundleId, setSelectedAppBundleId] = useState('');
  const [language, setLanguageState] = useState<LanguageMode>(() => {
    const saved = localStorage.getItem('whisper_language');
    return (saved as LanguageMode) || 'tr';
  });

  const setLanguage = useCallback((val: LanguageMode) => {
    setLanguageState(val);
    try {
      localStorage.setItem('whisper_language', val);
    } catch {
      // ignore
    }
  }, []);

  const [latencyMode, setLatencyMode] = useState<LatencyMode>(() => {
    const saved = localStorage.getItem('whisper_latency_mode');
    return (saved === 'low_latency' ? 'low_latency' : 'balanced');
  });

  const updateLatencyMode = useCallback((val: LatencyMode) => {
    setLatencyMode(val);
    try {
      localStorage.setItem('whisper_latency_mode', val);
    } catch {
      // ignore
    }
  }, []);

  // Discovered Models & Apps
  const [modelsInfo, setModelsInfo] = useState<DownloadedModelsInfo | null>(null);
  const [capturableApps, setCapturableApps] = useState<CapturableApp[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadingTarget, setDownloadingTarget] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const speakerActiveTimeoutRef = useRef<number | null>(null);
  // Ref so the event listener (mounted once) can always read the live value
  const isDiskRecordingRef = useRef(false);

  // Update diarization threshold dynamically
  const updateDiarizationThreshold = useCallback((val: number) => {
    setDiarizationThreshold(val);
    try {
      localStorage.setItem('whisper_diarization_threshold', val.toString());
      invoke('plugin:whisper|set_diarization_threshold', { threshold: val }).catch(console.error);
    } catch {
      // ignore
    }
  }, []);

  // Save speaker map to localStorage and sync with backend profile
  const renameSpeaker = useCallback(async (id: string, newName: string) => {
    const trimmed = newName.trim() || id;
    setSpeakerMap(prev => {
      const updated = { ...prev, [id]: trimmed };
      try {
        localStorage.setItem('whisper_speaker_map', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    if (id.startsWith('speaker_')) {
      const num = parseInt(id.replace('speaker_', ''), 10);
      if (!isNaN(num)) {
        try {
          await invoke('plugin:whisper|rename_voice_profile', { speakerId: num, name: trimmed });
        } catch (err) {
          console.warn('Failed to rename voice profile in backend:', err);
        }
      }
    }
  }, []);

  const deleteSpeaker = useCallback(async (id: string) => {
    try {
      // If it's a numeric speaker ID (e.g., speaker_0), tell backend to delete the profile
      if (id.startsWith('speaker_')) {
        const num = parseInt(id.replace('speaker_', ''), 10);
        if (!isNaN(num)) {
          await invoke('plugin:whisper|delete_voice_profile', { speakerId: num });
        }
      }
      // Remove from frontend map
      setSpeakerMap(prev => {
        const next = { ...prev };
        delete next[id];
        localStorage.setItem('whisper_speaker_map', JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.error('Failed to delete speaker profile:', err);
    }
  }, []);

  const clearVoiceProfiles = useCallback(async () => {
    try {
      await invoke('plugin:whisper|clear_voice_profiles');
      setSpeakerMap({});
      localStorage.removeItem('whisper_speaker_map');
    } catch (err) {
      console.error('Failed to clear voice profiles:', err);
    }
  }, []);

  const getVoiceProfiles = useCallback(async () => {
    try {
      const profiles = await invoke<{ id: number; name?: string | null; sample_count: number; is_verified: boolean }[]>('plugin:whisper|get_voice_profiles');
      // Hydrate custom names from backend persistent profiles
      setSpeakerMap(prev => {
        let changed = false;
        const next = { ...prev };
        for (const p of profiles) {
          const sId = `speaker_${p.id}`;
          if (p.name && (!next[sId] || next[sId] === sId)) {
            next[sId] = p.name;
            changed = true;
          }
        }
        if (changed) {
          try {
            localStorage.setItem('whisper_speaker_map', JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return changed ? next : prev;
      });
      return profiles;
    } catch (err) {
      console.error('Failed to get voice profiles:', err);
      return [];
    }
  }, []);

  // Merge source speaker into target speaker (e.g. merge duplicate speaker_1 into speaker_0)
  const mergeSpeakers = useCallback(async (sourceSpeakerId: string, targetSpeakerId: string) => {
    if (sourceSpeakerId === targetSpeakerId) return;
    try {
      await invoke('plugin:whisper|merge_speakers', {
        sourceSpeaker: sourceSpeakerId,
        targetSpeaker: targetSpeakerId,
      });
    } catch (e) {
      console.warn('Backend merge_speakers failed:', e);
    }

    setSegments(prev =>
      prev.map(s => (s.speaker_id === sourceSpeakerId ? { ...s, speaker_id: targetSpeakerId } : s))
    );

    setSpeakerMap(prev => {
      const updated = { ...prev };
      if (!updated[targetSpeakerId] && updated[sourceSpeakerId]) {
        updated[targetSpeakerId] = updated[sourceSpeakerId];
      }
      delete updated[sourceSpeakerId];
      try {
        localStorage.setItem('whisper_speaker_map', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const getSpeakerDisplayName = useCallback((id: string) => {
    return speakerMap[id] || (id === 'Sen' ? 'Sen (Sen)' : id);
  }, [speakerMap]);

  // Discover models on startup
  const discoverModels = useCallback(async () => {
    try {
      const info = await invoke<DownloadedModelsInfo>('plugin:whisper|get_downloaded_models');
      setModelsInfo(info);

      // Auto-select best available model
      if (info.whisper_models && info.whisper_models.length > 0) {
        const found = info.whisper_models.find(m => m.id === selectedWhisperModel);
        if (!found) {
          setSelectedWhisperModel(info.whisper_models[0].id);
        }
      }

      setStatusText('Modeller hazır — "Yükle" butonuna tıklayın');
      setStatusType('ready');
    } catch (err) {
      console.warn('get_downloaded_models failed:', err);
      setStatusText('Modeller taranamadı: ' + String(err));
      setStatusType('error');
    }
  }, [selectedWhisperModel]);

  // Fetch running applications for SCK
  const refreshCapturableApps = useCallback(async () => {
    try {
      const apps = await invoke<CapturableApp[]>('plugin:whisper|list_capturable_apps');
      setCapturableApps(apps);
      if (apps.length > 0 && !selectedAppBundleId) {
        // Default to first meeting app or Chrome
        const best = apps.find(a => a.is_meeting_app) || apps.find(a => a.name.includes('Chrome')) || apps[0];
        setSelectedAppBundleId(best.bundle_id);
      }
    } catch (err) {
      console.warn('list_capturable_apps failed:', err);
    }
  }, [selectedAppBundleId]);

  const requestScreenCapturePermission = useCallback(async () => {
    try {
      const granted = await invoke<boolean>('plugin:whisper|request_screen_capture_permission');
      if (granted) {
        refreshCapturableApps();
      }
    } catch (err) {
      console.error('request_screen_capture_permission failed:', err);
    }
  }, [refreshCapturableApps]);

  // Downloads
  const downloadModel = useCallback(async (target: 'whisper' | 'qwen' | 'vad' | 'diarization', modelId?: string) => {
    setDownloadingTarget(target);
    setDownloadProgress(0);
    setStatusText(`İndiriliyor: ${target}...`);
    setStatusType('loading');

    try {
      if (target === 'whisper') {
        const id = modelId || selectedWhisperModel;
        await invoke('plugin:whisper|download_model', { modelId: id });
      } else if (target === 'vad') {
        await invoke('plugin:whisper|download_silero_vad_model');
      } else if (target === 'diarization') {
        await invoke('plugin:whisper|download_diarization_models');
      }
      await discoverModels();
      setStatusText(`✅ ${target.toUpperCase()} başarıyla indirildi`);
      setStatusType('ready');
    } catch (err) {
      setStatusText(`❌ İndirme hatası: ${String(err)}`);
      setStatusType('error');
    } finally {
      setDownloadingTarget(null);
      setDownloadProgress(null);
    }
  }, [selectedWhisperModel,  discoverModels]);

  // Load Model into RAM/GPU
  const loadModels = useCallback(async () => {
    setIsLoading(true);
    setStatusText('Modeller belleğe yükleniyor...');
    setStatusType('loading');

    try {
      // 1. Load ASR Model
      if (backend === 'whisper') {
        const modelObj = modelsInfo?.whisper_models.find(m => m.id === selectedWhisperModel);
        if (!modelObj) {
          throw new Error(`Seçili Whisper modeli (${selectedWhisperModel}) henüz indirilmedi.`);
        }
        await invoke('plugin:whisper|load_model', {
          modelPath: modelObj.path,
          useGpu: true,
          backend: 'whisper',
        });
      }


      // 2. Configure VAD
      if (vadEnabled && modelsInfo?.vad_model_path) {
        await invoke('plugin:whisper|load_vad_model', {
          modelPath: modelsInfo.vad_model_path,
        });
      } else {
        await invoke('plugin:whisper|load_vad_model', { modelPath: null });
      }

      // 3. Load Diarization if enabled
      if (diarizationEnabled && modelsInfo?.diarization_model_dir) {
        await invoke('plugin:whisper|load_diarization_model', {
          modelDir: modelsInfo.diarization_model_dir,
          maxSpeakers: 8,
          threshold: diarizationThreshold,
        });
      } else {
        await invoke('plugin:whisper|load_diarization_model', {
          modelDir: null,
          maxSpeakers: 8,
          threshold: null,
        });
      }

      setIsModelLoaded(true);
      setStatusText('✅ Modeller yüklendi — toplantı kaydına hazır');
      setStatusType('ready');
    } catch (err) {
      setStatusText(`❌ Yükleme hatası: ${String(err)}`);
      setStatusType('error');
      setIsModelLoaded(false);
    } finally {
      setIsLoading(false);
    }
  }, [backend, selectedWhisperModel, modelsInfo, vadEnabled, diarizationEnabled, diarizationThreshold]);

  // ── Live STT: Start ──────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (recordingMode === 'record') {
      // Disk-record mode: start writing to WAV, no STT stream
      await startDiskRecording();
      return;
    }

    // Live STT mode (original behaviour)
    try {
      const langParam = language === 'auto' ? null : language;
      await invoke('plugin:whisper|start_stream', {
        context: {
          language: langParam,
          latency_mode: latencyMode,
        },
      });

      if (audioSource === 'mic' || audioSource === 'both') {
        await invoke('start_capture');
      }

      if (audioSource === 'sck' || audioSource === 'both') {
        if (!selectedAppBundleId) {
          throw new Error('Lütfen dinlenecek hedef uygulamayı seçin.');
        }
        await invoke('plugin:whisper|start_sck_capture', {
          bundleId: selectedAppBundleId,
          captureMic: false,
        });
      }

      setIsRecording(true);
      setMeetingDuration(0);
      setStatusText('🔴 Kaydediliyor...');
      setStatusType('recording');
    } catch (err) {
      setStatusText(`❌ Başlatma hatası: ${String(err)}`);
      setStatusType('error');
    }
  }, [recordingMode, language, latencyMode, audioSource, selectedAppBundleId]);

  // ── Live STT: Stop ───────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    if (recordingMode === 'record') {
      await stopDiskRecording();
      return;
    }

    // Live STT mode (original behaviour)
    try {
      if (audioSource === 'mic' || audioSource === 'both') {
        await invoke('stop_capture');
      }
      if (audioSource === 'sck' || audioSource === 'both') {
        await invoke('plugin:whisper|stop_sck_capture');
      }
      await invoke('plugin:whisper|stop_stream');

      setIsRecording(false);
      setPartialText('');
      setActiveSpeakerId(null);
      setStatusText('✅ Toplantı tamamlandı');
      setStatusType('ready');
    } catch (err) {
      setStatusText(`❌ Durdurma hatası: ${String(err)}`);
      setStatusType('error');
    }
  }, [recordingMode, audioSource]);

  // ── Disk Record: Start ────────────────────────────────────────────────────
  // We still need start_stream because start_capture / start_sck_capture
  // use the stream pipeline to route audio. We just suppress the live STT
  // results in the UI (see the diarized-result listener which checks isDiskRecordingRef).
  const startDiskRecording = useCallback(async () => {
    setOfflineTranscript(null);
    setTranscribeProgress(0);

    let streamStarted = false;
    let wavStarted = false;

    try {
      const langParam = language === 'auto' ? null : language;

      // 1. Start the stream — needed for audio capture routing
      await invoke('plugin:whisper|start_stream', {
        context: { language: langParam, latency_mode: latencyMode, record_only: true },
      });
      streamStarted = true;

      // 2. Open the WAV file for disk recording
      await invoke('plugin:whisper|start_recording', {});
      wavStarted = true;

      // 3. Start the audio sources (same as live mode)
      if (audioSource === 'mic' || audioSource === 'both') {
        await invoke('start_capture');
      }
      if (audioSource === 'sck' || audioSource === 'both') {
        if (!selectedAppBundleId) throw new Error('Hedef uygulama seçilmedi.');
        await invoke('plugin:whisper|start_sck_capture', {
          bundleId: selectedAppBundleId,
          captureMic: false,
        });
      }

      setIsDiskRecording(true);
      isDiskRecordingRef.current = true;
      setIsRecording(true);
      setMeetingDuration(0);
      setStatusText('⏺ Ses kaydediliyor (disk)...');
      setStatusType('recording');
    } catch (err) {
      // Clean up whatever was opened so the next attempt doesn't get "already active"
      if (wavStarted) {
        try { await invoke('plugin:whisper|stop_recording'); } catch { /* ignore */ }
      }
      if (streamStarted) {
        try { await invoke('plugin:whisper|stop_stream'); } catch { /* ignore */ }
      }
      setStatusText(`❌ Kayıt başlatılamadı: ${String(err)}`);
      setStatusType('error');
    }
  }, [audioSource, selectedAppBundleId, language, latencyMode]);

  // ── Disk Record: Stop ─────────────────────────────────────────────────────
  const stopDiskRecording = useCallback(async () => {
    try {
      if (audioSource === 'mic' || audioSource === 'both') {
        await invoke('stop_capture');
      }
      if (audioSource === 'sck' || audioSource === 'both') {
        await invoke('plugin:whisper|stop_sck_capture');
      }

      // Stop stream first (flushes any buffered audio) then finalize WAV
      await invoke('plugin:whisper|stop_stream');
      const info = await invoke<RecordingInfo>('plugin:whisper|stop_recording');

      setDiskRecordingInfo(info);
      setIsDiskRecording(false);
      isDiskRecordingRef.current = false;
      setIsRecording(false);
      setPartialText('');
      setActiveSpeakerId(null);
      setStatusText(`✅ Kayıt tamamlandı — ${(info.duration_ms / 60000).toFixed(1)} dakika`);
      setStatusType('ready');
    } catch (err) {
      setStatusText(`❌ Kayıt durdurulamadı: ${String(err)}`);
      setStatusType('error');
    }
  }, [audioSource]);

  // ── Disk Record: Transcribe ───────────────────────────────────────────────
  const createTranscript = useCallback(async () => {
    if (!diskRecordingInfo) return;
    setIsTranscribing(true);
    setTranscribeProgress(0);
    setStatusText('🔄 Transcript oluşturuluyor...');
    setStatusType('loading');

    // Listen for progress events
    const { listen: tauriListen } = await import('@tauri-apps/api/event');
    const unlisten = await tauriListen<{ percent: number }>(
      'whisper-recording-transcribe-progress',
      (e) => setTranscribeProgress(Math.round(e.payload.percent)),
    );

    try {
      const langParam = language === 'auto' ? null : language;
      const result = await invoke<RecordingTranscript>('plugin:whisper|transcribe_recording', {
        recordingPath: diskRecordingInfo.path,
        language: langParam,
      });
      setOfflineTranscript(result);
      setStatusText(`✅ Transcript hazır — ${result.segments.length} segment, ${result.num_speakers} konuşmacı`);
      setStatusType('ready');
    } catch (err) {
      setStatusText(`❌ Transcript hatası: ${String(err)}`);
      setStatusType('error');
    } finally {
      unlisten();
      setIsTranscribing(false);
      setTranscribeProgress(0);
    }
  }, [diskRecordingInfo, language]);

  // ── Disk Record: Dismiss / Reset ──────────────────────────────────────────
  const dismissOfflineTranscript = useCallback(() => {
    setOfflineTranscript(null);
    setDiskRecordingInfo(null);
  }, []);

  const clearTranscript = useCallback(() => {
    setSegments([]);
    setPartialText('');
    setMeetingDuration(0);
  }, []);

  // Timer Effect
  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setMeetingDuration(d => d + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Tauri Event Listeners (mounted once)
  useEffect(() => {
    let isMounted = true;
    const unlistens: (() => void)[] = [];

    async function setupListeners() {
      try {
        const uPartial = await listen<PartialResultPayload>('whisper-partial-result', event => {
          if (!isMounted) return;
          if (isDiskRecordingRef.current) return; // suppress in disk mode
          setPartialText(event.payload.text);
        });
        if (isMounted) unlistens.push(uPartial);
        else uPartial();

        const uDiarized = await listen<DiarizedResultPayload>('whisper-diarized-result', event => {
          if (!isMounted) return;
          // In disk-recording mode the stream is only used for audio routing;
          // suppress live STT results so they don't pollute the transcript feed.
          if (isDiskRecordingRef.current) return;
          setPartialText('');
          if (event.payload.segments && event.payload.segments.length > 0) {
            const newSegs = event.payload.segments;
            const lastSpeaker = newSegs[newSegs.length - 1].speaker_id;
            setActiveSpeakerId(lastSpeaker);

            // Clear active speaker pulse after 4s
            if (speakerActiveTimeoutRef.current) clearTimeout(speakerActiveTimeoutRef.current);
            speakerActiveTimeoutRef.current = window.setTimeout(() => {
              setActiveSpeakerId(null);
            }, 4000);

            // Deduplicate incoming segments
            setSegments(prev => {
              const updated = [...prev];
              for (const seg of newSegs) {
                const isDup = updated.some(
                  existing =>
                    existing.speaker_id === seg.speaker_id &&
                    Math.abs(existing.start_ms - seg.start_ms) < 500 &&
                    existing.text.trim() === seg.text.trim()
                );
                if (!isDup && seg.text.trim().length > 0) {
                  updated.push(seg);
                }
              }
              return updated;
            });
          }
        });
        if (isMounted) unlistens.push(uDiarized);
        else uDiarized();

        const uProgress = await listen<{ percent: number }>('whisper-download-progress', event => {
          if (!isMounted) return;
          setDownloadProgress(event.payload.percent);
        });
        if (isMounted) unlistens.push(uProgress);
        else uProgress();
      } catch (err) {
        console.error('Failed to setup Tauri event listeners:', err);
      }
    }

    setupListeners();
    discoverModels();
    refreshCapturableApps();
    getVoiceProfiles();

    return () => {
      isMounted = false;
      unlistens.forEach(u => {
        try { u(); } catch { /* ignore */ }
      });
      if (speakerActiveTimeoutRef.current) clearTimeout(speakerActiveTimeoutRef.current);
    };
  }, []); // Run ONCE on mount!

  return {
    // Session State
    isRecording,
    isLoading,
    isModelLoaded,
    statusText,
    statusType,
    meetingDuration,

    // Recording mode
    recordingMode,
    setRecordingMode,

    // Disk-recording state (record mode)
    isDiskRecording,
    diskRecordingInfo,
    isTranscribing,
    transcribeProgress,
    offlineTranscript,
    createTranscript,
    dismissOfflineTranscript,

    // Transcription & Speakers
    segments,
    partialText,
    activeSpeakerId,
    speakerMap,
    renameSpeaker,
    deleteSpeaker,
    clearVoiceProfiles,
    getVoiceProfiles,
    mergeSpeakers,
    getSpeakerDisplayName,
    clearTranscript,

    // Controls
    startRecording,
    stopRecording,
    loadModels,
    downloadModel,
    refreshCapturableApps,
    requestScreenCapturePermission,

    // Settings
    backend,
    setBackend,
    selectedWhisperModel,
    setSelectedWhisperModel,
    vadEnabled,
    setVadEnabled,
    diarizationEnabled,
    setDiarizationEnabled,
    diarizationThreshold,
    updateDiarizationThreshold,
    audioSource,
    setAudioSource,
    selectedAppBundleId,
    setSelectedAppBundleId,
    language,
    setLanguage,
    latencyMode,
    updateLatencyMode,

    // Metadata
    modelsInfo,
    capturableApps,
    downloadProgress,
    downloadingTarget,
  };
}
