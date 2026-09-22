import React, { useMemo } from 'react';
import { User, Edit3, Volume2 } from 'lucide-react';
import { DiarizedSegmentPayload, AudioSource } from '../types';

interface ParticipantBarProps {
  segments: DiarizedSegmentPayload[];
  activeSpeakerId: string | null;
  speakerMap: Record<string, string>;
  getSpeakerDisplayName: (id: string) => string;
  onOpenRename: (speakerId: string) => void;
  audioSource?: AudioSource;
}

// Fixed distinct color palettes for speakers
const SPEAKER_COLORS: Record<string, { bg: string; text: string; ring: string; border: string }> = {
  'Sen': {
    bg: 'from-blue-600 to-cyan-500',
    text: 'text-blue-400',
    ring: 'ring-blue-500/50',
    border: 'border-blue-500/40',
  },
  'speaker_0': {
    bg: 'from-emerald-600 to-teal-500',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/50',
    border: 'border-emerald-500/40',
  },
  'speaker_1': {
    bg: 'from-amber-600 to-orange-500',
    text: 'text-amber-400',
    ring: 'ring-amber-500/50',
    border: 'border-amber-500/40',
  },
  'speaker_2': {
    bg: 'from-purple-600 to-violet-500',
    text: 'text-purple-400',
    ring: 'ring-purple-500/50',
    border: 'border-purple-500/40',
  },
  'speaker_3': {
    bg: 'from-rose-600 to-pink-500',
    text: 'text-rose-400',
    ring: 'ring-rose-500/50',
    border: 'border-rose-500/40',
  },
};

const FALLBACK_PALETTES = [
  { bg: 'from-indigo-600 to-blue-500', text: 'text-indigo-400', ring: 'ring-indigo-500/50', border: 'border-indigo-500/40' },
  { bg: 'from-fuchsia-600 to-pink-500', text: 'text-fuchsia-400', ring: 'ring-fuchsia-500/50', border: 'border-fuchsia-500/40' },
  { bg: 'from-teal-600 to-emerald-500', text: 'text-teal-400', ring: 'ring-teal-500/50', border: 'border-teal-500/40' },
];

export function getSpeakerColor(speakerId: string) {
  if (SPEAKER_COLORS[speakerId]) {
    return SPEAKER_COLORS[speakerId];
  }
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = (hash * 31 + speakerId.charCodeAt(i)) % FALLBACK_PALETTES.length;
  }
  return FALLBACK_PALETTES[Math.abs(hash)];
}

export const ParticipantBar: React.FC<ParticipantBarProps> = ({
  segments,
  activeSpeakerId,
  speakerMap: _speakerMap,
  getSpeakerDisplayName,
  onOpenRename,
  audioSource = 'both',
}) => {
  // Aggregate distinct speakers from current meeting's segments only
  const speakers = useMemo(() => {
    const map = new Map<string, { id: string; segmentCount: number; totalDurationMs: number }>();

    // 1. If mic is enabled ('mic' or 'both'), include "Sen" in current meeting
    const hasMic = audioSource === 'mic' || audioSource === 'both';
    if (hasMic) {
      map.set('Sen', { id: 'Sen', segmentCount: 0, totalDurationMs: 0 });
    }

    // 2. Add speakers that have actually spoken in this meeting's segments
    for (const seg of segments) {
      const spk = seg.speaker_id || (hasMic ? 'Sen' : 'speaker_0');
      const existing = map.get(spk) || { id: spk, segmentCount: 0, totalDurationMs: 0 };
      existing.segmentCount += 1;
      existing.totalDurationMs += Math.max(0, seg.end_ms - seg.start_ms);
      map.set(spk, existing);
    }

    return Array.from(map.values());
  }, [segments, audioSource]);

  return (
    <div className="h-14 px-5 border-b border-slate-800/60 bg-dark-900/60 backdrop-blur-md flex items-center justify-between gap-4 overflow-x-auto shrink-0 select-none">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 shrink-0">
        <User className="w-3.5 h-3.5 text-slate-400" />
        <span>Katılımcılar ({speakers.length})</span>
      </div>

      <div className="flex items-center gap-3 overflow-x-auto py-1 scrollbar-none">
        {speakers.length === 0 ? (
          <span className="text-xs text-slate-500 italic">
            Konuşma algılandığında katılımcılar burada listelenecektir
          </span>
        ) : (
          speakers.map(spk => {
          const isActive = activeSpeakerId === spk.id;
          const displayName = getSpeakerDisplayName(spk.id);
          const colors = getSpeakerColor(spk.id);
          const initial = displayName.trim().charAt(0).toUpperCase() || '?';

          return (
            <div
              key={spk.id}
              className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200 cursor-pointer ${
                isActive
                  ? `bg-dark-800/90 ${colors.border} ring-2 ${colors.ring} shadow-lg shadow-emerald-500/10`
                  : 'bg-dark-850/60 border-slate-800 hover:bg-dark-800 hover:border-slate-700'
              }`}
              onClick={() => onOpenRename(spk.id)}
              title="İsmi değiştirmek için tıklayın"
            >
              {/* Avatar circle */}
              <div
                className={`relative w-6 h-6 rounded-full bg-gradient-to-tr ${colors.bg} flex items-center justify-center text-[10px] font-bold text-white shadow-sm`}
              >
                {initial}
                {isActive && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                )}
              </div>

              {/* Name & Segment info */}
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-medium max-w-[120px] truncate ${isActive ? 'text-white font-semibold' : 'text-slate-300'}`}>
                  {displayName}
                </span>

                {isActive && (
                  <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse shrink-0" />
                )}

                {spk.segmentCount > 0 && !isActive && (
                  <span className="text-[10px] text-slate-400 group-hover:hidden">
                    {spk.segmentCount}
                  </span>
                )}

                {/* Edit Icon on hover */}
                <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-brand-400 hidden group-hover:inline-block shrink-0" />
              </div>
            </div>
          );
        }))}
      </div>
    </div>
  );
};
