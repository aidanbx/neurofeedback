import React, { lazy, Suspense } from 'react';
import { useProgramStore } from '../state/programStore';

const VIEWS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  alpha_feedback:    lazy(() => import('./alpha_feedback/view')),
  alpha_theta_beta:  lazy(() => import('./alpha_theta_beta/view')),
};

export function ProgramHost() {
  const programId = useProgramStore((s) => s.activeProgramId);
  if (!programId) return <div style={{ padding: 24, color: '#666' }}>No program selected.</div>;

  const View = VIEWS[programId];
  if (!View) return <div style={{ padding: 24, color: '#e05050' }}>Unknown program: {programId}</div>;

  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#666' }}>Loading…</div>}>
      <View />
    </Suspense>
  );
}
