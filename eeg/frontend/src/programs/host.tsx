import { lazy, Suspense } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { useProgramStore } from '../state/programStore';

const VIEWS: Record<string, LazyExoticComponent<ComponentType>> = {
  alpha_feedback:   lazy(() => import('./alpha_feedback/view')),
  alpha_theta_beta: lazy(() => import('./alpha_theta_beta/view')),
  debug:            lazy(() => import('./debug/view')),
};

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

  const View = VIEWS[programId];
  if (!View) return <div style={{ padding: 24, color: 'var(--poor)' }}>Unknown program: {programId}</div>;

  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>}>
      <View />
    </Suspense>
  );
}
