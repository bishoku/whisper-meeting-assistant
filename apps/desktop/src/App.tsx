import React, { useState, useRef, useEffect } from 'react';
import { useTauriWhisper } from './hooks/useTauriWhisper';
import { Header } from './components/Header';
import { ParticipantBar } from './components/ParticipantBar';
import { TranscriptFeed } from './components/TranscriptFeed';
import { SpeakerRenameModal } from './components/SpeakerRenameModal';
import { SettingsModal } from './components/SettingsModal';
import { ExportModal } from './components/ExportModal';
import { RecordingTranscriptModal } from './components/RecordingTranscriptModal';
import { MeetingHistoryModal } from './components/MeetingHistoryModal';
import { saveMeeting } from './services/meetingStorage';
import { SavedMeeting } from './types';
import { AlertCircle, CheckCircle, Info, Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const whisper = useTauriWhisper();

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);

  // Custom export target (e.g. from history or offline modal)
  const [customExportTarget, setCustomExportTarget] = useState<{
    title: string;
    segments: Array<{ speaker_id: string; text: string; start_ms: number; end_ms: number }>;
    duration: number;
  } | null>(null);

  // Auto-archive completed live meetings
  const prevRecordingRef = useRef(whisper.isRecording);
  useEffect(() => {
    if (prevRecordingRef.current && !whisper.isRecording) {
      if (whisper.segments.length > 0) {
        const uniqueSpeakers = Array.from(new Set(whisper.segments.map(s => s.speaker_id)));
        const dateStr = new Date().toLocaleDateString('tr-TR', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
        saveMeeting({
          title: `Toplantı - ${dateStr}`,
          durationMs: whisper.meetingDuration * 1000,
          segments: whisper.segments,
          audioSource: whisper.audioSource,
          speakers: uniqueSpeakers,
        });
      }
    }
    prevRecordingRef.current = whisper.isRecording;
  }, [whisper.isRecording, whisper.segments, whisper.meetingDuration, whisper.audioSource]);

  // Auto-archive completed offline batch transcripts
  const prevOfflineTranscriptRef = useRef<string | null>(null);
  useEffect(() => {
    if (whisper.offlineTranscript && whisper.offlineTranscript.segments.length > 0) {
      const transcriptKey = `${whisper.offlineTranscript.duration_ms}_${whisper.offlineTranscript.segments.length}`;
      if (prevOfflineTranscriptRef.current !== transcriptKey) {
        prevOfflineTranscriptRef.current = transcriptKey;
        const uniqueSpeakers = Array.from(
          new Set(whisper.offlineTranscript.segments.map(s => s.speaker_id)),
        );
        const dateStr = new Date().toLocaleDateString('tr-TR', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
        saveMeeting({
          title: `Kayıt - ${dateStr}`,
          durationMs: whisper.offlineTranscript.duration_ms,
          segments: whisper.offlineTranscript.segments,
          audioSource: whisper.audioSource,
          speakers: uniqueSpeakers,
          wavPath: whisper.diskRecordingInfo?.path,
        });
      }
    }
  }, [whisper.offlineTranscript, whisper.audioSource, whisper.diskRecordingInfo]);

  // RecordingTranscriptModal: open automatically when disk recording stops
  const isRecordingModalOpen =
    whisper.recordingMode === 'record' &&
    !whisper.isDiskRecording &&
    (whisper.diskRecordingInfo !== null || whisper.offlineTranscript !== null);

  const handleOpenRename = (speakerId: string) => {
    setRenameTargetId(speakerId);
  };

  const handleCloseRename = () => {
    setRenameTargetId(null);
  };

  const handleOpenLiveExport = () => {
    setCustomExportTarget(null);
    setIsExportOpen(true);
  };

  const handleOpenPastMeetingExport = (meeting: SavedMeeting) => {
    setCustomExportTarget({
      title: meeting.title,
      segments: meeting.segments,
      duration: Math.round(meeting.durationMs / 1000),
    });
    setIsExportOpen(true);
  };

  const handleOpenOfflineExport = () => {
    if (whisper.offlineTranscript) {
      setCustomExportTarget({
        title: 'Çevrimdışı Kayıt Transkripti',
        segments: whisper.offlineTranscript.segments,
        duration: Math.round(whisper.offlineTranscript.duration_ms / 1000),
      });
      setIsExportOpen(true);
    }
  };

  // Active export parameters
  const activeExportSegments = customExportTarget ? customExportTarget.segments : whisper.segments;
  const activeExportDuration = customExportTarget ? customExportTarget.duration : whisper.meetingDuration;
  const activeExportTitle = customExportTarget ? customExportTarget.title : 'Toplantı Tutanağı';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-dark-950 text-slate-100 font-sans">
      {/* 1. Header with Controls */}
      <Header
        isRecording={whisper.isRecording}
        isLoading={whisper.isLoading}
        isModelLoaded={whisper.isModelLoaded}
        meetingDuration={whisper.meetingDuration}
        audioSource={whisper.audioSource}
        selectedModel={whisper.selectedWhisperModel}
        vadEnabled={whisper.vadEnabled}
        recordingMode={whisper.recordingMode}
        onSetRecordingMode={whisper.setRecordingMode}
        onStart={whisper.startRecording}
        onStop={whisper.stopRecording}
        onClear={whisper.clearTranscript}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenExport={handleOpenLiveExport}
        onOpenHistory={() => setIsHistoryOpen(true)}
      />

      {/* 2. Top Participants Bar (Teams / Zoom Style) */}
      <ParticipantBar
        segments={whisper.segments}
        activeSpeakerId={whisper.activeSpeakerId}
        speakerMap={whisper.speakerMap}
        getSpeakerDisplayName={whisper.getSpeakerDisplayName}
        onOpenRename={handleOpenRename}
        audioSource={whisper.audioSource}
      />

      {/* 3. Main Transcript & Speech Bubbles Feed */}
      <TranscriptFeed
        segments={whisper.segments}
        partialText={whisper.partialText}
        activeSpeakerId={whisper.activeSpeakerId}
        isRecording={whisper.isRecording}
        getSpeakerDisplayName={whisper.getSpeakerDisplayName}
        onOpenRename={handleOpenRename}
      />

      {/* 4. Bottom Status Bar */}
      <footer className="h-8 px-5 border-t border-slate-800/80 bg-dark-900/80 backdrop-blur-sm flex items-center justify-between text-[11px] text-slate-400 shrink-0 select-none">
        <div className="flex items-center gap-2">
          {whisper.statusType === 'loading' && <Loader2 className="w-3 h-3 text-brand-400 animate-spin" />}
          {whisper.statusType === 'recording' && <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />}
          {whisper.statusType === 'ready' && <CheckCircle className="w-3 h-3 text-emerald-400" />}
          {whisper.statusType === 'error' && <AlertCircle className="w-3 h-3 text-rose-400" />}
          {whisper.statusType === 'idle' && <Info className="w-3 h-3 text-slate-400" />}
          <span className="truncate max-w-lg font-medium">{whisper.statusText}</span>
        </div>

        <div className="flex items-center gap-4 text-slate-400 font-mono text-[10px]">
          <span>GPU Metal: Aktif</span>
          <span>•</span>
          <span>16 kHz Mono</span>
          <span>•</span>
          <span>v0.2.0</span>
        </div>
      </footer>

      {/* 5. Modals */}
      <SpeakerRenameModal
        isOpen={renameTargetId !== null}
        speakerId={renameTargetId}
        currentName={renameTargetId ? whisper.speakerMap[renameTargetId] || '' : ''}
        availableSpeakers={Array.from(new Set(
          whisper.segments.map(s => s.speaker_id || 'speaker_0')
            .concat(whisper.audioSource === 'mic' || whisper.audioSource === 'both' ? ['Sen'] : [])
        ))}
        getSpeakerDisplayName={whisper.getSpeakerDisplayName}
        onSave={whisper.renameSpeaker}
        onMerge={whisper.mergeSpeakers}
        onDelete={whisper.deleteSpeaker}
        onClose={handleCloseRename}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        modelsInfo={whisper.modelsInfo}
        backend={whisper.backend}
        setBackend={whisper.setBackend}
        selectedWhisperModel={whisper.selectedWhisperModel}
        setSelectedWhisperModel={whisper.setSelectedWhisperModel}
        vadEnabled={whisper.vadEnabled}
        setVadEnabled={whisper.setVadEnabled}
        diarizationEnabled={whisper.diarizationEnabled}
        setDiarizationEnabled={whisper.setDiarizationEnabled}
        diarizationThreshold={whisper.diarizationThreshold}
        updateDiarizationThreshold={whisper.updateDiarizationThreshold}
        onClearVoiceProfiles={whisper.clearVoiceProfiles}
        getVoiceProfiles={whisper.getVoiceProfiles}
        onDeleteVoiceProfile={whisper.deleteSpeaker}
        onRenameVoiceProfile={whisper.renameSpeaker}
        speakerMap={whisper.speakerMap}
        audioSource={whisper.audioSource}
        setAudioSource={whisper.setAudioSource}
        capturableApps={whisper.capturableApps}
        selectedAppBundleId={whisper.selectedAppBundleId}
        setSelectedAppBundleId={whisper.setSelectedAppBundleId}
        refreshCapturableApps={whisper.refreshCapturableApps}
        requestScreenCapturePermission={whisper.requestScreenCapturePermission}
        language={whisper.language}
        setLanguage={whisper.setLanguage}
        latencyMode={whisper.latencyMode}
        updateLatencyMode={whisper.updateLatencyMode}
        isLoading={whisper.isLoading}
        isModelLoaded={whisper.isModelLoaded}
        loadModels={whisper.loadModels}
        downloadModel={whisper.downloadModel}
        downloadProgress={whisper.downloadProgress}
        downloadingTarget={whisper.downloadingTarget}
        statusText={whisper.statusText}
        statusType={whisper.statusType}
      />

      <MeetingHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        getSpeakerDisplayName={whisper.getSpeakerDisplayName}
        onExportMeeting={handleOpenPastMeetingExport}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => {
          setIsExportOpen(false);
          setCustomExportTarget(null);
        }}
        title={activeExportTitle}
        segments={activeExportSegments}
        meetingDuration={activeExportDuration}
        getSpeakerDisplayName={whisper.getSpeakerDisplayName}
      />

      {/* Record-then-transcribe modal — opens automatically after disk recording stops */}
      <RecordingTranscriptModal
        isOpen={isRecordingModalOpen}
        diskRecordingInfo={whisper.diskRecordingInfo}
        isTranscribing={whisper.isTranscribing}
        transcribeProgress={whisper.transcribeProgress}
        offlineTranscript={whisper.offlineTranscript}
        getSpeakerDisplayName={whisper.getSpeakerDisplayName}
        onCreateTranscript={whisper.createTranscript}
        onDismiss={whisper.dismissOfflineTranscript}
        onExport={handleOpenOfflineExport}
      />

      {/* Global Loading Overlay */}
      {whisper.isLoading && !whisper.isTranscribing && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-16 h-16 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4 shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>
          <h2 className="text-xl font-bold text-white mb-2">{whisper.statusText || 'Modeller Yükleniyor...'}</h2>
          <p className="text-slate-400 text-sm">Lütfen bekleyin, bu işlem birkaç saniye sürebilir.</p>
        </div>
      )}
    </div>
  );
};

export default App;
