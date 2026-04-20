import { useState, useEffect, useRef } from 'react';
import { useEEGStream } from './api/hooks/useEEGStream';
import { useDevice } from './api/hooks/useDevice';
import { useDeviceStore } from './state/deviceStore';
import { useProgramStore } from './state/programStore';
import { ProgramHost } from './programs/host';
import { SessionsList } from './views/SessionsView';
import { SessionDetail } from './views/SessionsView';
import { api } from './api/client';
import type { AppState, SessionMeta } from './contracts';

type SidebarTab = 'settings' | 'programs' | 'sessions';
interface ProgramMeta { id: string; title: string; description: string }

// ── Icons ──────────────────────────────────────────────────────────────────────
const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const BrainIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.04-4.79A3 3 0 0 1 5 12a3 3 0 0 1 2-2.83V8.5A2.5 2.5 0 0 1 9.5 2z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.04-4.79A3 3 0 0 0 19 12a3 3 0 0 0-2-2.83V8.5A2.5 2.5 0 0 0 14.5 2z"/>
  </svg>
);
const HistoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);

export default function App() {
  useEEGStream();
  const { connectToggle, toggleTestMode } = useDevice();
  const appState   = useDeviceStore((s) => s.appState);
  const programId  = useProgramStore((s) => s.activeProgramId);
  const setProgram = useProgramStore((s) => s.setActiveProgramId);

  const [programs, setPrograms]       = useState<ProgramMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab]   = useState<SidebarTab>('programs');
  const [selectedSession, setSelectedSession] = useState<SessionMeta | null>(null);
  const programsRef = useRef(programs);
  programsRef.current = programs;

  // Poll backend state + lazy-load programs on first successful response
  useEffect(() => {
    const tick = async () => {
      try {
        const s = await api.getState();
        useDeviceStore.getState().setAppState(s as AppState);
        if (programsRef.current.length === 0) {
          const progs = await api.getPrograms();
          setPrograms(progs as ProgramMeta[]);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  // Toggle sidebar: same tab = close; different tab = switch; closed = open
  const toggleTab = (tab: SidebarTab) => {
    if (sidebarOpen && sidebarTab === tab) setSidebarOpen(false);
    else { setSidebarOpen(true); setSidebarTab(tab); }
  };

  const connected = appState?.connection_state === 'connected' || appState?.connection_state === 'replay';
  const connState = appState?.connection_state ?? 'disconnected';
  const connColor = connected ? 'var(--good)' : connState === 'scanning' ? 'var(--fair)' : 'var(--muted)';

  return (
    <div style={{ position: 'relative', display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Icon strip ─────────────────────────────────────────────────────── */}
      <div style={{
        width: 42, flexShrink: 0, zIndex: 200,
        background: 'var(--sidebar)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 8, gap: 2,
      }}>
        <button className={`strip-btn${sidebarOpen && sidebarTab === 'settings'  ? ' active' : ''}`} onClick={() => toggleTab('settings')}  title="Settings"><GearIcon /></button>
        <button className={`strip-btn${sidebarOpen && sidebarTab === 'programs'  ? ' active' : ''}`} onClick={() => toggleTab('programs')}  title="Programs"><BrainIcon /></button>
        <button className={`strip-btn${sidebarOpen && sidebarTab === 'sessions'  ? ' active' : ''}`} onClick={() => toggleTab('sessions')}  title="Sessions"><HistoryIcon /></button>
      </div>

      {/* ── Main content (always full-width behind sidebar) ─────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selectedSession
          ? <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} />
          : <ProgramHost />}
      </div>

      {/* ── Click-outside backdrop ──────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          style={{ position: 'absolute', inset: 0, left: 42, zIndex: 90 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Overlay sidebar ─────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', left: 42, top: 0, bottom: 0,
        width: sidebarOpen ? 280 : 0,
        overflow: 'hidden',
        transition: 'width 0.16s ease',
        zIndex: 100,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--border)',
        boxShadow: sidebarOpen ? '6px 0 24px rgba(0,0,0,0.55)' : 'none',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Inner wrapper (fixed 280px so content doesn't animate) */}
        <div style={{ width: 280, display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(['settings', 'programs', 'sessions'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSidebarTab(tab)}
                style={{
                  flex: 1, padding: '7px 4px',
                  background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${sidebarTab === tab ? 'var(--accent)' : 'transparent'}`,
                  color: sidebarTab === tab ? 'var(--text)' : 'var(--muted)',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'color 0.1s, border-color 0.1s',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>

            {sidebarTab === 'settings' && <>
              <div className="nf-section-title">Connection</div>
              <button className={`btn btn-full${connected ? ' active' : ''}`} onClick={() => connectToggle()}>
                {connState}
              </button>
              <button className={`btn btn-full${appState?.test_mode ? ' active' : ''}`} onClick={() => toggleTestMode()}>
                Test mode
              </button>
              <div style={{ marginTop: 4 }}>
                <div className="nf-section-title">Status</div>
                <div style={{ fontSize: 11, color: connColor, fontWeight: 600, marginTop: 5 }}>{connState}</div>
                {appState?.status_message && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.6 }}>
                    {appState.status_message}
                  </div>
                )}
              </div>
            </>}

            {sidebarTab === 'programs' && <>
              <div className="nf-section-title">Programs</div>
              {programs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Waiting for backend…</div>
              )}
              {programs.map((p) => (
                <button
                  key={p.id}
                  className={`btn btn-full${programId === p.id ? ' active' : ''}`}
                  style={{
                    justifyContent: 'flex-start',
                    borderLeft: `2px solid ${programId === p.id ? 'var(--accent)' : 'transparent'}`,
                    borderRadius: '0 3px 3px 0',
                  }}
                  onClick={() => {
                    setProgram(p.id);
                    setSelectedSession(null);
                    setSidebarOpen(false);
                  }}
                >
                  {p.title}
                </button>
              ))}
            </>}

            {sidebarTab === 'sessions' && (
              <SessionsList
                onSelect={(session) => {
                  setSelectedSession(session);
                  setSidebarOpen(false);
                }}
                selectedId={selectedSession?.id ?? null}
              />
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
