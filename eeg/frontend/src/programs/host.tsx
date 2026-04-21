import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { useProgramStore } from '../state/programStore';

const viewModules = import.meta.glob<{ default: ComponentType }>('./*/view.tsx');

function viewForProgram(programId: string) {
  const key = `./${programId}/view.tsx`;
  const loader = viewModules[key];
  return loader ? lazy(loader) : null;
}

export function ProgramHost() {
  const programId = useProgramStore((s) => s.activeProgramId);

  if (!programId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 36, opacity: 0.3 }}>◉</div>
        <div>Select a program from the sidebar</div>
      </div>
    );
  }

  const View = viewForProgram(programId);
  if (!View) {
    return (
      <div style={{ padding: 24, color: 'var(--poor)' }}>
        Program view is missing for backend program: {programId}
      </div>
    );
  }

  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>}>
      <View />
    </Suspense>
  );
}
