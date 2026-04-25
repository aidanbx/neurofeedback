import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export function Section({ title, children, collapsible = false, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="nf-section">
      {collapsible ? (
        <button
          type="button"
          className="nf-section-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="nf-section-title" style={{ borderBottom: 'none', paddingBottom: 0 }}>{title}</span>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <div className="nf-section-title">{title}</div>
      )}
      {(!collapsible || open) && children}
    </div>
  );
}
