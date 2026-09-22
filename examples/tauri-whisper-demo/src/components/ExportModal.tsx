import React, { useState, useMemo } from 'react';
import { X, Copy, Check, Download, FileText, Code, File, Film } from 'lucide-react';
import {
  exportToMarkdown,
  exportToTxt,
  exportToSrt,
  exportToJson,
  downloadFile,
  copyToClipboard,
  ExportableSegment,
} from '../utils/exportTranscript';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  segments: ExportableSegment[];
  meetingDuration: number;
  getSpeakerDisplayName: (id: string) => string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  title = 'Toplantı Tutanağı',
  segments,
  meetingDuration,
  getSpeakerDisplayName,
}) => {
  const [format, setFormat] = useState<'markdown' | 'txt' | 'srt' | 'json'>('markdown');
  const [copied, setCopied] = useState(false);

  const exportContent = useMemo(() => {
    if (segments.length === 0) return '';

    const opts = {
      title,
      durationMs: meetingDuration * 1000,
      segments,
      getSpeakerDisplayName,
    };

    switch (format) {
      case 'markdown':
        return exportToMarkdown(opts);
      case 'txt':
        return exportToTxt(opts);
      case 'srt':
        return exportToSrt(opts);
      case 'json':
        return exportToJson(opts);
      default:
        return '';
    }
  }, [segments, meetingDuration, format, title, getSpeakerDisplayName]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!exportContent) return;
    const ok = await copyToClipboard(exportContent);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!exportContent) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const sanitizedTitle = title.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9]/gi, '_');

    let ext = 'md';
    let mime = 'text/markdown';
    if (format === 'txt') {
      ext = 'txt';
      mime = 'text/plain';
    } else if (format === 'srt') {
      ext = 'srt';
      mime = 'application/x-subrip';
    } else if (format === 'json') {
      ext = 'json';
      mime = 'application/json';
    }

    const filename = `${sanitizedTitle}_${dateStr}.${ext}`;
    downloadFile(exportContent, filename, mime);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-2xl glass-modal border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden select-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-16 px-6 border-b border-slate-800 flex items-center justify-between shrink-0 bg-dark-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{title} — Dışa Aktar</h2>
              <p className="text-xs text-slate-400">Transkripti farklı formatlarda kopyalayın veya kaydedin</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Selector */}
        <div className="px-6 py-3 border-b border-slate-800 bg-dark-950/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFormat('markdown')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                format === 'markdown'
                  ? 'bg-brand-900/30 border-brand-500 text-white'
                  : 'bg-dark-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Markdown (.md)
            </button>

            <button
              onClick={() => setFormat('txt')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                format === 'txt'
                  ? 'bg-brand-900/30 border-brand-500 text-white'
                  : 'bg-dark-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <File className="w-3.5 h-3.5" />
              Düz Metin (.txt)
            </button>

            <button
              onClick={() => setFormat('srt')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                format === 'srt'
                  ? 'bg-brand-900/30 border-brand-500 text-white'
                  : 'bg-dark-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              Altyazı (.srt)
            </button>

            <button
              onClick={() => setFormat('json')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                format === 'json'
                  ? 'bg-brand-900/30 border-brand-500 text-white'
                  : 'bg-dark-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              JSON (.json)
            </button>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            {segments.length} segment
          </div>
        </div>

        {/* Preview Area */}
        <div className="flex-1 p-6 overflow-y-auto bg-dark-950 select-text">
          <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
            {exportContent || 'Dışa aktarılacak metin bulunamadı.'}
          </pre>
        </div>

        {/* Footer */}
        <div className="h-16 px-6 border-t border-slate-800 bg-dark-900/80 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
          >
            Kapat
          </button>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleCopy}
              disabled={segments.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-dark-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Kopyalandı!' : 'Panoya Kopyala'}
            </button>

            <button
              onClick={handleDownload}
              disabled={segments.length === 0}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 shadow-md shadow-brand-600/30 disabled:opacity-40 transition"
            >
              <Download className="w-3.5 h-3.5" />
              Dosya İndir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
