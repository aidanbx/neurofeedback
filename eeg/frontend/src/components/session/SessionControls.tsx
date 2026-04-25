import React from 'react';
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

  const handleStart = async () => {
    await api.startTraining({ id: programId, title: programTitle });
    setActive(programId);
    await onStarted?.();
  };

  const handleStop = async () => {
    await api.stopTraining();
    setActive(programId);
    await onStopped?.();
  };

  return (
    <button
      onClick={isThis ? handleStop : handleStart}
      style={{
        width: '100%',
        padding: '8px 12px',
        background: isThis ? '#c0392b' : '#2980b9',
        color: '#fff',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontWeight: 600,
      }}
    >
      {isThis ? stopLabel : startLabel}
    </button>
  );
}
