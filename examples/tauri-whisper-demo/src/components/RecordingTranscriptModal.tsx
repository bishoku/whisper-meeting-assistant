/**
 * RecordingTranscriptModal
 *
 * Shown after the user stops a disk-recording session.
 * States:
 *  1. "Kayıt tamamlandı" → "Transcript Oluştur" CTA
 *  2. Processing → progress bar
 *  3. Done → scrollable speaker-attributed transcript
 */
import React, { useRef, useEffect } from 'react';
import {
  FileText,
  Loader2,
  X,
  CheckCircle,
  Clock,
  Users,
  HardDrive,
  ChevronRight,
  Download,
} from 'lucide-react';
import { RecordingInfo, RecordingTranscript, RecordingTranscriptSegment } from '../types';

interface RecordingTranscriptModalProps {
  isOpen: boolean;
  diskRecordingInfo: RecordingInfo | null;
  isTranscribing: boolean;
  transcribeProgress: number;
  offlineTranscript: RecordingTranscript | null;
  getSpeakerDisplayName: (id: string) => string;
  onCreateTranscript: () => void;
  onDismiss: () => void;
  onExport?: () => void;
}

// Color palette for speakers
const SPEAKER_COLORS: Record<string, string> = {
  speaker_0:  'text-sky-400   border-sky-500/40   bg-sky-500/10',
  speaker_1:  'text-violet-400 border-violet-500/40 bg-violet-500/10',
  speaker_2:  'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  speaker_3:  'text-rose-400  border-rose-500/40  bg-rose-500/10',
  speaker_4:  'text-amber-400 border-amber-500/40 bg-amber-500/10',
  speaker_5:  'text-cyan-400  border-cyan-500/40  bg-cyan-500/10',
  speaker_6:  'text-pink-400  border-pink-500/40  bg-pink-500/10',
  speaker_7:  'text-lime-400  border-lime-500/40  bg-lime-500/10',
  speaker_unknown: 'text-slate-400 border-slate-500/40 bg-slate-500/10',
};

