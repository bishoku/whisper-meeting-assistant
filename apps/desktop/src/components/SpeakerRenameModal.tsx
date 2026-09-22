import React, { useState, useEffect, useRef } from 'react';
import { X, Check, User, Sparkles, GitMerge, Trash2 } from 'lucide-react';
import { getSpeakerColor } from './ParticipantBar';

interface SpeakerRenameModalProps {
  isOpen: boolean;
  speakerId: string | null;
  currentName: string;
  availableSpeakers?: string[];
  getSpeakerDisplayName?: (id: string) => string;
  onSave: (id: string, newName: string) => void;
  onMerge?: (sourceId: string, targetId: string) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

const QUICK_SUGGESTIONS = [
  'Ahmet', 'Mehmet', 'Ayşe', 'Fatma', 'Ali', 'Zeynep',
  'Müşteri', 'Yönetici', 'Sunucu', 'Moderatör'
];

export const SpeakerRenameModal: React.FC<SpeakerRenameModalProps> = ({
  isOpen,
  speakerId,
  currentName,
  availableSpeakers = [],
  getSpeakerDisplayName,
  onSave,
  onMerge,
  onDelete,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(currentName || speakerId || '');
      setConfirmDelete(false);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, speakerId, currentName]);

  if (!isOpen || !speakerId) return null;

  const colors = getSpeakerColor(speakerId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(speakerId, name.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-md rounded-2xl glass-modal border border-slate-700/80 shadow-2xl p-6 relative select-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Title & Avatar */}
        <div className="flex items-center gap-3.5 mb-5">
          <div className={`w-11 h-11 rounded-xl bg-gradient-to-tr ${colors.bg} flex items-center justify-center text-white font-bold shadow-md shadow-brand-500/10`}>
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Konuşmacıyı Yeniden Adlandır</h2>
            <p className="text-xs text-slate-400 font-mono">
              Orijinal ID: <span className="text-slate-300">{speakerId}</span>
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-4 leading-relaxed">
          Bu konuşmacının adını değiştirdiğinizde, toplantıdaki tüm geçmiş ve gelecek konuşmaları bu isimle gösterilecektir.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Görüntülenecek İsim
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Örn: Ahmet Bey, Ayşe Yılmaz"
              className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900/80 border border-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 text-white placeholder-slate-500 text-sm outline-none transition"
              maxLength={40}
            />
          </div>

          {/* Quick Suggestions */}
          <div className="mb-6">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 mb-2">
              <Sparkles className="w-3 h-3 text-brand-400" />
              <span>Hızlı Öneriler:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SUGGESTIONS.map(sug => (
                <button
                  type="button"
                  key={sug}
                  onClick={() => setName(sug)}
                  className="px-2.5 py-1 rounded-lg text-xs bg-dark-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 hover:bg-slate-800 transition"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800/80 transition"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 shadow-md shadow-brand-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Check className="w-3.5 h-3.5" />
              Kaydet
            </button>
          </div>
        </form>

        {/* Speaker Merge Section */}
        {onMerge && availableSpeakers.filter(id => id !== speakerId).length > 0 && (
          <div className="pt-4 mt-5 border-t border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
              <GitMerge className="w-3.5 h-3.5 text-amber-400" />
              <span>Başka Bir Katılımcı ile Birleştir</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
              Bu konuşmacı aslında toplantıdaki başka bir katılımcıysa, iki profili ve konuşma geçmişini tek bir isim altında birleştirebilirsiniz.
            </p>
            <div className="flex items-center gap-2">
              <select
                value={mergeTarget}
                onChange={e => setMergeTarget(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl bg-dark-900 border border-slate-700 text-slate-200 text-xs outline-none focus:border-brand-500 transition"
              >
                <option value="">Hedef katılımcıyı seçin...</option>
                {availableSpeakers
                  .filter(id => id !== speakerId)
                  .map(id => (
                    <option key={id} value={id}>
                      {getSpeakerDisplayName ? getSpeakerDisplayName(id) : id} ({id})
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!mergeTarget}
                onClick={() => {
                  if (mergeTarget && onMerge) {
                    onMerge(speakerId, mergeTarget);
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <GitMerge className="w-3.5 h-3.5" />
                Birleştir
              </button>
            </div>
          </div>
        )}

        {/* Delete Section */}
        {onDelete && (
          <div className="p-4 border-t border-slate-800 bg-red-500/5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-1">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>Profili Sil</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Bu kişinin ses profilini kalıcı olarak siler. Gelecekteki toplantılarda baştan tanımlanır.
                </p>
              </div>
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition ml-4"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Sil
                </button>
              ) : (
                <div className="shrink-0 flex items-center gap-2 ml-4">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800 transition"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(speakerId);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-500 shadow-md shadow-red-600/30 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Emin misiniz? Sil
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
