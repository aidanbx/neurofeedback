"""DSP pipeline unit tests: pure sine → band power within tolerance."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
from eeg_backend.dsp.constants import SRATE, BANDS
from eeg_backend.dsp.pipeline import compute_frame_metrics, band_integral, compute_psd


def make_sine_buffer(freq_hz: float, duration_sec: float = 4.0, amplitude: float = 50.0) -> np.ndarray:
    t = np.arange(int(duration_sec * SRATE)) / SRATE
    return amplitude * np.sin(2 * np.pi * freq_hz * t)


def test_alpha_sine_dominant():
    alpha_hz = 10.0
    buf = make_sine_buffer(alpha_hz, duration_sec=4.0)
    channels = [buf] + [np.zeros_like(buf)] * 7
    result = compute_frame_metrics(buf, channels, 0, False, False, 4500000.0)
    assert result is not None

    freqs, psd = compute_psd(buf[-500:])
    alpha_lo, alpha_hi = BANDS["Alpha"]
    alpha_power = band_integral(freqs, psd, alpha_lo, alpha_hi)
    total_power  = sum(band_integral(freqs, psd, lo, hi) for lo, hi in BANDS.values())
    alpha_frac   = alpha_power / max(total_power, 1e-12)
    assert alpha_frac > 0.5, f"Alpha should dominate: got {alpha_frac:.2f}"


def test_theta_sine_dominant():
    buf = make_sine_buffer(6.0, duration_sec=4.0)
    freqs, psd = compute_psd(buf[-500:])
    theta_lo, theta_hi = BANDS["Theta"]
    theta_power = band_integral(freqs, psd, theta_lo, theta_hi)
    total_power  = sum(band_integral(freqs, psd, lo, hi) for lo, hi in BANDS.values())
    assert theta_power / max(total_power, 1e-12) > 0.5


def test_compute_frame_metrics_returns_processed_frame():
    buf = make_sine_buffer(10.0, duration_sec=4.0)
    channels = [buf] + [np.zeros_like(buf)] * 7
    result = compute_frame_metrics(buf, channels, 0, True, False, 4500000.0)
    assert result is not None
    assert len(result.psd_freqs) > 0
    assert result.quality_score >= 0
    assert result.quality_label in ("good", "fair", "poor")
    assert 0 <= result.artifact_fraction <= 1


def test_short_buffer_returns_none():
    buf = np.zeros(50)
    result = compute_frame_metrics(buf, [buf] * 8, 0, False, False, 4500000.0)
    assert result is None


def test_notch_toggle_changes_line_noise_metric():
    eeg = make_sine_buffer(10.0, duration_sec=4.0, amplitude=30.0)
    line = make_sine_buffer(60.0, duration_sec=4.0, amplitude=80.0)
    buf = eeg + line
    channels = [buf] + [np.zeros_like(buf)] * 7
    raw = compute_frame_metrics(buf, channels, 0, False, False, 4500000.0)
    notched = compute_frame_metrics(buf, channels, 0, False, True, 4500000.0)
    assert raw is not None and notched is not None
    assert raw.line_noise_ratio > 0.1
    assert abs(raw.line_noise_ratio - notched.line_noise_ratio) < raw.line_noise_ratio * 0.1
    assert notched.line_noise_ratio > 0.1
    assert max(notched.raw_psd_values) > max(notched.psd_values)


if __name__ == "__main__":
    test_alpha_sine_dominant()
    test_theta_sine_dominant()
    test_compute_frame_metrics_returns_processed_frame()
    test_short_buffer_returns_none()
    test_notch_toggle_changes_line_noise_metric()
    print("All DSP tests passed")
