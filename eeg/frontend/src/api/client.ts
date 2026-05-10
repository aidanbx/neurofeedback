import type { PSDBaselineAggregate, ProgramManifest, ProgramParamsResponse, SessionEventInput } from '../contracts';
import { BACKEND_HTTP_ORIGIN } from '../config/appConfig';

// In Vite dev mode, /api is proxied. When loaded from file://, go direct to backend.
const BASE = window.location.protocol === 'file:' ? `${BACKEND_HTTP_ORIGIN}/api` : '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  getState:           () => request<unknown>('/state'),
  connectToggle:      () => request<{ ok: boolean }>('/connect-toggle', { method: 'POST', body: '{}' }),
  toggleTestMode:     (sessionId?: string) =>
    request<{ ok: boolean; result: string }>('/test-mode', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId ?? null }),
    }),
  artifactToggle:     () => request<{ ok: boolean }>('/artifact-toggle', { method: 'POST', body: '{}' }),
  notchToggle:        () => request<{ ok: boolean; value: boolean }>('/notch-toggle', { method: 'POST', body: '{}' }),
  setMetricInterval:  (interval_sec: number) =>
    request<{ ok: boolean; interval_sec: number }>('/set-metric-interval', {
      method: 'POST', body: JSON.stringify({ interval_sec }),
    }),
  getMetricsParams:   () => request<Record<string, unknown>>('/metrics/params'),
  getPsdBaseline:     () => request<PSDBaselineAggregate>('/metrics/psd-baseline'),
  setMetricsParams:   (params: Record<string, unknown>) =>
    request<{ ok: boolean; params: Record<string, unknown>; changes: Record<string, unknown> }>(
      '/metrics/params',
      { method: 'POST', body: JSON.stringify(params) },
    ),
  getTrainingParams:  () => request<Record<string, unknown>>('/training/params'),
  setTrainingParams:  (params: Record<string, unknown>) =>
    request<{ ok: boolean }>('/training/params', { method: 'POST', body: JSON.stringify(params) }),
  getProgramParams:   (id: string) => request<ProgramParamsResponse>(`/programs/${encodeURIComponent(id)}/params`),
  setProgramParams:   (id: string, params: Record<string, unknown>) =>
    request<{ ok: boolean; program_id: string; params: Record<string, unknown>; changes: Record<string, unknown> }>(
      `/programs/${encodeURIComponent(id)}/params`,
      { method: 'POST', body: JSON.stringify(params) },
    ),
  logEvent:           (event: SessionEventInput) =>
    request<{ ok: boolean; event?: unknown; error?: string }>('/session/log', {
      method: 'POST',
      body: JSON.stringify(event),
    }),
  resetBaseline:      () => request<{ ok: boolean }>('/training/reset-baseline', { method: 'POST', body: '{}' }),
  startTraining:      (program?: { id: string; title: string }) =>
    request<{ ok: boolean }>('/training/start', { method: 'POST', body: JSON.stringify({ program }) }),
  stopTraining:       (options?: { save?: boolean; notes?: string; analyze?: boolean; include_psd_baseline?: boolean }) =>
    request<{ ok: boolean; saved_to: string | null; pending?: boolean }>(
      '/training/stop',
      { method: 'POST', body: JSON.stringify(options ?? {}) },
    ),
  saveStoppedTraining: (notes?: string, includePsdBaseline = false) =>
    request<{ ok: boolean; saved_to: string | null }>('/training/save', {
      method: 'POST',
      body: JSON.stringify({ notes: notes ?? '', analyze: true, include_psd_baseline: includePsdBaseline }),
    }),
  discardStoppedTraining: () =>
    request<{ ok: boolean }>('/training/discard', { method: 'POST', body: '{}' }),
  getSessions:        () => request<unknown[]>('/sessions'),
  getNote:            (id: string) => request<unknown>(`/session/note?id=${encodeURIComponent(id)}`),
  saveNote:           (id: string, content: string) =>
    request<{ ok: boolean }>('/session/note', { method: 'POST', body: JSON.stringify({ id, content }) }),
  appendNote:         (text: string, elapsed_sec: number) =>
    request<{ ok: boolean }>('/session/note/append', { method: 'POST', body: JSON.stringify({ text, elapsed_sec }) }),
  toggleFavorite:     (id: string, favorite: boolean) =>
    request<{ ok: boolean; new_id: string }>('/session/favorite', { method: 'POST', body: JSON.stringify({ id, favorite }) }),
  archiveSessions:    (ids: string[]) =>
    request<{ ok: boolean; moved: string[] }>('/session/archive', { method: 'POST', body: JSON.stringify({ ids }) }),
  deleteSessions:     (ids: string[]) =>
    request<{ ok: boolean; deleted: string[]; errors: string[] }>('/session/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  getAudioTracks:     () => request<{ name: string; filename: string; url: string }[]>('/audio-tracks'),
  getPrograms:        () => request<ProgramManifest[]>('/programs'),
};
