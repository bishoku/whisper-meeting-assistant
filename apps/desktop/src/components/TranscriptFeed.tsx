import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Copy,
  Check,
  Search,
  ArrowDown,
  Clock,
  Mic,
  Volume2,
  Filter,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { DiarizedSegmentPayload } from '../types';
import { getSpeakerColor } from './ParticipantBar';

interface TranscriptFeedProps {
  segments: DiarizedSegmentPayload[];
  partialText: string;
  activeSpeakerId: string | null;
  isRecording: boolean;
  getSpeakerDisplayName: (id: string) => string;
  onOpenRename: (speakerId: string) => void;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export const TranscriptFeed: React.FC<TranscriptFeedProps> = ({
  segments,
  partialText,
  activeSpeakerId,
  isRecording,
  getSpeakerDisplayName,
  onOpenRename,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpeakerFilter, setSelectedSpeakerFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Filter segments
  const filteredSegments = useMemo(() => {
    return segments.filter(seg => {
      const matchesSearch = searchQuery.trim() === '' ||
        seg.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        getSpeakerDisplayName(seg.speaker_id).toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSpeaker = selectedSpeakerFilter === 'all' || seg.speaker_id === selectedSpeakerFilter;

      return matchesSearch && matchesSpeaker;
    });
  }, [segments, searchQuery, selectedSpeakerFilter, getSpeakerDisplayName]);

  // Unique speakers for filter dropdown
  const uniqueSpeakers = useMemo(() => {
    const spks = new Set<string>();
    for (const seg of segments) {
      spks.add(seg.speaker_id || 'Sen');
    }
    return Array.from(spks);
  }, [segments]);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [segments, partialText, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(index);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Group continuous speech segments into natural conversation bubbles
  const groupedBubbles = useMemo(() => {
    const bubbles: {
      id: string;
      speaker_id: string;
      start_ms: number;
      end_ms: number;
      text: string;
    }[] = [];

    for (const seg of filteredSegments) {
      const spk = seg.speaker_id || 'Sen';
      const text = seg.text.trim();
      if (!text) continue;

      const last = bubbles[bubbles.length - 1];
      const lastDisplayName = last ? getSpeakerDisplayName(last.speaker_id) : '';
      const curDisplayName = getSpeakerDisplayName(spk);

      // If same speaker or same assigned name, and pause <= 4500ms, merge into current bubble!
      if (last && (last.speaker_id === spk || lastDisplayName === curDisplayName) && (seg.start_ms - last.end_ms) <= 4500) {
        if (!last.text.endsWith(text)) {
          last.text = `${last.text} ${text}`.trim();
        }
        last.end_ms = Math.max(last.end_ms, seg.end_ms);
      } else {
        bubbles.push({
          id: `${spk}-${seg.start_ms}`,
          speaker_id: spk,
          start_ms: seg.start_ms,
          end_ms: seg.end_ms,
          text: text,
        });
      }
    }
    return bubbles;
  }, [filteredSegments, getSpeakerDisplayName]);

  return (
    <div className="relative flex-1 flex flex-col min-h-0 bg-dark-950 overflow-hidden">
      {/* Subheader: Search & Filter Toolbar */}
      {segments.length > 0 && (
        <div className="h-12 px-6 border-b border-slate-800/60 bg-dark-900/40 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Konuşmalarda ara..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-dark-800/80 border border-slate-700/80 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Filter className="w-3 h-3" />
              <span>Filtrele:</span>
            </div>
            <select
              value={selectedSpeakerFilter}
              onChange={e => setSelectedSpeakerFilter(e.target.value)}
              className="px-2.5 py-1 rounded-lg bg-dark-800/80 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-brand-500 transition"
            >
              <option value="all">Tüm Konuşmacılar ({segments.length} segment)</option>
              {uniqueSpeakers.map(spk => (
                <option key={spk} value={spk}>
                  {getSpeakerDisplayName(spk)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Main Conversation Stream */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 p-6 overflow-y-auto space-y-4 select-text"
      >
        {groupedBubbles.length === 0 && !partialText ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 select-none">
            <div className="w-16 h-16 rounded-2xl bg-dark-900 border border-slate-800 flex items-center justify-center mb-4 shadow-xl text-brand-400">
              {isRecording ? <Mic className="w-8 h-8 text-rose-500 animate-pulse" /> : <MessageSquare className="w-8 h-8" />}
            </div>
            <h3 className="text-base font-semibold text-slate-200 mb-1">
              {isRecording ? '🔴 Dinleniyor... Konuşma bekleniyor' : 'Henüz konuşma kaydı yok'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-6">
              {isRecording
                ? 'Ses girişi aktif. Konuşulduğunda canlı olarak burada listelenecektir.'
                : 'Yukarıdaki "Toplantıyı Başlat" butonuna tıklayarak mikrofon veya sistem sesini (Zoom, Teams, Chrome vb.) anında canlı metne dönüştürün.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-md text-[11px] text-slate-400">
              <span className="px-2.5 py-1 rounded-lg bg-dark-900 border border-slate-800">
                🎙️ Konuşmacı Ayrıştırma (Diarization)
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-dark-900 border border-slate-800">
                ⚡ Silero VAD v5 Sessizlik Filtresi
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-dark-900 border border-slate-800">
                🔒 %100 Yerel ve Gizli
              </span>
            </div>
          </div>
        ) : (
          <>
            {groupedBubbles.map((bubble, idx) => {
              const spkId = bubble.speaker_id || 'Sen';
              const displayName = getSpeakerDisplayName(spkId);
              const colors = getSpeakerColor(spkId);
              const initial = displayName.trim().charAt(0).toUpperCase() || '?';
              const isSen = spkId === 'Sen';
              const isSpeaking = activeSpeakerId === spkId;
              const isLast = idx === groupedBubbles.length - 1;

              return (
                <div
                  key={bubble.id}
                  className="group flex items-start gap-3.5 max-w-4xl mx-auto animate-fade-in"
                >
                  {/* Speaker Avatar */}
                  <div
                    onClick={() => onOpenRename(spkId)}
                    title="İsmi değiştirmek için tıklayın"
                    className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${colors.bg} flex items-center justify-center text-xs font-bold text-white shadow-md cursor-pointer shrink-0 transition transform hover:scale-105 select-none`}
                  >
                    {initial}
                  </div>

                  {/* Speech Bubble Card */}
                  <div className="flex-1 bg-dark-900/80 rounded-2xl border border-slate-800/80 hover:border-slate-700/80 transition-shadow p-4 shadow-sm relative">
                    {/* Header: Name, Timestamps, Actions */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onOpenRename(spkId)}
                          className="text-xs font-semibold text-slate-200 hover:text-brand-400 hover:underline transition flex items-center gap-1.5"
                          title="İsmi yeniden adlandır"
                        >
                          <span>{displayName}</span>
                          {isSen && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 font-normal">
                              Sen
                            </span>
                          )}
                          {isSpeaking && (
                            <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
                          )}
                        </button>

                        <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTimestamp(bubble.start_ms)} - {formatTimestamp(bubble.end_ms)}
                        </span>
                      </div>

                      {/* Copy Action Button */}
                      <button
                        onClick={() => copyToClipboard(bubble.text, idx)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-dark-800 transition"
                        title="Metni Kopyala"
                      >
                        {copiedId === idx ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Speech Text Content */}
                    <p className="text-sm text-slate-200 leading-relaxed font-normal whitespace-pre-wrap">
                      {bubble.text}
                      {isLast && isSpeaking && partialText && (
                        <span className="text-brand-400 italic ml-2 inline-flex items-center gap-1">
                          <Sparkles className="w-3 h-3 inline animate-pulse" />
                          {partialText}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Standalone Partial Bubble (when speaker is different or initial) */}
            {partialText && (!groupedBubbles.length || activeSpeakerId !== groupedBubbles[groupedBubbles.length - 1].speaker_id) && (
              <div className="flex items-start gap-3.5 max-w-4xl mx-auto animate-fade-in">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-xs font-bold text-white shadow-md shrink-0">
                  <Mic className="w-4 h-4 text-white animate-pulse" />
                </div>

                <div className="flex-1 bg-dark-900/60 rounded-2xl border border-brand-500/30 p-4 shadow-sm relative backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-brand-400 flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" />
                      Canlı Konuşma Algılanıyor...
                    </span>
                    <span className="flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-brand-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
                    </span>
                  </div>

                  <p className="text-sm text-slate-300 italic leading-relaxed whitespace-pre-wrap">
                    {partialText}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {!autoScroll && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-6 right-8 flex items-center gap-2 px-3.5 py-2 rounded-full bg-brand-600 text-white text-xs font-medium shadow-xl hover:bg-brand-500 transition animate-bounce select-none"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          En Alta Kaydır
        </button>
      )}
    </div>
  );
};
