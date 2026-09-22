import { SavedMeeting } from '../types';

const STORAGE_KEY = 'whisper_saved_meetings';

export function getSavedMeetings(): SavedMeeting[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.error('Failed to load saved meetings from localStorage:', err);
    return [];
  }
}

export function saveMeeting(
  meeting: Omit<SavedMeeting, 'id' | 'createdAt'>,
): SavedMeeting {
  const all = getSavedMeetings();
  const newMeeting: SavedMeeting = {
    ...meeting,
    id: `meet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };

  const updated = [newMeeting, ...all];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save meeting to localStorage:', err);
  }
  return newMeeting;
}

export function updateMeetingTitle(id: string, newTitle: string): void {
  const all = getSavedMeetings();
  const updated = all.map(m => (m.id === id ? { ...m, title: newTitle.trim() || m.title } : m));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to update meeting title in localStorage:', err);
  }
}

export function deleteSavedMeeting(id: string): void {
  const all = getSavedMeetings();
  const updated = all.filter(m => m.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to delete meeting from localStorage:', err);
  }
}

export function clearAllSavedMeetings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear saved meetings from localStorage:', err);
  }
}

export function searchSavedMeetings(query: string): SavedMeeting[] {
  const all = getSavedMeetings();
  const cleanQ = query.trim().toLocaleLowerCase('tr-TR');
  if (!cleanQ) return all;

  return all.filter(meeting => {
    if (meeting.title.toLocaleLowerCase('tr-TR').includes(cleanQ)) {
      return true;
    }
    return meeting.segments.some(seg =>
      seg.text.toLocaleLowerCase('tr-TR').includes(cleanQ),
    );
  });
}
