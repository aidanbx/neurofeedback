export interface BandFeature {
  absolute: number;
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
  psd_freqs: number[];
  psd_values: number[];
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
  data: MetricsSnapshot;
  program_output: ProgramOutput | null;
}

export interface AppState {
  connection_state: 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'replay';
  status_message: string;
  test_mode: boolean;
  recording: boolean;
  artifact_rejection: boolean;
  duration_sec: number;
  metrics: MetricsSnapshot | null;
  active_program: string | null;
}
