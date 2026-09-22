import React from 'react';
import {
  Play,
  Square,
  Settings,
  Download,
  Trash2,
  Mic,
  Volume2,
  Sparkles,
  Activity,
  Layers,
  Radio,
  HardDrive,
  History,
} from 'lucide-react';
import { AudioSource, RecordingMode } from '../types';

interface HeaderProps {
  isRecording: boolean;
  isLoading: boolean;
  isModelLoaded: boolean;
  meetingDuration: number;
  audioSource: AudioSource;
  selectedModel: string;
  vadEnabled: boolean;
  recordingMode: RecordingMode;
  onSetRecordingMode: (mode: RecordingMode) => void;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onOpenHistory: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const Header: React.FC<HeaderProps> = ({
  isRecording,
  isLoading,
  isModelLoaded,
  meetingDuration,
  audioSource,
  selectedModel,
  vadEnabled,
  recordingMode,
  onSetRecordingMode,
  onStart,
  onStop,
  onClear,
  onOpenSettings,
  onOpenExport,
  onOpenHistory,
}) => {
  return (
    <header className="h-16 px-5 border-b border-slate-800/80 glass-panel flex items-center justify-between shrink-0 select-none z-20">
      {/* Left: Brand & Meeting Info */}
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-sm tracking-tight text-white">
              Whisper Meeting Assistant
            </h1>
            {isRecording && recordingMode === 'live' && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                CANLI KAYIT
              </span>
            )}
            {isRecording && recordingMode === 'record' && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                SES KAYDEDİLİYOR
              </span>
            )}
          </div>

          {/* Subtitle Badges */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
            <span className="flex items-center gap-1">
              {audioSource === 'mic' && <><Mic className="w-3 h-3 text-sky-400" /> Sadece Mikrofon</>}
              {audioSource === 'sck' && <><Volume2 className="w-3 h-3 text-emerald-400" /> Sistem Sesi</>}
              {audioSource === 'both' && <><Layers className="w-3 h-3 text-purple-400" /> Çift Kanal (Toplantı)</>}
            </span>
            <span>•</span>
            <span className="font-mono text-slate-300">
              {`Whisper (${selectedModel})`}
            </span>
            {vadEnabled && (
              <>
                <span>•</span>
                <span className="text-emerald-400 flex items-center gap-0.5 font-medium">
                  <Activity className="w-3 h-3" /> Silero VAD
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Center: Mode Switcher + Timer */}
      <div className="hidden md:flex items-center gap-3">
        {/* Mode toggle — disabled while recording */}
        <div className="flex items-center rounded-xl bg-dark-900 border border-slate-800 p-0.5">
          <button
            onClick={() => onSetRecordingMode('live')}
            disabled={isRecording}
            title="Toplantı sırasında anlık transcript"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
              recordingMode === 'live'
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-500 hover:text-slate-300 disabled:opacity-40'
            } disabled:cursor-not-allowed`}
          >
            <Radio className="w-3 h-3" />
            Anlık Transcript
          </button>
          <button
            onClick={() => onSetRecordingMode('record')}
            disabled={isRecording}
            title="Toplantıyı kaydet, sonra transcript oluştur"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
              recordingMode === 'record'
                ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-500 hover:text-slate-300 disabled:opacity-40'
            } disabled:cursor-not-allowed`}
          >
            <HardDrive className="w-3 h-3" />
            Kaydet & Çevir
          </button>
        </div>

        {/* Timer (only while recording) */}
        {isRecording && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-dark-900 border border-slate-800">
            <span className={`w-2 h-2 rounded-full ${recordingMode === 'live' ? 'bg-rose-500' : 'bg-amber-500'}`} />
            <span className="font-mono text-sm font-semibold tracking-wider text-slate-200">
              {formatDuration(meetingDuration)}
            </span>
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onClear}
          title="Transkripti Temizle"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenHistory}
          title="Toplantı Arşivi / Geçmiş"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition"
        >
          <History className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenExport}
          title="Toplantı Notlarını Dışa Aktar"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition"
        >
          <Download className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenSettings}
          title="Model & Sistem Ayarları"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition"
        >
          <Settings className="w-4 h-4" />
        </button>

        <div className="h-6 w-px bg-slate-800 mx-1" />

        {/* Start / Stop Toggle */}
        {!isRecording ? (
          <button
            onClick={onStart}
            disabled={isLoading || !isModelLoaded}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-xs text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition transform active:scale-95 ${
              recordingMode === 'live'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-900/30'
                : 'bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 shadow-amber-900/30'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {recordingMode === 'live' ? 'Toplantıyı Başlat' : 'Kayda Başla'}
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-xs text-white bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 shadow-md shadow-rose-900/30 transition transform active:scale-95 animate-pulse"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            Durdur
          </button>
        )}
      </div>
    </header>
  );
};
