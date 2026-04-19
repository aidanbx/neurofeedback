import React, { useEffect, useState } from 'react';
import { useEEGStream } from './api/hooks/useEEGStream';
import { useDevice } from './api/hooks/useDevice';
import { useDeviceStore } from './state/deviceStore';
import { useProgramStore } from './state/programStore';
import { ProgramHost } from './programs/host';
import { QualityBadge } from './components/session/QualityBadge';
import { ElapsedTimer } from './components/session/ElapsedTimer';
import { api } from './api/client';
import type { AppState } from './contracts';

const STYLE: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d16', color: '#ddd', fontFamily: 'ui-monospace, monospace', fontSize: 13 },
  topbar:  { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#13131e', borderBottom: '1px solid #1e1e2c' },
  content: { flex: 1, overflow: 'auto', display: 'flex' },
  sidebar: { width: 200, background: '#13131e', borderRight: '1px solid #1e1e2c', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  main:    { flex: 1, overflow: 'auto' },
  btn:     { padding: '4px 10px', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 },
};

interface ProgramMeta { id: string; title: string; description: string }

export default function App() {
  useEEGStream();
  const { connectToggle, toggleTestMode } = useDevice();
  const appState      = useDeviceStore((s) => s.appState);
  const metrics       = useDeviceStore((s) => s.metrics);
  const programId     = useProgramStore((s) => s.activeProgramId);
  const setProgram    = useProgramStore((s) => s.setActiveProgramId);
  const [programs, setPrograms] = useState<ProgramMeta[]>([]);

  useEffect(() => {
    api.getPrograms().then(setPrograms).catch(() => {});
  }, []);

  // Poll state every 2s for connection/recording status
  useEffect(() => {
    const tick = async () => {
      try {
        const s = await api.getState();
        useDeviceStore.getState().setAppState(s as AppState);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  const connected = appState?.connection_state === 'connected' || appState?.connection_state === 'replay';
  const recording = appState?.recording ?? false;

  return (
    <div style={STYLE.root}>
      <div style={STYLE.topbar}>
        <span style={{ fontWeight: 700, letterSpacing: '0.05em', color: '#88aaff' }}>EEG</span>
        <button
          style={{ ...STYLE.btn, background: connected ? '#27ae60' : '#2c3e50', color: '#fff' }}
          onClick={() => connectToggle()}
        >
          {appState?.connection_state ?? 'disconnected'}
        </button>
        <button
          style={{ ...STYLE.btn, background: appState?.test_mode ? '#e67e22' : '#2c3e50', color: '#fff' }}
          onClick={() => toggleTestMode()}
        >
          {appState?.test_mode ? 'Test ON' : 'Test Mode'}
        </button>
        {recording && metrics && (
          <>
            <QualityBadge label={metrics.quality_label} score={metrics.quality_score} />
            <ElapsedTimer elapsed={metrics.elapsed_sec} />
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#666', fontSize: 11 }}>
          {appState?.status_message ?? ''}
        </span>
      </div>

      <div style={STYLE.content}>
        <div style={STYLE.sidebar}>
          <div style={{ fontSize: '0.7em', textTransform: 'uppercase', color: '#555', marginBottom: 4 }}>Programs</div>
          {programs.map((p) => (
            <button
              key={p.id}
              onClick={() => setProgram(p.id)}
              style={{
                ...STYLE.btn,
                background: programId === p.id ? '#2980b9' : '#1e1e2c',
                color: '#ddd',
                textAlign: 'left',
              }}
            >
              {p.title}
            </button>
          ))}
        </div>
        <div style={STYLE.main}>
          <ProgramHost />
        </div>
      </div>
    </div>
  );
}
