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
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    setBusy(true);
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
    try {
      await api.stopTraining({ save: false });
      setActive(programId);
      await onStopped?.();
      setShowSavePrompt(true);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await api.saveStoppedTraining(notes);
      setShowSavePrompt(false);
      setNotes('');
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    setBusy(true);
    try {
      await api.discardStoppedTraining();
      setShowSavePrompt(false);
      setNotes('');
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
