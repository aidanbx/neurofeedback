import { create } from 'zustand';
import type { MetricsSnapshot, AppState } from '../contracts';

interface DeviceStore {
  appState: AppState | null;
  metrics: MetricsSnapshot | null;
  metricsBatch: MetricsSnapshot[];
  setAppState: (s: AppState) => void;
  setMetrics: (m: MetricsSnapshot) => void;
  setMetricsBatch: (batch: MetricsSnapshot[]) => void;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  appState: null,
  metrics: null,
  metricsBatch: [],
  setAppState: (appState) => set({ appState }),
  setMetrics: (metrics) => set({ metrics }),
  setMetricsBatch: (batch) => set({
    metricsBatch: batch,
    metrics: batch.length > 0 ? batch[batch.length - 1] : null,
  }),
}));
