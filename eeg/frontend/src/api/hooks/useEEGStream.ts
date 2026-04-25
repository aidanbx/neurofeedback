import { useEffect } from 'react';
import { eegWS } from '../websocket';
import { useDeviceStore } from '../../state/deviceStore';
import { useProgramStore } from '../../state/programStore';
import type { StreamMessage } from '../../contracts';

export function useEEGStream() {
  const setMetricsBatch = useDeviceStore((s) => s.setMetricsBatch);
  const setProgramOut   = useProgramStore((s) => s.setOutput);

  useEffect(() => {
    eegWS.connect();
    const unsub = eegWS.subscribe((msg: StreamMessage) => {
      if (msg.type === 'metrics') {
        setMetricsBatch(msg.data);
        setProgramOut(msg.program_output);
      }
    });
    return () => { unsub(); };
  }, [setMetricsBatch, setProgramOut]);
}
