import { useState, useEffect, useCallback } from 'react';
import type { CapturableApp } from '../types';
import * as api from '../api';

export function useSystemAudio() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [capturableApps, setCapturableApps] = useState<CapturableApp[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const checkPermission = useCallback(async () => {
    try {
      const granted = await api.checkScreenCapturePermission();
      setHasPermission(granted);
      return granted;
    } catch (err) {
      console.error('Failed to check screen capture permission:', err);
      return false;
    }
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const granted = await api.requestScreenCapturePermission();
      setHasPermission(granted);
      return granted;
    } catch (err) {
      console.error('Failed to request screen capture permission:', err);
      return false;
    }
  }, []);

  const refreshApps = useCallback(async () => {
    try {
      const apps = await api.listCapturableApps();
      setCapturableApps(apps);
      return apps;
    } catch (err) {
      console.error('Failed to list capturable apps:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    checkPermission();
    refreshApps();
  }, [checkPermission, refreshApps]);

  const startCapture = useCallback(async (bundleId?: string) => {
    setIsLoading(true);
    try {
      await api.startSckCapture(bundleId);
      setIsCapturing(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stopCapture = useCallback(async () => {
    setIsLoading(true);
    try {
      await api.stopSckCapture();
      setIsCapturing(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    hasPermission,
    capturableApps,
    isCapturing,
    isLoading,
    checkPermission,
    requestPermission,
    refreshApps,
    startCapture,
    stopCapture,
  };
}