function speakerColor(id: string): string {
  return SPEAKER_COLORS[id] ?? SPEAKER_COLORS.speaker_unknown;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// Group consecutive segments by the same speaker
function groupSegments(
  segments: RecordingTranscriptSegment[],
): Array<{ speaker_id: string; start_ms: number; end_ms: number; lines: RecordingTranscriptSegment[] }> {
  const groups: Array<{ speaker_id: string; start_ms: number; end_ms: number; lines: RecordingTranscriptSegment[] }> = [];
  for (const seg of segments) {
    const last = groups[groups.length - 1];
    if (last && last.speaker_id === seg.speaker_id && seg.start_ms - last.end_ms < 2000) {
      last.lines.push(seg);
      last.end_ms = seg.end_ms;
    } else {
      groups.push({ speaker_id: seg.speaker_id, start_ms: seg.start_ms, end_ms: seg.end_ms, lines: [seg] });
    }
  }
  return groups;
}

export const RecordingTranscriptModal: React.FC<RecordingTranscriptModalProps> = ({
  isOpen,
  diskRecordingInfo,
  isTranscribing,
  transcribeProgress,
  offlineTranscript,
  getSpeakerDisplayName,
  onCreateTranscript,
  onDismiss,
  onExport,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when transcript grows
  useEffect(() => {
    if (offlineTranscript && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [offlineTranscript]);

  if (!isOpen || !diskRecordingInfo) return null;

  const groups = offlineTranscript ? groupSegments(offlineTranscript.segments) : [];

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-dark-900 border border-slate-800 shadow-2xl shadow-black/60 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center">
              <FileText className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="font-semibold text-sm text-white">Kayıt Transkripti</h2>
              <p className="text-[11px] text-slate-400 font-mono truncate max-w-xs">
                {diskRecordingInfo.path.split('/').pop()}
              </p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Recording Meta ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-6 py-3 bg-dark-950/60 border-b border-slate-800/60 text-[11px] text-slate-400 shrink-0">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-slate-500" />
            {formatMs(diskRecordingInfo.duration_ms)}
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3 h-3 text-slate-500" />
            {formatBytes(diskRecordingInfo.size_bytes)}
          </span>
          {offlineTranscript && (
            <span className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-slate-500" />
              {offlineTranscript.num_speakers} konuşmacı
            </span>
          )}
          {offlineTranscript && (
            <span className="flex items-center gap-1.5 ml-auto text-slate-500">
              işlem süresi {(offlineTranscript.processing_time_ms / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* State 1: Ready to transcribe */}
          {!isTranscribing && !offlineTranscript && (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 py-10">
              <div className="w-16 h-16 rounded-2xl bg-amber-600/15 border border-amber-500/25 flex items-center justify-center">
                <FileText className="w-7 h-7 text-amber-400" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-white mb-1.5">Ses kaydı hazır</h3>
                <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
                  Whisper STT + Pyannote diarization ile her konuşmacıyı ayrı etiketleyerek
                  zaman damgalı bir transcript oluşturulsun mu?
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {formatMs(diskRecordingInfo.duration_ms)} kayıt ·{' '}
                  yaklaşık {Math.round(diskRecordingInfo.duration_ms / 60000 * 0.3 + 5)} sn işlem süresi
                </p>
              </div>
              <button
                onClick={onCreateTranscript}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 shadow-md shadow-amber-900/30 transition transform active:scale-95"
              >
                <FileText className="w-4 h-4" />
                Transcript Oluştur
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* State 2: Processing */}
          {isTranscribing && (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 py-10">
              <div className="w-16 h-16 rounded-2xl bg-brand-600/15 border border-brand-500/25 flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-brand-400 animate-spin" />
              </div>
              <div className="text-center w-full max-w-sm">
                <h3 className="font-semibold text-white mb-1">Transcript oluşturuluyor...</h3>
                <p className="text-xs text-slate-400 mb-4">
                  STT + Pyannote diarization çalışıyor
                </p>

                {/* Progress bar */}
                <div className="relative w-full h-2 rounded-full bg-dark-800 overflow-hidden border border-slate-800">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-500 to-indigo-400 transition-all duration-500"
                    style={{ width: `${transcribeProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                  {transcribeProgress}%
                </p>
              </div>
            </div>
          )}

          {/* State 3: Transcript ready */}
          {offlineTranscript && !isTranscribing && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Success banner */}
              <div className="flex items-center gap-2 px-6 py-2.5 bg-emerald-900/20 border-b border-emerald-800/30 shrink-0">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[11px] text-emerald-300 font-medium">
                  {offlineTranscript.segments.length} segment · {offlineTranscript.num_speakers} konuşmacı tespit edildi
                </span>
              </div>

              {/* Scrollable transcript */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {groups.map((group, gi) => {
                  const colorCls = speakerColor(group.speaker_id);
                  const displayName = getSpeakerDisplayName(group.speaker_id);
                  return (
                    <div key={gi} className="flex gap-3">
                      {/* Speaker badge column */}
                      <div className="w-20 shrink-0 pt-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${colorCls} truncate max-w-full`}>
                          {displayName}
                        </span>
                        <p className={`text-[10px] font-mono mt-1 ${colorCls.split(' ')[0]}`}>
                          {formatMs(group.start_ms)}
                        </p>
                      </div>

                      {/* Text bubble */}
                      <div className={`flex-1 rounded-xl px-3.5 py-2.5 border ${colorCls} text-sm text-slate-100 leading-relaxed`}>
                        {group.lines.map((seg, si) => (
                          <span key={si}>{seg.text}{si < group.lines.length - 1 ? ' ' : ''}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        {offlineTranscript && (
          <div className="px-6 py-3 border-t border-slate-800 shrink-0 flex items-center justify-between">
            {onExport ? (
              <button
                onClick={onExport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 shadow-md shadow-brand-600/30 transition"
              >
                <Download className="w-3.5 h-3.5" />
                Dışa Aktar
              </button>
            ) : <div />}

            <button
              onClick={onDismiss}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent hover:border-slate-700 transition"
            >
              Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
