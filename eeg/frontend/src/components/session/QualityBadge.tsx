import React from 'react';

interface Props {
  label: 'good' | 'fair' | 'poor' | string;
  score: number;
}

const COLOR: Record<string, string> = {
  good: '#44cc88',
  fair: '#f0cc44',
  poor: '#e05050',
};

export function QualityBadge({ label, score }: Props) {
  const color = COLOR[label] ?? '#888';
  return (
    <span style={{ color, fontWeight: 600, fontSize: '0.85em' }}>
      {label.toUpperCase()} ({score.toFixed(0)})
    </span>
  );
}
