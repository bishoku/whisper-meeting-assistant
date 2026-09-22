import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  Calendar,
  Clock,
  Users,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  Edit2,
  Check,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { SavedMeeting } from '../types';
import {
  getSavedMeetings,
  updateMeetingTitle,
  deleteSavedMeeting,
  clearAllSavedMeetings,
} from '../services/meetingStorage';
import { formatDurationHuman, formatMsToShortTime } from '../utils/exportTranscript';

interface MeetingHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  getSpeakerDisplayName: (id: string) => string;
  onExportMeeting: (meeting: SavedMeeting) => void;
}

export const MeetingHistoryModal: React.FC<MeetingHistoryModalProps> = ({
  isOpen,
  onClose,
  getSpeakerDisplayName,
  onExportMeeting,
}) => {
  const [meetings, setMeetings] = useState<SavedMeeting[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [editMeetingTitle, setEditMeetingTitle] = useState('');
  const [deletingMeetingId, setDeletingMeetingId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const refreshList = () => {
    setMeetings(getSavedMeetings());
  };

  useEffect(() => {
    if (isOpen) {
      refreshList();
      setEditingMeetingId(null);
      setDeletingMeetingId(null);
      setConfirmClearAll(false);
    }
  }, [isOpen]);

  const filteredMeetings = useMemo(() => {
    const q = searchTerm.trim().toLocaleLowerCase('tr-TR');
    if (!q) return meetings;
    return meetings.filter(m => {
      if (m.title.toLocaleLowerCase('tr-TR').includes(q)) return true;
      return m.segments.some(s => s.text.toLocaleLowerCase('tr-TR').includes(q));
    });
  }, [meetings, searchTerm]);

  if (!isOpen) return null;

  const handleStartRename = (id: string, currentTitle: string) => {
    setEditingMeetingId(id);
    setEditMeetingTitle(currentTitle);
    setDeletingMeetingId(null);
  };

  const handleSaveRename = (id: string) => {
    if (editMeetingTitle.trim()) {
      updateMeetingTitle(id, editMeetingTitle.trim());
      refreshList();
    }
    setEditingMeetingId(null);
  };

  const handleConfirmDelete = (id: string) => {
    deleteSavedMeeting(id);
    refreshList();
    if (expandedMeetingId === id) {
      setExpandedMeetingId(null);
    }
    setDeletingMeetingId(null);
  };

  const handleConfirmClearAll = () => {
    clearAllSavedMeetings();
    refreshList();
    setExpandedMeetingId(null);
    setConfirmClearAll(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div
        className="w-full max-w-3xl max-h-[85vh] rounded-2xl glass-modal border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden select-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-16 px-6 border-b border-slate-800 flex items-center justify-between shrink-0 bg-dark-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Toplantı Arşivi</h2>
              <p className="text-xs text-slate-400">
                Geçmiş toplantı tutanakları, konuşmacılar ve detaylar
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3 border-b border-slate-800 bg-dark-950/60 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Toplantı başlığı veya konuşulan kelimelerde ara..."
              className="w-full pl-9 pr-4 py-2 bg-dark-900/80 border border-slate-800 focus:border-indigo-500 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition"
            />
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {filteredMeetings.length} toplantı
          </span>
        </div>

        {/* List of Meetings */}
        <div className="flex-1 p-6 overflow-y-auto space-y-3 bg-dark-950/40 custom-scrollbar">
          {filteredMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
              <FileText className="w-10 h-10 mb-3 text-slate-600" />
              <p className="text-sm font-medium">Henüz kayıtlı bir toplantı bulunmuyor.</p>
              <p className="text-xs text-slate-600 mt-1">
                Toplantı kaydını bitirdiğinizde tutanaklar otomatik olarak buraya arşivlenir.
              </p>
            </div>
          ) : (
            filteredMeetings.map(meeting => {
              const isExpanded = expandedMeetingId === meeting.id;
              const dateObj = new Date(meeting.createdAt);
              const formattedDate = dateObj.toLocaleDateString('tr-TR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={meeting.id}
                  className="rounded-xl border border-slate-800 bg-dark-900/70 overflow-hidden transition hover:border-slate-700/80"
                >
                  {/* Card Header / Summary Row */}
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {editingMeetingId === meeting.id ? (
                        <div className="flex items-center gap-1.5 mb-1" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editMeetingTitle}
                            onChange={e => setEditMeetingTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveRename(meeting.id);
                              if (e.key === 'Escape') setEditingMeetingId(null);
                            }}
                            className="px-2.5 py-1 text-xs bg-dark-900 border border-brand-500 rounded-lg text-white outline-none w-64"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRename(meeting.id)}
                            className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded transition"
                            title="Kaydet"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingMeetingId(null)}
                            className="p-1 text-slate-400 hover:bg-slate-700 rounded transition"
                            title="Vazgeç"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm text-white truncate max-w-md">
                            {meeting.title}
                          </h3>
                          <button
                            onClick={() => handleStartRename(meeting.id, meeting.title)}
                            className="p-1 text-slate-500 hover:text-slate-300 rounded transition"
                            title="Başlığı Düzenle"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          {formatDurationHuman(meeting.durationMs)}
                        </span>
                        <span>•</span>
                        <span>{formattedDate}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-slate-500" />
                          {meeting.speakers.length > 0
                            ? meeting.speakers.map(s => getSpeakerDisplayName(s)).join(', ')
                            : 'Bilinmeyen'}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {meeting.segments.length} segment
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onExportMeeting(meeting)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-dark-800 hover:bg-slate-700 border border-slate-700/80 transition"
                        title="Dışa Aktar"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Dışa Aktar
                      </button>

                      <button
                        onClick={() =>
                          setExpandedMeetingId(isExpanded ? null : meeting.id)
                        }
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition"
                      >
                        {isExpanded ? (
                          <>
                            Gizle <ChevronUp className="w-3.5 h-3.5" />
                          </>
                        ) : (
                          <>
                            İncele <ChevronDown className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>

                      {deletingMeetingId === meeting.id ? (
                        <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1 text-xs">
                          <span className="text-red-300 text-[11px]">Silinsin mi?</span>
                          <button
                            onClick={() => setDeletingMeetingId(null)}
                            className="px-1.5 py-0.5 rounded text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800 transition"
                          >
                            İptal
                          </button>
                          <button
                            onClick={() => handleConfirmDelete(meeting.id)}
                            className="px-1.5 py-0.5 rounded text-[11px] font-bold text-white bg-red-600 hover:bg-red-500 shadow-sm transition"
                          >
                            Sil
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingMeetingId(meeting.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                          title="Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Transcript Viewer */}
                  {isExpanded && (
                    <div className="border-t border-slate-800/80 bg-dark-950/70 p-4 max-h-64 overflow-y-auto space-y-2 select-text custom-scrollbar">
                      {meeting.segments.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">Segment bulunamadı.</p>
                      ) : (
                        meeting.segments.map((seg, idx) => (
                          <div key={idx} className="flex gap-2 text-xs leading-relaxed">
                            <span className="text-slate-500 font-mono shrink-0">
                              [{formatMsToShortTime(seg.start_ms)}]
                            </span>
                            <span className="font-semibold text-indigo-300 shrink-0">
                              {getSpeakerDisplayName(seg.speaker_id)}:
                            </span>
                            <span className="text-slate-200">{seg.text}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="h-16 px-6 border-t border-slate-800 bg-dark-900/80 flex items-center justify-between shrink-0">
          {meetings.length > 0 ? (
            !confirmClearAll ? (
              <button
                onClick={() => setConfirmClearAll(true)}
                className="text-xs text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1.5"
              >
                <AlertCircle className="w-3.5 h-3.5" />
                Tüm Arşivi Temizle
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-300 font-medium">Tüm arşiv silinsin mi?</span>
                <button
                  onClick={() => setConfirmClearAll(false)}
                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition"
                >
                  Vazgeç
                </button>
                <button
                  onClick={handleConfirmClearAll}
                  className="px-2.5 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg shadow-sm transition"
                >
                  Evet, Hepsini Sil
                </button>
              </div>
            )
          ) : (
            <div />
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-dark-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
