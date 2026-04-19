import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';

interface Track { name: string; url: string }

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
}

export function TrackPicker({ label, value, onChange }: Props) {
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    api.getAudioTracks().then(setTracks).catch(() => {});
  }, []);

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.85em' }}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
        <option value="silence">- Silence -</option>
        {tracks.map((t) => (
          <option key={t.url} value={t.url}>{t.name}</option>
        ))}
      </select>
    </label>
  );
}
