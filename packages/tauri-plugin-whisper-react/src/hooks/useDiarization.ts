import { useState, useEffect, useCallback } from 'react';
import type { VoiceProfile } from '../types';
import * as api from '../api';

export function useDiarization(initialThreshold: number = 0.70) {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [threshold, setThresholdState] = useState<number>(initialThreshold);
  const [isLoading, setIsLoading] = useState(false);

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await api.getVoiceProfiles();
      setProfiles(list);
      return list;
    } catch (err) {
      console.error('Failed to get voice profiles:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  const setThreshold = useCallback(async (val: number) => {
    setThresholdState(val);
    try {
      await api.setDiarizationThreshold(val);
    } catch (err) {
      console.error('Failed to set diarization threshold:', err);
    }
  }, []);

  const renameProfile = useCallback(async (speakerId: number, name: string) => {
    setIsLoading(true);
    try {
      await api.renameVoiceProfile(speakerId, name);
      await refreshProfiles();
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfiles]);

  const deleteProfile = useCallback(async (speakerId: number) => {
    setIsLoading(true);
    try {
      await api.deleteVoiceProfile(speakerId);
      await refreshProfiles();
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfiles]);

  const clearProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      await api.clearVoiceProfiles();
      await refreshProfiles();
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfiles]);

  const mergeSpeakers = useCallback(async (targetSpeakerId: number, sourceSpeakerId: number) => {
    setIsLoading(true);
    try {
      await api.mergeSpeakers(targetSpeakerId, sourceSpeakerId);
      await refreshProfiles();
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfiles]);

  return {
    profiles,
    threshold,
    isLoading,
    refreshProfiles,
    setThreshold,
    renameProfile,
    deleteProfile,
    clearProfiles,
    mergeSpeakers,
  };
}
