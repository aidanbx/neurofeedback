import { create } from 'zustand';
import type { SessionMeta } from '../contracts';

interface SessionStore {
  sessions: SessionMeta[];
  selectedSessionId: string | null;
  setSessions: (s: SessionMeta[]) => void;
  setSelectedSession: (id: string | null) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  selectedSessionId: null,
  setSessions: (sessions) => set({ sessions }),
  setSelectedSession: (selectedSessionId) => set({ selectedSessionId }),
}));
