import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Cpu,
  Mic,
  Volume2,
  Layers,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  Sliders,
  Globe,
  Radio,
  Check,
  Search,
  Edit2,
  Trash2,
} from 'lucide-react';
import {
  AudioSource,
  BackendType,
  CapturableApp,
  DownloadedModelsInfo,
  LanguageMode,
  LatencyMode,
} from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;

  // Models & Backend
  modelsInfo: DownloadedModelsInfo | null;
  backend: BackendType;
  setBackend: (b: BackendType) => void;
  selectedWhisperModel: string;
  setSelectedWhisperModel: (m: string) => void;
  vadEnabled: boolean;
  setVadEnabled: (v: boolean) => void;
  diarizationEnabled: boolean;
  setDiarizationEnabled: (d: boolean) => void;
  diarizationThreshold?: number;
  updateDiarizationThreshold?: (t: number) => void;
  onClearVoiceProfiles?: () => void;
  getVoiceProfiles?: () => Promise<{id: number, name?: string | null, sample_count: number, is_verified: boolean}[]>;
  onDeleteVoiceProfile?: (id: string) => Promise<void>;
  onRenameVoiceProfile?: (id: string, name: string) => Promise<void> | void;
  speakerMap?: Record<string, string>;

  // Audio & SCK
  audioSource: AudioSource;
  setAudioSource: (s: AudioSource) => void;
  capturableApps: CapturableApp[];
  selectedAppBundleId: string;
  setSelectedAppBundleId: (id: string) => void;
  refreshCapturableApps: () => void;
  requestScreenCapturePermission: () => void;

  // Language & Execution
  language: LanguageMode;
  setLanguage: (l: LanguageMode) => void;
  latencyMode?: LatencyMode;
  updateLatencyMode?: (m: LatencyMode) => void;
  isLoading: boolean;
  isModelLoaded: boolean;
  loadModels: () => void;
  downloadModel: (target: 'whisper' | 'qwen' | 'vad' | 'diarization', modelId?: string) => void;
  downloadProgress: number | null;
  downloadingTarget: string | null;
  statusText?: string;
  statusType?: 'idle' | 'loading' | 'recording' | 'ready' | 'error';
}

const AVAILABLE_WHISPER_MODELS = [
  { id: 'large-v3', name: 'Whisper Large v3 (Resmi OpenAI Flagship)', size: '~3.1 GB', desc: 'En güçlü model: 32 katmanlı decoder, en yüksek Türkçe doğruluğu' },
  { id: 'large-v3-turbo', name: 'Whisper Large v3 Turbo', size: '~1.6 GB', desc: 'Hızlı ve dengeli: Yüksek doğruluk ve düşük gecikme' },
  { id: 'medium', name: 'Whisper Medium', size: '~1.5 GB', desc: 'Yüksek doğruluk' },
  { id: 'small', name: 'Whisper Small', size: '~460 MB', desc: 'İyi doğruluk oranı' },
  { id: 'base', name: 'Whisper Base', size: '~140 MB', desc: 'Dengeli ve hızlı' },
  { id: 'tiny', name: 'Whisper Tiny', size: '~75 MB', desc: 'En hızlı, düşük kaynak tüketimi' },
];


