"""Signal processing: filters, PSD, band power, artifact detection, quality scoring."""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, filtfilt, iirnotch, lfilter, sosfiltfilt, spectrogram, welch

# ── Timing & window constants ─────────────────────────────────────────────────
SRATE                  = 250    # Hz
LIVE_BUF_SEC           = 20
LIVE_TRACE_SEC         = 8
ANALYSIS_SEC           = 2      # artifact detection + display PSD
TRAINING_ANALYSIS_SEC  = 1.0   # responsive training band power (1-Hz resolution)
DIAGNOSTIC_SEC         = 8
METRIC_INTERVAL        = 0.5   # seconds between logged metric rows
SPEC_MAX_HZ            = 30.0

# ── Filter parameters ─────────────────────────────────────────────────────────
DISPLAY_HIGHPASS_HZ  = 0.5
ANALYSIS_HIGHPASS_HZ = 0.3
NOTCH_HZ   = 60.0
NOTCH_Q    = 30.0
LOWPASS_HZ = 45.0

DISPLAY_HP  = butter(2, DISPLAY_HIGHPASS_HZ,  btype="high", fs=SRATE, output="sos")
ANALYSIS_HP = butter(2, ANALYSIS_HIGHPASS_HZ, btype="high", fs=SRATE, output="sos")
LOWPASS     = butter(4, LOWPASS_HZ,           btype="low",  fs=SRATE, output="sos")
NOTCH_B, NOTCH_A = iirnotch(NOTCH_HZ, Q=NOTCH_Q, fs=SRATE)

# ── Frequency bands ───────────────────────────────────────────────────────────
BANDS: dict[str, tuple[float, float]] = {
    "Delta":  (1,  4),
    "Theta":  (4,  8),
    "Alpha":  (8,  12),
    "SMR":    (12, 15),
    "Beta":   (15, 20),
    "Hi-Beta":(20, 30),
}


# ── Pure signal functions ─────────────────────────────────────────────────────

def clean_signal(data: np.ndarray, mode: str = "analysis") -> np.ndarray:
    if len(data) < 12:
        return np.asarray(data, dtype=float)
    sos = ANALYSIS_HP if mode == "analysis" else DISPLAY_HP
    filtered = sosfiltfilt(sos, np.asarray(data, dtype=float))
    filtered = sosfiltfilt(LOWPASS, filtered)
    return np.asarray(lfilter(NOTCH_B, NOTCH_A, filtered))


def apply_view_processing(
    data: np.ndarray,
    *,
    notch_60hz: bool,
    recenter: bool,
) -> np.ndarray:
    processed = np.asarray(data, dtype=float).copy()
    if len(processed) == 0:
        return processed
    if len(processed) > 12:
        processed = sosfiltfilt(LOWPASS, processed)
    if notch_60hz and len(processed) > 12:
        processed = np.asarray(filtfilt(NOTCH_B, NOTCH_A, processed))
    if recenter:
        processed = processed - np.mean(processed)
    return processed


def band_integral(freqs: np.ndarray, psd: np.ndarray, lo: float, hi: float) -> float:
    mask = (freqs >= lo) & (freqs <= hi)
    if not np.any(mask):
        return 0.0
    return float(np.trapezoid(psd[mask], freqs[mask]))


