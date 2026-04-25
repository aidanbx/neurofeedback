import { lazy, Suspense } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { useProgramStore } from '../state/programStore';

const viewModules = import.meta.glob<{ default: ComponentType }>('./*/view.tsx');
const viewCache = new Map<string, LazyExoticComponent<ComponentType>>();

function viewForProgram(programId: string) {
  const key = `./${programId}/view.tsx`;
  const loader = viewModules[key];
  if (!loader) return null;
  const cached = viewCache.get(key);
  if (cached) return cached;
  const View = lazy(loader);
  viewCache.set(key, View);
  return View;
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
