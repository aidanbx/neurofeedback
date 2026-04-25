"""DSP pipeline: filters, PSD, band power, artifact detection, quality scoring."""
from __future__ import annotations

import numpy as np
from scipy.signal import filtfilt, lfilter, sosfiltfilt, spectrogram, welch

from .constants import (
    ANALYSIS_HP, ANALYSIS_SEC, BANDS, DIAGNOSTIC_SEC, DISPLAY_HP,
    LIVE_TRACE_SEC, LOWPASS, NOTCH_A, NOTCH_B, SRATE,
    TRAINING_ANALYSIS_SEC,
)
from ..contracts import BandPowers, ProcessedFrame


# ── Pure signal utilities ─────────────────────────────────────────────────────

def clean_signal(
    data: np.ndarray,
    mode: str = "analysis",
    *,
    notch_60hz: bool = True,
    lowpass: bool = True,
) -> np.ndarray:
    if len(data) < 12:
        return np.asarray(data, dtype=float)
    sos = ANALYSIS_HP if mode == "analysis" else DISPLAY_HP
    filtered = sosfiltfilt(sos, np.asarray(data, dtype=float))
    if lowpass:
        filtered = sosfiltfilt(LOWPASS, filtered)
    if notch_60hz:
        filtered = lfilter(NOTCH_B, NOTCH_A, filtered)
    return np.asarray(filtered)


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


def _artifact_mask(clean: np.ndarray) -> np.ndarray:
    mad = float(np.median(np.abs(clean)))
    threshold = max(80.0, mad * 8.0)
    raw = np.abs(clean) > threshold
    expand = int(0.15 * SRATE)
    kernel = np.ones(2 * expand + 1)
    return np.convolve(raw.astype(float), kernel, mode="same") > 0


def _interpolate_artifacts(clean: np.ndarray, mask: np.ndarray) -> np.ndarray:
    clean_idx = np.where(~mask)[0]
    if len(clean_idx) < 2:
        return clean
    bad_idx = np.where(mask)[0]
    result = clean.copy()
    result[bad_idx] = np.interp(bad_idx, clean_idx, clean[clean_idx])
    return result


def _dict_to_bandpowers(d: dict[str, float]) -> BandPowers:
    return BandPowers(
        delta=d.get("Delta", 0.0),
        theta=d.get("Theta", 0.0),
        alpha=d.get("Alpha", 0.0),
        smr=d.get("SMR", 0.0),
        beta=d.get("Beta", 0.0),
        hi_beta=d.get("Hi-Beta", 0.0),
    )


