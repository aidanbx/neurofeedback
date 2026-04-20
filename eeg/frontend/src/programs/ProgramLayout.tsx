import type { ReactNode } from 'react';
import { useDeviceStore } from '../state/deviceStore';
import { QualityBadge } from '../components/session/QualityBadge';
import { ElapsedTimer } from '../components/session/ElapsedTimer';
import { NoteInput } from '../components/session/NoteInput';

interface Props {
  title: string;
  mode?: string;
  statusText?: string;
  calibrating?: boolean;
  calibrationPct?: number;
  main: ReactNode;
  sidebar: ReactNode;
}

function RecDot({ recording }: { recording: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: recording ? 'var(--poor)' : 'var(--border)',
      boxShadow: recording ? '0 0 6px var(--poor)' : 'none',
      flexShrink: 0,
    }} />
  );
}

export function ProgramLayout({ title, mode, statusText, calibrating, calibrationPct = 0, main, sidebar }: Props) {
  const appState = useDeviceStore((s) => s.appState);
  const metrics  = useDeviceStore((s) => s.metrics);
  const recording = appState?.recording ?? false;
  const elapsed   = metrics?.elapsed_sec ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 12px', flexShrink: 0,
        background: 'var(--panel)', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.04em' }}>{title}</span>
        {mode && <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px' }}>{mode}</span>}
        {metrics && <>
          <QualityBadge label={metrics.quality_label} score={metrics.quality_score} />
          {recording && <ElapsedTimer elapsed={elapsed} />}
          <RecDot recording={recording} />
        </>}
        {statusText && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{statusText}</span>}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        {/* Main column */}
        <div style={{ position: 'relative', overflow: 'auto', display: 'flex', flexDirection: 'column', background: '#05060a', borderRight: '1px solid var(--border)' }}>
          <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {main}
          </div>

          {/* Calibration overlay */}
          {calibrating && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(5,6,10,0.88)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
              zIndex: 10,
            }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Calibrating baseline</div>
              <div style={{ width: 220, height: 4, background: '#2a2a3e', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(calibrationPct)}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{Math.round(calibrationPct)}%</div>
            </div>
          )}

          {/* Note input, only while recording */}
          {recording && <NoteInput elapsed={elapsed} />}
        </div>

        {/* Sidebar */}
        <div style={{ overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--sidebar)' }}>
          {sidebar}
        </div>
      </div>
    </div>
  );
}
