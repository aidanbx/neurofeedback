import { useRef, useCallback } from 'react';
import { AudioScene } from './AudioScene';

let sharedCtx: AudioContext | null = null;
let sharedMaster: GainNode | null  = null;

function getAudioContext(): { ctx: AudioContext; master: GainNode } {
  if (!sharedCtx) {
    sharedCtx  = new AudioContext();
    sharedMaster = sharedCtx.createGain();
    sharedMaster.gain.value = 1.0;
    sharedMaster.connect(sharedCtx.destination);
  }
  return { ctx: sharedCtx, master: sharedMaster! };
}

export function useAudioScene() {
  const sceneRef = useRef<AudioScene | null>(null);

  const getScene = useCallback(() => {
    if (!sceneRef.current) {
      const { ctx, master } = getAudioContext();
      sceneRef.current = new AudioScene(ctx, master);
    }
    return sceneRef.current;
  }, []);

  const load = useCallback(async (baseUrl: string | null, clearUrl: string | null) => {
    await getScene().load(baseUrl, clearUrl);
  }, [getScene]);

  const play  = useCallback(() => getScene().play(),  [getScene]);
  const stop  = useCallback(() => getScene().stop(),  [getScene]);

  const setCrossfade = useCallback((drive: number, rampSec?: number) => {
    getScene().setCrossfade(drive, rampSec);
  }, [getScene]);

  const setVolume = useCallback((v: number) => {
    getScene().setVolume(v);
  }, [getScene]);

  const setTrackVolumes = useCallback((baseVol: number, clearVol: number) => {
    getScene().setTrackVolumes(baseVol, clearVol);
  }, [getScene]);

  const destroy = useCallback(() => {
    sceneRef.current?.destroy();
    sceneRef.current = null;
  }, []);

  return { load, play, stop, setCrossfade, setVolume, setTrackVolumes, destroy };
}
