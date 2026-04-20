import { useRef, useState } from 'react';
import { api } from '../../api/client';

interface Note { text: string; elapsed: number }

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function NoteInput({ elapsed }: { elapsed: number }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const submit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setNotes((prev) => [...prev, { text, elapsed }]);
    await api.appendNote(text, elapsed).catch(() => {});
    setTimeout(() => { scrollRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }); }, 50);
  };

  return (
    <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
      <div className="nf-section-title" style={{ borderBottom: 'none', paddingBottom: 3 }}>Session Notes</div>
      {notes.length > 0 && (
        <div ref={scrollRef} style={{ maxHeight: 64, overflowY: 'auto', marginBottom: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {notes.map((n, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--muted)' }}>
              [{fmt(n.elapsed)}] {n.text}
            </div>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder="Add note (Enter)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
    </div>
  );
}
