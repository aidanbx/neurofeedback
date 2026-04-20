import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SessionMeta } from '../contracts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function AnalysisBadge({ status }: { status: string }) {
  const color = status === 'done' ? 'var(--good)' : status === 'running' ? 'var(--fair)' : status === 'error' ? 'var(--poor)' : 'var(--muted)';
  return <span style={{ fontSize: 10, color, fontWeight: 600 }}>{status || '—'}</span>;
}

const NoteIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);

// ── SessionsList (used in sidebar) ────────────────────────────────────────────

interface ListProps {
  onSelect: (session: SessionMeta) => void;
  selectedId: string | null;
}

export function SessionsList({ onSelect, selectedId }: ListProps) {
  const [sessions, setSessions]     = useState<SessionMeta[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked]       = useState<Set<string>>(new Set());

  const load = () => api.getSessions().then((s) => setSessions(s as SessionMeta[])).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleCheck = (id: string) => setChecked((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const archive = async () => {
    if (!checked.size) return;
    await api.archiveSessions([...checked]).catch(() => {});
    setChecked(new Set()); setSelectMode(false); load();
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span className="nf-section-title" style={{ flex: 1, borderBottom: 'none', paddingBottom: 0 }}>Sessions</span>
        <button className={`btn${selectMode ? ' active' : ''}`} style={{ fontSize: 10, padding: '2px 7px' }}
          onClick={() => { setSelectMode((v) => !v); setChecked(new Set()); }}>
          Select
        </button>
        {selectMode && checked.size > 0 && (
          <button className="btn btn-danger" style={{ fontSize: 10, padding: '2px 7px' }} onClick={archive}>
            Archive ({checked.size})
          </button>
        )}
      </div>

      {sessions.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', padding: '6px 0' }}>No sessions yet.</div>
      )}

      {sessions.map((s) => {
        const isActive = s.id === selectedId;
        const d = new Date(s.started_at);
        return (
          <div
            key={s.id}
            onClick={() => onSelect(s)}
            style={{
              padding: '8px 6px', cursor: 'pointer', borderRadius: 3,
              borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              background: isActive ? 'rgba(85,119,238,0.1)' : 'transparent',
              display: 'flex', gap: 6, alignItems: 'flex-start',
              marginLeft: -10, marginRight: -10, paddingLeft: 8,
            }}
          >
            {selectMode && (
              <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)}
                style={{ marginTop: 3, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} />
            )}
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: s.is_favorite ? 'var(--fair)' : 'var(--muted)', fontSize: 14, padding: 0, flexShrink: 0, lineHeight: 1 }}
              onClick={(e) => { e.stopPropagation(); api.toggleFavorite(s.id, !s.is_favorite).then(load).catch(() => {}); }}
            >
              {s.is_favorite ? '★' : '☆'}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                {s.training_program ?? 'Session'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                {d.toLocaleDateString()} {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{fmt(s.duration_sec)}</span>
                <AnalysisBadge status={s.analysis_status} />
                {s.has_note && <span style={{ color: 'var(--accent)', lineHeight: 0 }}><NoteIcon /></span>}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── SessionDetail (shown in main area) ────────────────────────────────────────

interface DetailProps {
  session: SessionMeta;
  onBack: () => void;
}

export function SessionDetail({ session, onBack }: DetailProps) {
  const BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';
  const [noteMode, setNoteMode] = useState<'view' | 'edit'>('view');
  const [noteText, setNoteText] = useState('');
  const [favorite, setFavorite] = useState(session.is_favorite);

  useEffect(() => {
    setFavorite(session.is_favorite);
    setNoteMode('view');
    api.getNote(session.id)
      .then((n: unknown) => setNoteText((n as { content?: string })?.content ?? ''))
      .catch(() => setNoteText(''));
  }, [session.id]);

  const saveNote = async () => {
    await api.saveNote(session.id, noteText).catch(() => {});
    setNoteMode('view');
  };

  const toggleFav = async () => {
    const res = await api.toggleFavorite(session.id, !favorite).catch(() => null);
    if (res) setFavorite(!favorite);
  };

  const d = new Date(session.started_at);
  const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
        <button className="btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={onBack}>← Back</button>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{session.training_program ?? 'Session'}</span>
        <button className="btn" onClick={toggleFav} style={{ fontSize: 16, padding: '2px 6px', color: favorite ? 'var(--fair)' : 'var(--muted)' }}>
          {favorite ? '★' : '☆'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{dateStr} · {timeStr} · {fmt(session.duration_sec)}</span>
        <AnalysisBadge status={session.analysis_status} />
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Notes */}
        <div className="panel">
          <div className="panel-title">Session Notes</div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {noteMode === 'view' ? (
              noteText ? (
                <>
                  <pre style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', fontFamily: 'inherit', lineHeight: 1.6 }}>{noteText}</pre>
                  <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setNoteMode('edit')}>Edit</button>
                </>
              ) : (
                <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setNoteMode('edit')}>Add note</button>
              )
            ) : (
              <>
                <textarea rows={6} value={noteText} onChange={(e) => setNoteText(e.target.value)} autoFocus />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-accent" onClick={saveNote}>Save</button>
                  <button className="btn" onClick={() => setNoteMode('view')}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Report */}
        {session.has_report ? (
          <div className="panel" style={{ flex: 1, minHeight: 400, display: 'flex', flexDirection: 'column' }}>
            <div className="panel-title">Report</div>
            <iframe
              src={`${BASE}/session/${encodeURIComponent(session.id)}/report.html`}
              style={{ flex: 1, border: 'none', background: '#fff', minHeight: 400 }}
              title="Session report"
            />
          </div>
        ) : (
          <div className="panel">
            <div className="panel-title">Report</div>
            <div className="panel-body" style={{ color: 'var(--muted)', fontSize: 12 }}>
              No report available for this session.
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
