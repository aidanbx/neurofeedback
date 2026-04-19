"""DSP constants and pre-computed filter coefficients."""
from __future__ import annotations

from scipy.signal import butter, iirnotch

SRATE                  = 250
LIVE_BUF_SEC           = 20
LIVE_TRACE_SEC         = 8
ANALYSIS_SEC           = 2
TRAINING_ANALYSIS_SEC  = 1.0
DIAGNOSTIC_SEC         = 8
METRIC_INTERVAL        = 0.5
SPEC_MAX_HZ            = 30.0

DISPLAY_HIGHPASS_HZ  = 0.5
ANALYSIS_HIGHPASS_HZ = 0.3
NOTCH_HZ   = 60.0
NOTCH_Q    = 30.0
LOWPASS_HZ = 45.0

DISPLAY_HP  = butter(2, DISPLAY_HIGHPASS_HZ,  btype="high", fs=SRATE, output="sos")
ANALYSIS_HP = butter(2, ANALYSIS_HIGHPASS_HZ, btype="high", fs=SRATE, output="sos")
LOWPASS     = butter(4, LOWPASS_HZ,           btype="low",  fs=SRATE, output="sos")
NOTCH_B, NOTCH_A = iirnotch(NOTCH_HZ, Q=NOTCH_Q, fs=SRATE)

BANDS: dict[str, tuple[float, float]] = {
    "Delta":   (1,  4),
    "Theta":   (4,  8),
    "Alpha":   (8,  12),
    "SMR":     (12, 15),
    "Beta":    (15, 20),
    "Hi-Beta": (20, 30),
}

TRAINING_BANDS: list[str] = [name for name in BANDS if name != "Delta"]
