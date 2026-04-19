import { create } from 'zustand';
import type { ProgramOutput } from '../contracts';

interface ProgramStore {
  activeProgramId: string | null;
  programOutput: ProgramOutput | null;
  setActiveProgramId: (id: string | null) => void;
  setOutput: (out: ProgramOutput | null) => void;
}

export const useProgramStore = create<ProgramStore>((set) => ({
  activeProgramId: null,
  programOutput: null,
  setActiveProgramId: (activeProgramId) => set({ activeProgramId }),
  setOutput: (programOutput) => set({ programOutput }),
}));
