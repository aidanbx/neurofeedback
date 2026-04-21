import type React from 'react';
import { api } from '../../api/client';
import { Slider } from './Slider';
import { TrackPicker } from './TrackPicker';

interface SliderBaseProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
}

interface ProgramParamSliderProps extends SliderBaseProps {
  programId: string;
  paramKey: string;
  onResolved: (params: Record<string, unknown>) => void;
}

export function ProgramParamSlider({
  programId,
  paramKey,
  onResolved,
  ...props
}: ProgramParamSliderProps) {
  const handleChange = (value: number) => {
    onResolved({ [paramKey]: value });
    api.setProgramParams(programId, { [paramKey]: value })
      .then((res) => onResolved(res.params))
      .catch(() => {});
  };
  return <Slider {...props} onChange={handleChange} />;
}

interface ProgramParamButtonProps {
  programId: string;
  paramKey: string;
  value: unknown;
  children: React.ReactNode;
  onResolved: (params: Record<string, unknown>) => void;
  className?: string;
  title?: string;
}

export function ProgramParamButton({
  programId,
  paramKey,
  value,
  children,
  onResolved,
  className = 'btn',
  title,
}: ProgramParamButtonProps) {
  const handleClick = () => {
    onResolved({ [paramKey]: value });
    api.setProgramParams(programId, { [paramKey]: value })
      .then((res) => onResolved(res.params))
      .catch(() => {});
  };
  return (
    <button className={className} title={title} onClick={handleClick}>
      {children}
    </button>
  );
}

interface LoggedSliderProps extends SliderBaseProps {
  eventKey: string;
  programId?: string;
  onChange: (v: number) => void;
  data?: Record<string, unknown>;
}

export function LoggedSlider({ eventKey, programId, onChange, data, ...props }: LoggedSliderProps) {
  const handleChange = (value: number) => {
    onChange(value);
    api.logEvent({
      type: 'AudioSettingChanged',
      source: 'ui',
      program_id: programId,
      data: { key: eventKey, value, ...(data ?? {}) },
    }).catch(() => {});
  };
  return <Slider {...props} onChange={handleChange} />;
}

interface LoggedTrackPickerProps {
  label: string;
  value: string;
  eventKey: string;
  programId?: string;
  onChange: (url: string) => void;
  data?: Record<string, unknown>;
}

export function LoggedTrackPicker({
  label,
  value,
  eventKey,
  programId,
  onChange,
  data,
}: LoggedTrackPickerProps) {
  const handleChange = (url: string) => {
    onChange(url);
    api.logEvent({
      type: 'AudioSettingChanged',
      source: 'ui',
      program_id: programId,
      data: { key: eventKey, value: url, ...(data ?? {}) },
    }).catch(() => {});
  };
  return <TrackPicker label={label} value={value} onChange={handleChange} />;
}
