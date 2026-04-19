import React from 'react';

interface Props { elapsed: number }

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ElapsedTimer({ elapsed }: Props) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(elapsed)}</span>;
}
