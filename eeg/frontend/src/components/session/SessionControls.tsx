import React, { useState } from 'react';
import { api } from '../../api/client';
import { useDeviceStore } from '../../state/deviceStore';
import { useProgramStore } from '../../state/programStore';

interface Props {
  programId: string;
  programTitle: string;
  startLabel?: string;
  stopLabel?: string;
  onStarted?: () => void;
  onStopped?: () => void;
}

export function SessionControls({
  programId,
  programTitle,
  startLabel = 'Start Training',
  stopLabel = 'Stop Training',
  onStarted,
  onStopped,
}: Props) {
  const appState  = useDeviceStore((s) => s.appState);
  const setActive = useProgramStore((s) => s.setActiveProgramId);
  const active    = useProgramStore((s) => s.activeProgramId);
  const recording = appState?.recording ?? false;
  const isThis    = active === programId && recording;
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [notes, setNotes] = useState('');
  const [includePsdBaseline, setIncludePsdBaseline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setBusy(true);
    setError('');
    try {
      await api.startTraining({ id: programId, title: programTitle });
      setActive(programId);
      await onStarted?.();
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.stopTraining({ save: false });
      setActive(programId);
      await onStopped?.();
      if (res.pending) {
        setShowSavePrompt(true);
      } else {
        setShowSavePrompt(false);
        window.dispatchEvent(new CustomEvent('sessions:changed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.saveStoppedTraining(notes, includePsdBaseline);
      if (!res.ok) throw new Error('No stopped session is pending save.');
      setShowSavePrompt(false);
      setNotes('');
      setIncludePsdBaseline(false);
      window.dispatchEvent(new CustomEvent('sessions:changed'));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not save session.');
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.discardStoppedTraining();
      if (!res.ok) throw new Error('No stopped session is pending discard.');
      setShowSavePrompt(false);
      setNotes('');
      setIncludePsdBaseline(false);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not discard session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={isThis ? handleStop : handleStart}
        disabled={busy}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: isThis ? '#c0392b' : '#2980b9',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: busy ? 'default' : 'pointer',
          fontWeight: 600,
          opacity: busy ? 0.7 : 1,
        }}
      >
        {isThis ? stopLabel : startLabel}
      </button>

      {showSavePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Save session"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.58)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(520px, 100%)',
              background: 'var(--sidebar)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>Save this session?</div>
            {error && (
              <div style={{ color: 'var(--poor)', fontSize: 12, lineHeight: 1.4 }}>
                {error}
              </div>
            )}
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Session notes"
              rows={7}
              style={{
                width: '100%',
                resize: 'vertical',
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 10,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text)', lineHeight: 1.45 }}>
              <input
                type="checkbox"
                checked={includePsdBaseline}
                onChange={(event) => setIncludePsdBaseline(event.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                Include this session in the forever PSD baseline
                <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>
                  Use this only for clean sessions you want future z-score spectrograms to treat as reference history.
                </span>
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={busy}
                style={{
                  padding: '7px 10px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--muted)',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                style={{
                  padding: '7px 12px',
                  borderRadius: 4,
                  border: 'none',
                  background: '#2980b9',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Save Session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
