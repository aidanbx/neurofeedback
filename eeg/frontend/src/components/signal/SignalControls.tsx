import { api } from '../../api/client';
import type { AppState } from '../../contracts';
import { useDeviceStore } from '../../state/deviceStore';

interface Props {
  appState: AppState | null;
}

export function SignalControls({ appState }: Props) {
  const setAppState = useDeviceStore((s) => s.setAppState);

  const refresh = async () => {
    const next = await api.getState();
    setAppState(next as AppState);
  };

  const toggleNotch = async () => {
    await api.notchToggle();
    await refresh();
  };

  const toggleArtifactRejection = async () => {
    await api.artifactToggle();
    await refresh();
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <button
        className={`btn btn-full${appState?.notch_60hz ? ' active' : ''}`}
        onClick={toggleNotch}
        title="Apply the 60 Hz notch to the processed signal. The raw PSD reference remains visible for signal-quality inspection."
      >
        60 Hz notch {appState?.notch_60hz ? 'on' : 'off'}
      </button>
      <button
        className={`btn btn-full${appState?.artifact_rejection ? ' active' : ''}`}
        onClick={toggleArtifactRejection}
      >
        Artifact rejection {appState?.artifact_rejection ? 'on' : 'off'}
      </button>
    </div>
  );
}