def compute_frame_metrics(
    live: np.ndarray,
    channels: list[np.ndarray],
    channel_idx: int,
    artifact_rejection: bool,
    notch_60hz: bool,
    adc_max_uv: float,
) -> ProcessedFrame | None:
    training_count = int(TRAINING_ANALYSIS_SEC * SRATE)
    analysis_count = int(ANALYSIS_SEC * SRATE)
    diag_count     = int(DIAGNOSTIC_SEC * SRATE)
    if len(live) < training_count:
        return None

    live_seg      = live[-int(LIVE_TRACE_SEC * SRATE):]
    training_seg  = live[-training_count:]
    analysis_seg  = live[-analysis_count:] if len(live) >= analysis_count else live
    diag_seg      = live[-diag_count:]     if len(live) >= diag_count     else live

    live_filtered  = clean_signal(live_seg   - np.median(live_seg),   mode="display", notch_60hz=notch_60hz)
    analysis_clean = clean_signal(analysis_seg - np.median(analysis_seg), mode="analysis", notch_60hz=notch_60hz, lowpass=False)
    analysis_raw   = clean_signal(analysis_seg - np.median(analysis_seg), mode="analysis", notch_60hz=False, lowpass=False)
    diag_clean     = clean_signal(diag_seg   - np.median(diag_seg),   mode="analysis", notch_60hz=notch_60hz, lowpass=False)
    diag_raw       = clean_signal(diag_seg   - np.median(diag_seg),   mode="analysis", notch_60hz=False, lowpass=False)

    # Artifact detection on analysis window
    artifact_mask_arr = _artifact_mask(analysis_clean)
    artifact_fraction = float(np.mean(artifact_mask_arr))

    psd_input = analysis_clean
    if artifact_rejection and artifact_fraction < 0.8:
        psd_input = _interpolate_artifacts(analysis_clean, artifact_mask_arr)

    # 2-second display PSD
    freqs, psd = welch(psd_input, fs=SRATE,
                       nperseg=min(len(psd_input), 512),
                       noverlap=min(len(psd_input) // 2, 256))
    raw_freqs, raw_psd = welch(analysis_raw, fs=SRATE,
                               nperseg=min(len(analysis_raw), 512),
                               noverlap=min(len(analysis_raw) // 2, 256))
    diag_freqs, diag_psd = welch(diag_clean, fs=SRATE,
                                  nperseg=min(len(diag_clean), 1024),
                                  noverlap=min(len(diag_clean) // 2, 512))
    raw_diag_freqs, raw_diag_psd = welch(diag_raw, fs=SRATE,
                                         nperseg=min(len(diag_raw), 1024),
                                         noverlap=min(len(diag_raw) // 2, 512))

    absolute_d  = {name: band_integral(freqs, psd, lo, hi) for name, (lo, hi) in BANDS.items()}
    total_1_30  = band_integral(freqs, psd, 1, 30)
    relative_d  = {
        name: (v / total_1_30 * 100.0 if total_1_30 > 1e-9 else 0.0)
        for name, v in absolute_d.items()
    }

    # 1-second training PSD
    training_clean = clean_signal(training_seg - np.median(training_seg), mode="analysis", notch_60hz=notch_60hz)
    if artifact_rejection and artifact_fraction < 0.8:
        t_mask = _artifact_mask(training_clean)
        training_clean = _interpolate_artifacts(training_clean, t_mask)
    train_freqs, train_psd = welch(
        training_clean, fs=SRATE,
        nperseg=min(len(training_clean), 250),
        noverlap=min(len(training_clean) // 2, 125),
    )
    absolute_training_d = {name: band_integral(train_freqs, train_psd, lo, hi) for name, (lo, hi) in BANDS.items()}
    total_1_30_t = band_integral(train_freqs, train_psd, 1, 30)
    relative_1_30_training_d = {
        name: (absolute_training_d[name] / total_1_30_t * 100.0 if total_1_30_t > 1e-9 else 0.0)
        for name in BANDS
    }
    total_4_30_t = band_integral(train_freqs, train_psd, 4, 30)
    relative_4_30_training_d = {
        name: (absolute_training_d[name] / total_4_30_t * 100.0 if total_4_30_t > 1e-9 else 0.0)
        for name in BANDS if name != "Delta"
    }

    # Quality scoring
    low_freq_power = band_integral(diag_freqs, diag_psd, 0.25, 2.0)
    eeg_band_power = band_integral(diag_freqs, diag_psd, 2.0, 40.0)
    raw_line_power = band_integral(raw_diag_freqs, raw_diag_psd, 58.0, 62.0)
    raw_eeg_band_power = band_integral(raw_diag_freqs, raw_diag_psd, 2.0, 40.0)
    rms  = float(np.sqrt(np.mean(np.square(analysis_seg - np.median(analysis_seg)))))
    p2p  = float(np.percentile(analysis_seg, 99) - np.percentile(analysis_seg, 1))
    deriv = np.diff(analysis_seg)
    step_fraction = float(np.mean(np.abs(deriv) > max(25.0, 5.0 * np.std(deriv)))) if len(deriv) else 0.0
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
    line_ratio = raw_line_power / max(raw_eeg_band_power, 1e-9)
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

    psd_mask = freqs <= 70
    raw_psd_mask = raw_freqs <= 70

    return ProcessedFrame(
        psd_freqs=freqs[psd_mask].tolist(),
        psd_values=psd[psd_mask].tolist(),
        raw_psd_freqs=raw_freqs[raw_psd_mask].tolist(),
        raw_psd_values=raw_psd[raw_psd_mask].tolist(),
        absolute=_dict_to_bandpowers(absolute_d),
        relative=_dict_to_bandpowers(relative_d),
        absolute_training=_dict_to_bandpowers(absolute_training_d),
        relative_1_30_training=_dict_to_bandpowers(relative_1_30_training_d),
        relative_4_30_training=_dict_to_bandpowers({**relative_4_30_training_d, "Delta": 0.0}),
        quality_score=score,
        quality_label=label,
        artifact_fraction=artifact_fraction,
        common_mode_corr=common_corr,
        slow_wave_ratio=low_ratio,
        line_noise_ratio=line_ratio,
        live_trace_t=(np.arange(len(live_filtered)) / SRATE).tolist(),
        live_trace_y=live_filtered.tolist(),
    )


def compute_view_spectrogram(selected_seg: np.ndarray, start_sec: float) -> dict:
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
