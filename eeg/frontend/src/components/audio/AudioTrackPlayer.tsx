import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { resolveAudioUrl } from '../../audio/resolveAudioUrl';

interface Track {
  name: string;
  filename: string;
  url: string;
}

interface Props {
  programId?: string;
  eventPrefix?: string;
  label?: string;
  selectedUrl?: string;
  onSelectedUrlChange?: (url: string) => void;
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildPeaks(buffer: AudioBuffer, count: number): number[] {
  const channel = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(channel.length / count));
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const start = i * block;
    const end = Math.min(channel.length, start + block);
    for (let j = start; j < end; j++) {
      peak = Math.max(peak, Math.abs(channel[j]));
    }
    peaks.push(peak);
  }
  return peaks;
}

export function AudioTrackPlayer({
  programId,
  eventPrefix = 'audio_player',
  label = 'Track',
  selectedUrl,
  onSelectedUrlChange,
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [internalSelectedUrl, setInternalSelectedUrl] = useState('silence');
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [status, setStatus] = useState('Select a track');
  const [previewOpen, setPreviewOpen] = useState(false);

  const currentSelectedUrl = selectedUrl ?? internalSelectedUrl;
  const resolvedUrl = resolveAudioUrl(currentSelectedUrl);

  const log = (key: string, value: unknown, extra: Record<string, unknown> = {}) => {
    api.logEvent({
      type: 'AudioSettingChanged',
      source: 'ui',
      program_id: programId,
      data: { key: `${eventPrefix}.${key}`, value, ...extra },
    }).catch(() => {});
  };

  useEffect(() => {
    api.getAudioTracks()
      .then(setTracks)
      .catch(() => setStatus('Could not load tracks'));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPeaks([]);
    if (!resolvedUrl) {
      audio.removeAttribute('src');
      setStatus('Select a track');
      return;
    }

    audio.src = resolvedUrl;
    audio.load();
    setStatus('Loading waveform...');

    let cancelled = false;
    fetch(resolvedUrl)
      .then((res) => res.arrayBuffer())
      .then(async (data) => {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const decoded = await audioCtxRef.current.decodeAudioData(data.slice(0));
        if (cancelled) return;
        setDuration(decoded.duration);
        setPeaks(buildPeaks(decoded, 900));
        setStatus('Ready');
      })
      .catch(() => setStatus('Waveform unavailable; audio may still play'));

    return () => {
      cancelled = true;
    };
  }, [resolvedUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = 520;
    const height = 96;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, height);

    const mid = height / 2;
    const progress = duration > 0 ? currentTime / duration : 0;
    const progressX = progress * width;

    if (!peaks.length) {
      ctx.strokeStyle = '#303045';
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
      return;
    }

    const barW = width / peaks.length;
    peaks.forEach((peak, i) => {
      const x = i * barW;
      const h = Math.max(1, peak * (height - 12));
      ctx.fillStyle = x <= progressX ? '#88aaff' : '#34344a';
      ctx.fillRect(x, mid - h / 2, Math.max(1, barW - 0.5), h);
    });

    ctx.strokeStyle = '#f0cc44';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, height);
    ctx.stroke();
  }, [peaks, currentTime, duration]);

  const handleSelect = (url: string) => {
    if (selectedUrl == null) setInternalSelectedUrl(url);
    onSelectedUrlChange?.(url);
    const track = tracks.find((t) => t.url === url);
    log('track', url, { track_name: track?.name ?? null });
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !resolvedUrl) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      log('pause', audio.currentTime);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
      log('play', audio.currentTime);
    } catch {
      setStatus('Playback blocked or failed');
    }
  };

  const seekTo = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const next = Math.max(0, Math.min(duration, ratio * duration));
    audio.currentTime = next;
    setCurrentTime(next);
    log('seek', next);
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / rect.width);
  };

  const handleVolume = (nextPct: number) => {
    const next = nextPct / 100;
    setVolume(next);
    log('volume_pct', nextPct);
  };

  const togglePreview = () => {
    setPreviewOpen((open) => !open);
    log('preview_toggle', !previewOpen);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.85em' }}>
        <span>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={currentSelectedUrl} onChange={(e) => handleSelect(e.target.value)} style={{ width: '100%' }}>
            <option value="silence">- Select track -</option>
            {tracks.map((track) => (
              <option key={track.url} value={track.url}>{track.name}</option>
            ))}
          </select>
          <button className="btn" type="button" onClick={togglePreview} disabled={!resolvedUrl}>
            {previewOpen ? 'Hide' : 'Preview'}
          </button>
        </div>
      </div>

      {previewOpen && (
        <>
          <canvas
            ref={canvasRef}
            onClick={handleWaveformClick}
            style={{ display: 'block', width: '100%', cursor: resolvedUrl ? 'pointer' : 'default', border: '1px solid var(--border)' }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-accent" onClick={togglePlay} disabled={!resolvedUrl}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 76 }}>
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seekTo(Number(e.target.value) / Math.max(duration, 1))}
              style={{ flex: 1 }}
              disabled={!duration}
            />
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)' }}>Volume</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{Math.round(volume * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              onChange={(e) => handleVolume(Number(e.target.value))}
            />
          </label>

          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{status}</div>
        </>
      )}
    </div>
  );
}