def compute_psd(trace: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if len(trace) < 16:
        return np.array([]), np.array([])
    freqs, psd = welch(
        trace - np.mean(trace),
        fs=SRATE,
        nperseg=min(len(trace), 1024),
        noverlap=min(len(trace) // 2, 512),
    )
    return freqs, psd


def compute_relative_band_power(freqs: np.ndarray, psd: np.ndarray) -> dict[str, float]:
    total = band_integral(freqs, psd, 1, 30)
    return {
        name: (band_integral(freqs, psd, lo, hi) / total * 100.0 if total > 1e-9 else 0.0)
        for name, (lo, hi) in BANDS.items()
    }


def decimate_xy(x: np.ndarray, y: np.ndarray, max_points: int) -> tuple[list[float], list[float]]:
    if len(x) <= max_points:
        return x.tolist(), y.tolist()
    step = max(1, len(x) // max_points)
    return x[::step].tolist(), y[::step].tolist()


def slice_bounds(
    cursor_sec: float, window_sec: float, available_samples: int
) -> tuple[int, int, float, float]:
    window_samples = max(1, int(window_sec * SRATE))
    end_idx = min(available_samples, max(window_samples, int(round(cursor_sec * SRATE))))
    start_idx = max(0, end_idx - window_samples)
    return start_idx, end_idx, start_idx / SRATE, end_idx / SRATE


def compute_frame_metrics(
    live: np.ndarray,
    channels: list[np.ndarray],
    channel_idx: int,
    artifact_rejection: bool,
    adc_max_uv: float,
) -> dict:
    """Compute all metrics for a single analysis frame.

    Returns a dict with keys:
      metrics, relative_4_30, psd_freqs, psd_values, live_trace_t, live_trace_y
    Returns None if there is not enough data yet.
    """
    training_count = int(TRAINING_ANALYSIS_SEC * SRATE)  # 250 samples at 250 Hz
    analysis_count = int(ANALYSIS_SEC * SRATE)
    diag_count     = int(DIAGNOSTIC_SEC * SRATE)
    if len(live) < training_count:
        return None

    live_seg       = live[-int(LIVE_TRACE_SEC * SRATE):]
    training_seg   = live[-training_count:]
    analysis_seg   = live[-analysis_count:] if len(live) >= analysis_count else live
    diag_seg       = live[-diag_count:]     if len(live) >= diag_count     else live

    live_filtered  = clean_signal(live_seg  - np.median(live_seg),  mode="display")
    analysis_clean = clean_signal(analysis_seg - np.median(analysis_seg), mode="analysis")
    diag_clean     = clean_signal(diag_seg  - np.median(diag_seg),  mode="analysis")

    # ── Artifact detection ────────────────────────────────────────────────────
    mad = float(np.median(np.abs(analysis_clean)))
    artifact_threshold = max(80.0, mad * 8.0)
    artifact_raw  = np.abs(analysis_clean) > artifact_threshold
    expand        = int(0.15 * SRATE)
    kernel        = np.ones(2 * expand + 1)
    artifact_mask = np.convolve(artifact_raw.astype(float), kernel, mode="same") > 0
    artifact_fraction = float(np.mean(artifact_mask))

    psd_input = analysis_clean
    if artifact_rejection and artifact_fraction < 0.8:
        clean_idx = np.where(~artifact_mask)[0]
        if len(clean_idx) >= 2:
            bad_idx     = np.where(artifact_mask)[0]
            interpolated = analysis_clean.copy()
            interpolated[bad_idx] = np.interp(bad_idx, clean_idx, analysis_clean[clean_idx])
            psd_input = interpolated

    # ── PSD & band power ─────────────────────────────────────────────────────
    freqs, psd = welch(psd_input, fs=SRATE,
                       nperseg=min(len(psd_input), 512),
                       noverlap=min(len(psd_input) // 2, 256))
    diag_freqs, diag_psd = welch(diag_clean, fs=SRATE,
                                  nperseg=min(len(diag_clean), 1024),
                                  noverlap=min(len(diag_clean) // 2, 512))

    absolute = {name: band_integral(freqs, psd, lo, hi) for name, (lo, hi) in BANDS.items()}
    total_1_30 = band_integral(freqs, psd, 1, 30)
    relative   = {
        name: (v / total_1_30 * 100.0 if total_1_30 > 1e-9 else 0.0)
        for name, v in absolute.items()
    }
    total_4_30 = band_integral(freqs, psd, 4, 30)
    relative_4_30 = {
        name: (absolute[name] / total_4_30 * 100.0 if total_4_30 > 1e-9 else 0.0)
        for name in BANDS if name != "Delta"
    }

    # ── 1-second training PSD (explicit params for ~1 Hz resolution) ──────────
    training_clean = clean_signal(training_seg - np.median(training_seg), mode="analysis")
    # Apply same artifact interpolation if available
    if artifact_rejection and artifact_fraction < 0.8:
        t_mad = float(np.median(np.abs(training_clean)))
        t_thr = max(80.0, t_mad * 8.0)
        t_raw = np.abs(training_clean) > t_thr
        t_expand = int(0.15 * SRATE)
        t_kernel = np.ones(2 * t_expand + 1)
        t_mask = np.convolve(t_raw.astype(float), t_kernel, mode="same") > 0
        t_clean_idx = np.where(~t_mask)[0]
        if len(t_clean_idx) >= 2:
            t_bad = np.where(t_mask)[0]
            training_clean = training_clean.copy()
            training_clean[t_bad] = np.interp(t_bad, t_clean_idx, training_clean[t_clean_idx])
    train_freqs, train_psd = welch(
        training_clean,
        fs=SRATE,
        nperseg=min(len(training_clean), 250),   # 1 s at 250 Hz → 1 Hz resolution
        noverlap=min(len(training_clean) // 2, 125),
    )
    absolute_training = {name: band_integral(train_freqs, train_psd, lo, hi) for name, (lo, hi) in BANDS.items()}
    total_4_30_t = band_integral(train_freqs, train_psd, 4, 30)
    relative_4_30_training = {
        name: (absolute_training[name] / total_4_30_t * 100.0 if total_4_30_t > 1e-9 else 0.0)
        for name in BANDS if name != "Delta"
    }

    # ── Quality scoring ───────────────────────────────────────────────────────
    low_freq_power = band_integral(diag_freqs, diag_psd, 0.25, 2.0)
    eeg_band_power = band_integral(diag_freqs, diag_psd, 2.0, 40.0)
    line_power     = band_integral(diag_freqs, diag_psd, 58.0, 62.0)
    rms  = float(np.sqrt(np.mean(np.square(analysis_seg - np.median(analysis_seg)))))
    p2p  = float(np.percentile(analysis_seg, 99) - np.percentile(analysis_seg, 1))
    deriv = np.diff(analysis_seg)
    step_fraction     = float(np.mean(np.abs(deriv) > max(25.0, 5.0 * np.std(deriv)))) if len(deriv) else 0.0
    clipping_fraction = float(np.mean(np.abs(analysis_seg) > 0.95 * adc_max_uv))

    active_centered = analysis_seg - np.median(analysis_seg)
    correlations = []
    for idx, ch in enumerate(channels):
        if idx == channel_idx or len(ch) < analysis_count:
            continue
        other = ch[-analysis_count:] - np.median(ch[-analysis_count:])
        denom = np.std(active_centered) * np.std(other)
        if denom > 1e-6:
            correlations.append(float(np.corrcoef(active_centered, other)[0, 1]))
    common_corr = float(np.mean(np.abs(correlations))) if correlations else 0.0

    low_ratio  = low_freq_power / max(eeg_band_power, 1e-9)
    line_ratio = line_power     / max(eeg_band_power, 1e-9)
    score = 100.0
    score -= min(low_ratio * 70.0, 40.0)
    score -= min(line_ratio * 30.0, 18.0)
    score -= min(common_corr * 35.0, 25.0)
    score -= min(step_fraction * 300.0, 20.0)
    score -= min(clipping_fraction * 200.0, 15.0)
    if rms < 4.0:
        score -= 18.0
    if rms > 250.0:
        score -= min((rms - 250.0) / 12.0, 20.0)
    score = float(np.clip(score, 0.0, 100.0))
    label = "good" if score >= 80 else ("fair" if score >= 55 else "poor")

    psd_mask = freqs <= 40
    metrics = {
        "absolute":           absolute,
        "relative":           relative,
        "relative_training":  relative_4_30,
        "quality_score":      score,
        "quality_label":      label,
        "low_freq_ratio":     float(low_ratio),
        "line_ratio":         float(line_ratio),
        "common_corr":        float(common_corr),
        "step_fraction":      float(step_fraction),
        "clipping_fraction":  float(clipping_fraction),
        "rms_uv":             rms,
        "peak_to_peak_uv":    p2p,
        "artifact_fraction":  artifact_fraction,
        "artifact_rejection": artifact_rejection,
    }

    return {
        "metrics":                  metrics,
        "relative_4_30":            relative_4_30,
        "absolute_training":        absolute_training,
        "relative_4_30_training":   relative_4_30_training,
        "score":                    score,
        "label":         label,
        "artifact_fraction": artifact_fraction,
        "psd_freqs":     freqs[psd_mask].tolist(),
        "psd_values":    psd[psd_mask].tolist(),
        "live_trace_t":  (np.arange(len(live_filtered)) / SRATE).tolist(),
        "live_trace_y":  live_filtered.tolist(),
    }


def compute_view_spectrogram(
    selected_seg: np.ndarray,
    start_sec: float,
) -> dict:
    """Compute spectrogram for the waveform view panel."""
    if len(selected_seg) < max(64, int(0.5 * SRATE)):
        return {"freqs": [], "times": [], "power": []}
    spec_freqs, spec_times, spec_power = spectrogram(
        selected_seg - np.mean(selected_seg),
        fs=SRATE,
        nperseg=min(len(selected_seg), 256),
        noverlap=min(max(0, len(selected_seg) // 4), 192),
        scaling="density",
        mode="psd",
    )
    mask = spec_freqs <= 40
    return {
        "freqs": spec_freqs[mask].tolist(),
        "times": (spec_times + start_sec).tolist(),
        "power": spec_power[mask].tolist(),
    }
