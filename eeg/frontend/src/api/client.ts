// In Vite dev mode, /api is proxied. When loaded from file://, go direct to backend.
const BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8765/api' : '/api';

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
  getTrainingParams:  () => request<Record<string, unknown>>('/training/params'),
  setTrainingParams:  (params: Record<string, unknown>) =>
    request<{ ok: boolean }>('/training/params', { method: 'POST', body: JSON.stringify(params) }),
  resetBaseline:      () => request<{ ok: boolean }>('/training/reset-baseline', { method: 'POST', body: '{}' }),
  startTraining:      (program?: { id: string; title: string }) =>
    request<{ ok: boolean }>('/training/start', { method: 'POST', body: JSON.stringify({ program }) }),
  stopTraining:       () => request<{ ok: boolean; saved_to: string | null }>('/training/stop', { method: 'POST', body: '{}' }),
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
  getAudioTracks:     () => request<{ name: string; filename: string; url: string }[]>('/audio-tracks'),
  getPrograms:        () => request<{ id: string; title: string; description: string; version: string }[]>('/programs'),
};
