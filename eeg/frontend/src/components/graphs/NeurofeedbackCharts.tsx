import { ComponentSettings } from '../controls/ComponentSettings';
import { Slider } from '../controls/Slider';
import { FeedbackTimelineChart } from './FeedbackTimelineChart';
import { RollingBandDiagnostics } from './RollingBandDiagnostics';

interface Point {
  x: number;
}

interface BandDef<T extends Point> {
  key: string;
  label: string;
  color: string;
  value: (point: T) => number;
  threshold?: (point: T) => number;
}

interface Props<T extends Point> {
  points: T[];
  bandDefs: BandDef<T>[];
  clarityDefs: BandDef<T>[];
  chartWindowSec: number;
  onChartWindowSecChange: (value: number) => void;
  showThresholds: boolean;
  onShowThresholdsChange: (value: boolean) => void;
  emptyLabel?: string;
  barBands?: string[];
}

export function NeurofeedbackCharts<T extends Point>({
  points,
  bandDefs,
  clarityDefs,
  chartWindowSec,
  onChartWindowSecChange,
  showThresholds,
  onShowThresholdsChange,
  emptyLabel = 'Waiting for rolling baseline before charting.',
  barBands = ['Alpha', 'Theta', 'Beta'],
}: Props<T>) {
  const bandSettings = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>Band Chart Settings</div>
      <Slider
        label="Window"
        min={30}
        max={240}
        step={10}
        value={chartWindowSec}
        onChange={onChartWindowSecChange}
        format={(value) => value < 60 ? `${value}s` : `${(value / 60).toFixed(1)}m`}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85em', cursor: 'pointer' }}>
        <input type="checkbox" checked={showThresholds} onChange={(event) => onShowThresholdsChange(event.target.checked)} />
        <span style={{ color: 'var(--muted)' }}>Show thresholds</span>
      </label>
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
          height={220}
          windowSec={chartWindowSec}
          emptyLabel={emptyLabel}
        />
      </ComponentSettings>

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
      />

      <RollingBandDiagnostics
        bands={barBands}
        initialMode="log_absolute"
        height={220}
        title=""
        showTitle={false}
        showLiveChart={false}
      />
    </div>
  );
}
