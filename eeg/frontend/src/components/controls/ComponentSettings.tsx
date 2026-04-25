import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';

const POPUP_W = 224;

const GearIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

interface Props {
  settings: ReactNode;
  children: ReactNode;
}

export function ComponentSettings({ settings, children }: Props) {
  const [open, setOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const popRef  = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const computePos = useCallback(() => {
    const btn = gearRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const spaceRight = window.innerWidth - r.right;
    if (spaceRight >= POPUP_W + 8) {
      setPos({ top: r.top, left: r.right + 4 });
    } else {
      setPos({ top: r.top - 8, left: r.right - POPUP_W });
    }
  }, []);

  const toggle = () => {
    if (!open) computePos();
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !gearRef.current?.contains(e.target as Node) &&
        !popRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      {children}
      <button
        ref={gearRef}
        onClick={toggle}
        title="Settings"
        style={{
          position: 'absolute', top: 5, right: 5,
          background: open ? '#ffffff22' : '#00000044',
          border: 'none', borderRadius: 4,
          color: open ? 'var(--accent)' : '#777799',
          cursor: 'pointer', padding: '3px 4px',
          lineHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s, background 0.15s',
          zIndex: 10,
        }}
      >
        <GearIcon />
      </button>
      {open && (
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: pos.top, left: pos.left,
            width: POPUP_W,
            background: 'var(--sidebar)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
            padding: '10px 12px',
            zIndex: 1000,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          {settings}
        </div>
      )}
    </div>
  );
}
