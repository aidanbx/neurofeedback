import type { ReactNode } from 'react';
import { ComponentSettings } from '../controls/ComponentSettings';
import { Slider } from '../controls/Slider';
import { FeedbackTimelineChart } from './FeedbackTimelineChart';
import { RollingBandDiagnostics } from './RollingBandDiagnostics';
import type { BandMetricMode } from './BandBars';

interface Point {
  x: number;
}

interface BandDef<T extends Point> {
  key: string;
  label: string;
  color: string;
  value: (point: T) => number;
  threshold?: (point: T) => number;
  onThresholdChange?: (value: number) => void;
}

interface StateDef<T extends Point> {
  key: string;
  label: string;
  color: string;
  active: (point: T) => boolean;
}

interface Props<T extends Point> {
  points: T[];
  bandDefs: BandDef<T>[];
  clarityDefs: BandDef<T>[];
  barThresholdDefs?: Array<{ band: string; color?: string; value: (point: T) => number }>;
  barInitialMode?: BandMetricMode;
  chartWindowSec: number;
  onChartWindowSecChange: (value: number) => void;
  showThresholds: boolean;
  onShowThresholdsChange: (value: boolean) => void;
  middleContent?: ReactNode;
  emptyLabel?: string;
  barBands?: string[];
  states?: StateDef<T>[];
}

export function NeurofeedbackCharts<T extends Point>({
  points,
  bandDefs,
  clarityDefs,
  barThresholdDefs = [],
  barInitialMode = 'log_absolute',
  chartWindowSec,
  onChartWindowSecChange,
  showThresholds,
  onShowThresholdsChange,
  middleContent,
  emptyLabel = 'Waiting for feedback history…',
  barBands = ['Alpha', 'Theta', 'Beta'],
  states = [],
}: Props<T>) {
  const bandSettings = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>Band Chart Settings</div>
      <Slider
        label="Window"
        min={1}
        max={300}
        step={1}
        value={chartWindowSec}
        onChange={onChartWindowSecChange}
        format={(value) => value < 60 ? `${value}s` : `${(value / 60).toFixed(1)}m`}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85em', cursor: 'pointer' }}>
        <input type="checkbox" checked={showThresholds} onChange={(event) => onShowThresholdsChange(event.target.checked)} />
        <span style={{ color: 'var(--muted)' }}>Show thresholds</span>
      </label>
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        Beta uses combined Beta + Hi-Beta log power, so its threshold is not directly comparable to theta by raw magnitude alone.
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ComponentSettings settings={bandSettings}>
        <FeedbackTimelineChart
          points={points}
          bands={bandDefs.map((band) => ({
            ...band,
            threshold: showThresholds ? band.threshold : undefined,
            valueOpacity: '77',
            thresholdOpacity: 'ee',
            lineWidth: 1.8,
            thresholdLineWidth: 1.6,
          }))}
          thresholdHandles={showThresholds ? bandDefs
            .filter((band) => band.threshold && band.onThresholdChange)
            .map((band) => ({
              key: band.key,
              label: `${band.label} threshold`,
              color: band.color,
              value: (point: T) => band.threshold?.(point) ?? 0,
              onChange: (value: number) => band.onThresholdChange?.(value),
            })) : []}
          height={220}
          windowSec={chartWindowSec}
          emptyLabel={emptyLabel}
          states={states}
        />
      </ComponentSettings>

      {middleContent}

      <FeedbackTimelineChart
        points={points}
        bands={clarityDefs.map((band) => ({
          ...band,
          lineWidth: 1.8,
          valueOpacity: 'ff',
        }))}
        height={190}
        windowSec={chartWindowSec}
        emptyLabel={emptyLabel}
        states={states}
      />

      <RollingBandDiagnostics
        bands={barBands}
        initialMode={barInitialMode}
        thresholdSeries={barThresholdDefs.map((def) => ({
          band: def.band,
          color: def.color,
          points: points.map((point) => ({ x: point.x, value: def.value(point) })),
        }))}
        height={220}
        title=""
        showTitle={false}
        showLiveChart={false}
        combineHiBetaForBeta
        pauseWhenNotRecording
      />
    </div>
  );
}