export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  modelsInfo,
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
  onClearVoiceProfiles,
  getVoiceProfiles,
  onDeleteVoiceProfile,
  onRenameVoiceProfile,
  speakerMap,
  audioSource,
  setAudioSource,
  capturableApps,
  selectedAppBundleId,
  setSelectedAppBundleId,
  refreshCapturableApps,
  requestScreenCapturePermission,
  language,
  setLanguage,
  latencyMode = 'balanced',
  updateLatencyMode,
  isLoading,
  isModelLoaded,
  loadModels,
  downloadModel,
  downloadProgress,
  downloadingTarget,
  statusText,
  statusType,
}) => {
  const [activeTab, setActiveTab] = useState<'models' | 'audio' | 'features'>('models');
  const [appSearchTerm, setAppSearchTerm] = useState('');
  const [voiceProfiles, setVoiceProfiles] = useState<{id: number, name?: string | null, sample_count: number, is_verified: boolean}[]>([]);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingProfileId, setDeletingProfileId] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && activeTab === 'features' && getVoiceProfiles) {
      getVoiceProfiles().then(setVoiceProfiles);
    }
    if (!isOpen) {
      setConfirmClearAll(false);
      setEditingProfileId(null);
      setDeletingProfileId(null);
    }
  }, [isOpen, activeTab, getVoiceProfiles]);

  if (!isOpen) return null;

  const isWhisperDownloaded = (id: string) => {
    return !!modelsInfo?.whisper_models?.some(m => m.id === id);
  };
  const isVadDownloaded = !!modelsInfo?.vad_model_path;
  const isDiarizationDownloaded = !!modelsInfo?.diarization_model_dir;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div
        className="w-full max-w-3xl max-h-[85vh] rounded-2xl glass-modal border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden select-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-16 px-6 border-b border-slate-800 flex items-center justify-between shrink-0 bg-dark-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Toplantı & Model Ayarları</h2>
              <p className="text-xs text-slate-400">Yapay zeka modellerini ve ses giriş kaynaklarını yapılandırın</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-800 bg-dark-950/60 px-6 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('models')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition ${
              activeTab === 'models'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-4 h-4" />
            Modeller & İndirmeler
          </button>

          <button
            onClick={() => setActiveTab('audio')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition ${
              activeTab === 'audio'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            Ses Kaynağı & Uygulamalar
          </button>

          <button
            onClick={() => setActiveTab('features')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition ${
              activeTab === 'features'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            VAD, Ayrıştırma & Dil
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {statusType === 'error' && statusText && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between animate-fade-in">
              <span>{statusText}</span>
            </div>
          )}
          {/* TAB 1: MODELS */}
          {activeTab === 'models' && (
            <div className="space-y-6">
              {/* Backend Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Konuşma Tanıma (ASR) Motoru
                </label>
                <div className="grid grid-cols-1 gap-3">
                  <div
                    onClick={() => setBackend('whisper')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      backend === 'whisper'
                        ? 'bg-brand-900/20 border-brand-500 shadow-sm'
                        : 'bg-dark-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-white">Whisper (GGML / Metal)</span>
                      {backend === 'whisper' && <Radio className="w-4 h-4 text-brand-400" />}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Apple Silicon GPU hızlandırmalı, endüstri standardı Whisper modelleri.
                    </p>
                  </div>
                </div>
              </div>

              {/* Whisper Models List */}
              <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Whisper Modelleri
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Yerel Kayıt: ~/Library/Application Support/...
                    </span>
                  </div>

                  <div className="space-y-2">
                    {AVAILABLE_WHISPER_MODELS.map(model => {
                      const downloaded = isWhisperDownloaded(model.id);
                      const isSelected = selectedWhisperModel === model.id;
                      const isDownloading = downloadingTarget === 'whisper' && selectedWhisperModel === model.id;

                      return (
                        <div
                          key={model.id}
                          className={`flex items-center justify-between p-3 rounded-xl border transition ${
                            isSelected
                              ? 'bg-dark-900 border-brand-500/80 shadow-sm'
                              : 'bg-dark-900/40 border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          <div
                            className="flex-1 cursor-pointer flex items-center gap-3"
                            onClick={() => setSelectedWhisperModel(model.id)}
                          >
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                              isSelected ? 'border-brand-400 bg-brand-500' : 'border-slate-600'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-white">{model.name}</span>
                                <span className="text-[10px] text-slate-400 font-mono">({model.size})</span>
                                {downloaded && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                                    <CheckCircle2 className="w-3 h-3" /> İndirildi
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">{model.desc}</p>
                            </div>
                          </div>

                          <div>
                            {!downloaded ? (
                              <button
                                onClick={() => downloadModel('whisper', model.id)}
                                disabled={!!downloadingTarget}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 transition"
                              >
                                <Download className="w-3.5 h-3.5" />
                                {isDownloading ? 'İndiriliyor...' : 'İndir'}
                              </button>
                            ) : (
                              <span className="px-2.5 py-1 text-[11px] text-slate-400 font-mono">
                                Hazır
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>



              {/* Supporting Models (VAD & Diarization) */}
              <div className="border-t border-slate-800 pt-4">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Yardımcı Yapay Zeka Modelleri
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Silero VAD */}
                  <div className="p-3.5 rounded-xl border border-slate-800 bg-dark-900/40 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">Silero VAD v5</span>
                        {isVadDownloaded ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <span className="text-[10px] text-amber-400">Eksik</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">Sessizlik filtresi (2.2 MB)</p>
                    </div>
                    {!isVadDownloaded && (
                      <button
                        onClick={() => downloadModel('vad')}
                        disabled={!!downloadingTarget}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                      >
                        İndir
                      </button>
                    )}
                  </div>

                  {/* Pyannote Diarization */}
                  <div className="p-3.5 rounded-xl border border-slate-800 bg-dark-900/40 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">Pyannote Diarization</span>
                        {isDiarizationDownloaded ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <span className="text-[10px] text-amber-400">Eksik</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">Segmentation + Embedding (~35 MB)</p>
                    </div>
                    {!isDiarizationDownloaded && (
                      <button
                        onClick={() => downloadModel('diarization')}
                        disabled={!!downloadingTarget}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                      >
                        İndir
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Download Progress Bar */}
              {downloadProgress !== null && (
                <div className="p-3.5 rounded-xl bg-dark-900 border border-brand-500/40 animate-pulse">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-brand-400">
                      Model İndiriliyor: {downloadingTarget}...
                    </span>
                    <span className="font-mono text-white">%{downloadProgress}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-brand-500 transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: AUDIO & SCK */}
          {activeTab === 'audio' && (
            <div className="space-y-6">
              {/* Audio Source Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Ses Giriş Kaynağı
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <div
                    onClick={() => setAudioSource('mic')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      audioSource === 'mic'
                        ? 'bg-brand-900/20 border-brand-500 text-white'
                        : 'bg-dark-900/40 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <Mic className="w-5 h-5 text-sky-400 mb-2" />
                    <h4 className="text-xs font-bold">Yalnızca Mikrofon</h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Kendi konuşmalarınız ve yerel ortam sesi.
                    </p>
                  </div>

                  <div
                    onClick={() => setAudioSource('sck')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      audioSource === 'sck'
                        ? 'bg-brand-900/20 border-brand-500 text-white'
                        : 'bg-dark-900/40 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <Volume2 className="w-5 h-5 text-emerald-400 mb-2" />
                    <h4 className="text-xs font-bold">Yalnızca Sistem Sesi</h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Zoom, Teams veya Chrome gibi uygulamalardan gelen ses.
                    </p>
                  </div>

                  <div
                    onClick={() => setAudioSource('both')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      audioSource === 'both'
                        ? 'bg-brand-900/20 border-brand-500 text-white'
                        : 'bg-dark-900/40 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <Layers className="w-5 h-5 text-purple-400 mb-2" />
                    <h4 className="text-xs font-bold">Çift Kanal (Toplantı)</h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Hem sizin mikrofonunuz hem de toplantıdaki katılımcılar.
                    </p>
                  </div>
                </div>
              </div>

              {/* Target App Picker (SCK) */}
              {(audioSource === 'sck' || audioSource === 'both') && (
                <div className="border-t border-slate-800 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Dinlenecek Hedef Uygulama
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={requestScreenCapturePermission}
                        className="text-[11px] text-sky-400 hover:underline flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        macOS İzni İste
                      </button>
                      <button
                        onClick={refreshCapturableApps}
                        className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Yenile
                      </button>
                    </div>
                  </div>

                  {capturableApps.length === 0 ? (
                    <div className="p-4 rounded-xl bg-dark-900/60 border border-slate-800 text-center">
                      <p className="text-xs text-amber-400 mb-2">
                        Çalışan uygulama listesi boş veya macOS Ekran Kaydı izni verilmedi.
                      </p>
                      <button
                        onClick={requestScreenCapturePermission}
                        className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition"
                      >
                        Sistem Tercihleri'nde İzin Ver
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Uygulama ara (örn: Zoom, Chrome, Slack)..."
                          value={appSearchTerm}
                          onChange={(e) => setAppSearchTerm(e.target.value)}
                          className="w-full bg-dark-900 border border-slate-700/80 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 transition"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                        {capturableApps
                          .filter(app => 
                            app.name.toLowerCase().includes(appSearchTerm.toLowerCase()) || 
                            app.bundle_id.toLowerCase().includes(appSearchTerm.toLowerCase())
                          )
                          .sort((a, b) => {
                            if (a.is_meeting_app && !b.is_meeting_app) return -1;
                            if (!a.is_meeting_app && b.is_meeting_app) return 1;
                            return a.name.localeCompare(b.name);
                          })
                          .map(app => {
                            const isSelected = selectedAppBundleId === app.bundle_id;
                            return (
                              <div
                                key={app.bundle_id}
                                onClick={() => setSelectedAppBundleId(app.bundle_id)}
                                className={`p-2.5 rounded-xl border cursor-pointer flex items-center justify-between transition ${
                                  isSelected
                                    ? 'bg-dark-900 border-brand-500 shadow-sm'
                                    : 'bg-dark-900/40 border-slate-800/80 hover:border-slate-700'
                                }`}
                              >
                                <div className="truncate mr-2 w-full">
                                  <div className="flex items-center gap-1.5 w-full">
                                    <span className="text-xs font-semibold text-white truncate max-w-[140px]">
                                      {app.name}
                                    </span>
                                    {app.is_meeting_app && (
                                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-purple-500/20 text-purple-300 font-medium shrink-0">
                                        Toplantı
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-slate-400 truncate font-mono">
                                    {app.bundle_id}
                                  </p>
                                </div>
                                {isSelected && <Check className="w-4 h-4 text-brand-400 shrink-0" />}
                              </div>
                            );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: FEATURES & LANGUAGE */}
          {activeTab === 'features' && (
            <div className="space-y-6">
              {/* VAD Settings */}
              <div className="flex items-start justify-between p-4 rounded-xl border border-slate-800 bg-dark-900/40">
                <div className="pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-white">Silero VAD v5 (Sessizlik Filtresi)</span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-semibold">
                      Tavsiye Edilen
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Arka plandaki sessiz anları, nefes ve klavye tıkırtılarını filtreleyerek transkripsiyon motoruna yalnızca insan konuşmasını gönderir. İşlemci tasarrufu sağlar ve hayali kelimelerin (halüsinasyon) önüne geçer.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={vadEnabled}
                    onChange={e => setVadEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Diarization Settings */}
              <div className="p-4 rounded-xl border border-slate-800 bg-dark-900/40 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-white">Pyannote Konuşmacı Ayrıştırma (Diarization)</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Sistem sesindeki farklı kişileri (speaker_0, speaker_1...) otomatik olarak ayırt eder. Çok katılımcılı Zoom/Teams toplantılarında kimin ne söylediğini takip etmeyi sağlar.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                    <input
                      type="checkbox"
                      checked={diarizationEnabled}
                      onChange={e => setDiarizationEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
                  </label>
                </div>

                {diarizationEnabled && updateDiarizationThreshold && (
                  <div className="pt-3 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-semibold text-slate-300">Ayrıştırma Hassasiyeti (Eşik Değeri)</span>
                      <span className="font-mono text-brand-400 font-bold">
                        {diarizationThreshold !== undefined ? diarizationThreshold.toFixed(2) : '0.70'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.50"
                      max="0.85"
                      step="0.01"
                      value={diarizationThreshold ?? 0.70}
                      onChange={e => updateDiarizationThreshold(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono mb-4">
                      <span>0.50 (Agresif Birleştirme)</span>
                      <span>0.70 (Tavsiye Edilen)</span>
                      <span>0.85 (Hassas Ayrım)</span>
                    </div>

                    {/* Voice Profiles List and Wipe */}
                    {onClearVoiceProfiles && onDeleteVoiceProfile && (
                      <div className="mt-4 pt-4 border-t border-slate-800/80">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-xs font-semibold text-slate-300">Öğrenilmiş Ses Profilleri ({voiceProfiles.length})</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Sistemin tanıdığı ve kaydettiği konuşmacı profilleri.
                            </div>
                          </div>
                          {!confirmClearAll ? (
                            <button
                              onClick={() => setConfirmClearAll(true)}
                              className="shrink-0 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium transition-colors"
                            >
                              Tümünü Sil
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => setConfirmClearAll(false)}
                                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition"
                              >
                                Vazgeç
                              </button>
                              <button
                                onClick={async () => {
                                  if (onClearVoiceProfiles) {
                                    await onClearVoiceProfiles();
                                    setVoiceProfiles([]);
                                  }
                                  setConfirmClearAll(false);
                                }}
                                className="px-2.5 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg shadow-sm transition"
                              >
                                Kalıcı Olarak Sil
                              </button>
                            </div>
                          )}
                        </div>

                        {voiceProfiles.length > 0 && (
                          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
                            {voiceProfiles.map(p => {
                              const sId = `speaker_${p.id}`;
                              const dName = speakerMap?.[sId] || p.name || sId;
                              const isEditing = editingProfileId === p.id;
                              const isDeleting = deletingProfileId === p.id;

                              return (
                                <div key={p.id} className="p-2 rounded bg-slate-800/50 border border-slate-700/50">
                                  {isEditing ? (
                                    <div className="flex items-center gap-2 w-full">
                                      <input
                                        type="text"
                                        value={editingName}
                                        onChange={e => setEditingName(e.target.value)}
                                        onKeyDown={async e => {
                                          if (e.key === 'Enter') {
                                            if (editingName.trim() && onRenameVoiceProfile) {
                                              await onRenameVoiceProfile(sId, editingName.trim());
                                              setVoiceProfiles(prev => prev.map(x => x.id === p.id ? { ...x, name: editingName.trim() } : x));
                                            }
                                            setEditingProfileId(null);
                                          } else if (e.key === 'Escape') {
                                            setEditingProfileId(null);
                                          }
                                        }}
                                        className="flex-1 px-2.5 py-1 text-xs bg-dark-900 border border-brand-500 rounded-lg text-white outline-none"
                                        autoFocus
                                      />
                                      <button
                                        onClick={async () => {
                                          if (editingName.trim() && onRenameVoiceProfile) {
                                            await onRenameVoiceProfile(sId, editingName.trim());
                                            setVoiceProfiles(prev => prev.map(x => x.id === p.id ? { ...x, name: editingName.trim() } : x));
                                          }
                                          setEditingProfileId(null);
                                        }}
                                        className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded transition-colors"
                                        title="Kaydet"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => setEditingProfileId(null)}
                                        className="p-1 text-slate-400 hover:bg-slate-700 rounded transition-colors"
                                        title="Vazgeç"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ) : isDeleting ? (
                                    <div className="flex items-center justify-between w-full text-xs">
                                      <span className="text-red-300 font-medium truncate mr-2">
                                        '{dName}' profili silinsin mi?
                                      </span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          onClick={() => setDeletingProfileId(null)}
                                          className="px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded transition"
                                        >
                                          İptal
                                        </button>
                                        <button
                                          onClick={async () => {
                                            if (onDeleteVoiceProfile) {
                                              await onDeleteVoiceProfile(sId);
                                              setVoiceProfiles(prev => prev.filter(x => x.id !== p.id));
                                            }
                                            setDeletingProfileId(null);
                                          }}
                                          className="px-2 py-0.5 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded shadow-sm transition"
                                        >
                                          Sil
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-between">
                                      <div className="flex flex-col truncate mr-2">
                                        <span className="text-xs font-medium text-slate-200 truncate">{dName}</span>
                                        <span className="text-[9px] text-slate-400">ID: {p.id} • Örnek: {p.sample_count} {p.is_verified ? '• Onaylı' : ''}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          onClick={() => {
                                            setEditingProfileId(p.id);
                                            setEditingName(dName);
                                            setDeletingProfileId(null);
                                          }}
                                          className="p-1 text-slate-400 hover:text-brand-400 hover:bg-brand-400/10 rounded transition-colors"
                                          title="İsmi Düzenle"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => {
                                            setDeletingProfileId(p.id);
                                            setEditingProfileId(null);
                                          }}
                                          className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                          title="Profili Sil"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Language Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-brand-400" />
                  Transkripsiyon Dili
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { id: 'tr', label: '🇹🇷 Türkçe (tr) - Önerilen' },
                    { id: 'auto', label: '🌐 Otomatik Algıla' },
                    { id: 'en', label: '🇬🇧 İngilizce (en)' },
                    { id: 'de', label: '🇩🇪 Almanca (de)' },
                  ].map(l => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLanguage(l.id as LanguageMode)}
                      className={`p-2.5 rounded-xl text-xs font-semibold border text-center transition ${
                        language === l.id
                          ? 'bg-brand-900/30 border-brand-500 text-white'
                          : 'bg-dark-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Latency & Resource Efficiency Profile */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                  İşlem & Gecikme Modu (Kaynak Tüketimi & Doğruluk)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div
                    onClick={() => updateLatencyMode && updateLatencyMode('balanced')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      latencyMode === 'balanced'
                        ? 'bg-brand-900/20 border-brand-500 shadow-sm'
                        : 'bg-dark-900/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">Yüksek Doğruluk & Düşük CPU</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 font-semibold">
                          Tavsiye Edilen
                        </span>
                      </div>
                      {latencyMode === 'balanced' && <Check className="w-4 h-4 text-brand-400" />}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Konuşmaları 5-7 saniyelik doğal cümle sonlarında işler. CPU/GPU yükünü %65 azaltır ve modellerin tam cümle bağlamıyla maksimum doğrulukta çalışmasını sağlar.
                    </p>
                  </div>

                  <div
                    onClick={() => updateLatencyMode && updateLatencyMode('low_latency')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      latencyMode === 'low_latency'
                        ? 'bg-brand-900/20 border-brand-500 shadow-sm'
                        : 'bg-dark-900/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-white">Hızlı Akış / Düşük Gecikme</span>
                      {latencyMode === 'low_latency' && <Check className="w-4 h-4 text-brand-400" />}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      2-3 saniyelik daha kısa aralıklarla daha sık transkripsiyon yapar. Ekran başında anlık kelime takibi için uygundur, daha yüksek işlemci kaynağı tüketir.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer with Load Models Button */}
        <div className="h-16 px-6 border-t border-slate-800 bg-dark-900/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${isModelLoaded ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="text-slate-300">
              {isModelLoaded ? 'Modeller Bellekte Aktif' : 'Modeller Yüklenmedi'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
            >
              Kapat
            </button>

            <button
              onClick={loadModels}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 shadow-md shadow-brand-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Cpu className="w-3.5 h-3.5" />
              {isLoading ? 'Yükleniyor...' : 'Modelleri Belleğe Yükle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
