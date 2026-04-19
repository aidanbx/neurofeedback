import React from 'react';

interface Props {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: Props) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: '0.7em', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#666', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
