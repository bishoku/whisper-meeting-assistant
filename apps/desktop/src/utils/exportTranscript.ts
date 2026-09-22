export interface ExportableSegment {
  speaker_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface ExportMeetingOptions {
  title: string;
  dateStr?: string;
  durationMs: number;
  segments: ExportableSegment[];
  getSpeakerDisplayName: (id: string) => string;
}

export function formatMsToSrtTime(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = safeMs % 1000;

  const hStr = hours.toString().padStart(2, '0');
  const mStr = minutes.toString().padStart(2, '0');
  const sStr = seconds.toString().padStart(2, '0');
  const msStr = millis.toString().padStart(3, '0');

  return `${hStr}:${mStr}:${sStr},${msStr}`;
}

export function formatMsToShortTime(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDurationHuman(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} dk ${s} sn`;
}

export function exportToTxt({
  title,
  dateStr = new Date().toLocaleString('tr-TR'),
  durationMs,
  segments,
  getSpeakerDisplayName,
}: ExportMeetingOptions): string {
  const header = `${title.toUpperCase()}\nTarih: ${dateStr}\nToplam Süre: ${formatDurationHuman(durationMs)}\nSegment Sayısı: ${segments.length}\n${'='.repeat(45)}\n\n`;

  const body = segments
    .map(seg => {
      const spk = getSpeakerDisplayName(seg.speaker_id);
      const time = `${formatMsToShortTime(seg.start_ms)} - ${formatMsToShortTime(seg.end_ms)}`;
      return `[${time}] ${spk}: ${seg.text.trim()}`;
    })
    .join('\n\n');

  return header + body;
}

export function exportToSrt({
  segments,
  getSpeakerDisplayName,
}: ExportMeetingOptions): string {
  return segments
    .map((seg, index) => {
      const spk = getSpeakerDisplayName(seg.speaker_id);
      const start = formatMsToSrtTime(seg.start_ms);
      const end = formatMsToSrtTime(seg.end_ms);
      return `${index + 1}\n${start} --> ${end}\n${spk}: ${seg.text.trim()}\n`;
    })
    .join('\n');
}

export function exportToMarkdown({
  title,
  dateStr = new Date().toLocaleString('tr-TR'),
  durationMs,
  segments,
  getSpeakerDisplayName,
}: ExportMeetingOptions): string {
  const header = `# ${title}\n\n- **Tarih:** ${dateStr}\n- **Toplam Süre:** ${formatDurationHuman(durationMs)}\n- **Konuşma Parçaları:** ${segments.length}\n\n---\n\n### Toplantı Transkripti\n\n`;

  const body = segments
    .map(seg => {
      const spk = getSpeakerDisplayName(seg.speaker_id);
      const time = `${formatMsToShortTime(seg.start_ms)} - ${formatMsToShortTime(seg.end_ms)}`;
      return `**${spk}** \`[${time}]\`\n${seg.text.trim()}\n`;
    })
    .join('\n');

  return header + body;
}

export function exportToJson({
  title,
  dateStr = new Date().toISOString(),
  durationMs,
  segments,
  getSpeakerDisplayName,
}: ExportMeetingOptions): string {
  const data = {
    title,
    date: dateStr,
    duration_ms: durationMs,
    segment_count: segments.length,
    segments: segments.map(seg => ({
      speaker_id: seg.speaker_id,
      speaker_name: getSpeakerDisplayName(seg.speaker_id),
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      text: seg.text.trim(),
    })),
  };
  return JSON.stringify(data, null, 2);
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}
