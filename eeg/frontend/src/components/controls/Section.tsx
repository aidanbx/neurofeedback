import type { ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
}

export function Section({ title, children }: Props) {
  return (
    <div className="nf-section">
      <div className="nf-section-title">{title}</div>
      {children}
    </div>
  );
}
