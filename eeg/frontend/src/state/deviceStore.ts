import { create } from 'zustand';
import type { MetricsSnapshot, AppState } from '../contracts';

interface DeviceStore {
  appState: AppState | null;
  metrics: MetricsSnapshot | null;
  setAppState: (s: AppState) => void;
  setMetrics: (m: MetricsSnapshot) => void;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  appState: null,
  metrics: null,
  setAppState: (appState) => set({ appState }),
  setMetrics: (metrics) => set({ metrics }),
}));
