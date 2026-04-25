export interface BandFeature {
  absolute: number;
  relative_1_30: number;
  relative_4_30: number;
  log_absolute: number;
  baseline_delta: number;
  baseline_zscore: number;
  smoothed: number;
  baseline_ready: boolean;
  baseline_n: number;
  baseline_n_needed: number;
}

export interface MetricsSnapshot {
  elapsed_sec: number;
  quality_score: number;
  quality_label: 'good' | 'fair' | 'poor';
  artifact_fraction: number;
  common_mode_corr: number;
  slow_wave_ratio: number;
  line_noise_ratio: number;
  psd_freqs: number[];
  psd_values: number[];
  raw_psd_freqs: number[];
  raw_psd_values: number[];
  live_trace_t: number[];
  live_trace_y: number[];
  bands: Record<string, BandFeature>;
  params: Record<string, unknown>;
}

export interface ProgramOutput {
  program_id: string;
  elapsed: number;
  status_text: string;
  payload: Record<string, unknown>;
}

export interface SettingSpec {
  type: 'number' | 'boolean' | 'string' | 'enum';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  description?: string;
  options?: unknown[];
}

export interface ProgramManifest {
  id: string;
  title: string;
  description: string;
  version: string;
  runtime: string;
  frontend_view: string;
  settings_schema: Record<string, SettingSpec>;
  required_bands: string[];
  audio_scenes: string[];
}

export interface ProgramParamsResponse {
  ok: boolean;
  program_id: string;
  params: Record<string, unknown>;
  settings_schema: Record<string, SettingSpec>;
}

export interface SessionEventInput {
  type: string;
  source?: string;
  program_id?: string;
  data?: Record<string, unknown>;
}

export interface SessionMeta {
  id: string;
  started_at: string;
  duration_sec: number;
  device: string;
  has_report: boolean;
  analysis_status: string;
  training_program: string | null;
  is_favorite: boolean;
  has_note: boolean;
}

export interface StreamMessage {
  type: 'metrics';
  data: MetricsSnapshot[];
  program_output: ProgramOutput | null;
}

export interface AppState {
  connection_state: 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'replay';
  status_message: string;
  test_mode: boolean;
  recording: boolean;
  artifact_rejection: boolean;
  notch_60hz: boolean;
  duration_sec: number;
  metrics: MetricsSnapshot | null;
  active_program: string | null;
}
