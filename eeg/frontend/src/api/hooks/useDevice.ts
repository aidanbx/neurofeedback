import { useCallback } from 'react';
import { api } from '../client';
import { useDeviceStore } from '../../state/deviceStore';
import type { AppState } from '../../contracts';

export function useDevice() {
  const setAppState = useDeviceStore((s) => s.setAppState);

  const refreshState = useCallback(async () => {
    try {
      const s = await api.getState();
      setAppState(s as AppState);
    } catch {}
  }, [setAppState]);

  const connectToggle = useCallback(async () => {
    await api.connectToggle();
    await refreshState();
  }, [refreshState]);

  const toggleTestMode = useCallback(async (sessionId?: string) => {
    await api.toggleTestMode(sessionId);
    await refreshState();
  }, [refreshState]);

  const toggleNotch = useCallback(async () => {
    await api.notchToggle();
    await refreshState();
  }, [refreshState]);

  const toggleArtifactRejection = useCallback(async () => {
    await api.artifactToggle();
    await refreshState();
  }, [refreshState]);

  return { refreshState, connectToggle, toggleTestMode, toggleNotch, toggleArtifactRejection };
}
