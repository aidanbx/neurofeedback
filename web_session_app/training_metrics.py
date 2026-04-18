"""Stateful training metric pipeline.

Sits between the raw DSP output (absolute band power) and the feedback audio layer.

Pipeline per band:
  absolute power  →  log transform
                  →  robust baseline normalization (median / MAD over sliding window)
                  →  asymmetric smoothing
                  →  training_features dict returned to caller

All state (history buffers, smoothed values) is owned here so signal_engine.py stays pure.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from signal_engine import BANDS, METRIC_INTERVAL

# Only these bands are fed to training feedback (Delta excluded as always)
TRAINING_BANDS: list[str] = [name for name in BANDS if name != "Delta"]

METRIC_MODES = ("relative_4_30", "log_absolute", "baseline_delta", "baseline_zscore")


@dataclass
class TrainingParams:
    metric_mode:      str   = "baseline_delta"
    baseline_sec:     float = 60.0
    baseline_min_sec: float = 15.0
    use_mad:          bool  = True
    smoothing:        bool  = True
    rise_alpha:       float = 0.35
    fall_alpha:       float = 0.08
    quality_gate:     float = 55.0   # min quality_score to update baseline
    artifact_gate:    float = 0.30   # max artifact_fraction to update baseline


class TrainingMetricsState:
    """Call .update() every metric tick; returns per-band feature dict.

    Baseline is shared across all bands: the history tracks log(total_4_30_power).
    Each band's delta = log(abs_band) - shared_median, so bands with naturally
    higher absolute power (alpha) appear above bands with lower power (SMR).
    """

    def __init__(self) -> None:
        self.params = TrainingParams()
        self._shared_history: deque = deque()   # log of total 4-30 Hz power
        self._smoothed: dict[str, float] = {name: 0.0 for name in TRAINING_BANDS}
        self._rebuild_history()

    def _rebuild_history(self) -> None:
        max_n = max(1, round(self.params.baseline_sec / METRIC_INTERVAL))
        old = list(self._shared_history)
        self._shared_history = deque(old[-max_n:], maxlen=max_n)

    # ── Public ────────────────────────────────────────────────────────────────

    def set_params(self, d: dict[str, Any]) -> None:
        p = self.params
        if "metric_mode"      in d: p.metric_mode      = str(d["metric_mode"]) if d["metric_mode"] in METRIC_MODES else p.metric_mode
        if "baseline_sec"     in d: p.baseline_sec     = max(0.5, float(d["baseline_sec"]))
        if "baseline_min_sec" in d: p.baseline_min_sec = max(0.3, float(d["baseline_min_sec"]))
        if "use_mad"          in d: p.use_mad          = bool(d["use_mad"])
        if "smoothing"        in d: p.smoothing        = bool(d["smoothing"])
        if "rise_alpha"       in d: p.rise_alpha       = float(np.clip(d["rise_alpha"],   0.01, 1.0))
        if "fall_alpha"       in d: p.fall_alpha       = float(np.clip(d["fall_alpha"],   0.01, 1.0))
        if "quality_gate"     in d: p.quality_gate     = float(np.clip(d["quality_gate"], 0.0, 100.0))
        if "artifact_gate"    in d: p.artifact_gate    = float(np.clip(d["artifact_gate"],0.0,  1.0))
        self._rebuild_history()

    def get_params(self) -> dict[str, Any]:
        p = self.params
        return {
            "metric_mode":      p.metric_mode,
            "baseline_sec":     p.baseline_sec,
            "baseline_min_sec": p.baseline_min_sec,
            "use_mad":          p.use_mad,
            "smoothing":        p.smoothing,
            "rise_alpha":       p.rise_alpha,
            "fall_alpha":       p.fall_alpha,
            "quality_gate":     p.quality_gate,
            "artifact_gate":    p.artifact_gate,
        }

    def reset_baseline(self) -> None:
        self._shared_history.clear()
        self._smoothed = {name: 0.0 for name in TRAINING_BANDS}

    def update(
        self,
        absolute:       dict[str, float],
        relative_4_30:  dict[str, float],
        quality_score:  float,
        artifact_fraction: float,
    ) -> dict[str, Any]:
        """Compute one tick of training features.

        Returns a dict keyed by band name, each containing:
          absolute, log_absolute, baseline_delta, baseline_zscore, smoothed,
          baseline_ready, baseline_n
        """
        p = self.params
        good = quality_score >= p.quality_gate and artifact_fraction < p.artifact_gate
        min_n = max(1, round(p.baseline_min_sec / METRIC_INTERVAL))

        # ── Shared baseline: log of mean band power ──────────────────────────
        # Using mean (total/N) so delta = log(band) - log(mean) = log(band*N/total).
        # A band at exactly average share has delta=0; alpha above average → positive,
        # SMR below average → negative. log(total) would make everything negative.
        total_4_30  = sum(float(absolute.get(n, 0.0)) for n in TRAINING_BANDS)
        n_bands     = len(TRAINING_BANDS)
        log_mean    = float(np.log(max(total_4_30 / n_bands, 1e-12)))
        if good:
            self._shared_history.append(log_mean)

        hist = np.array(self._shared_history, dtype=float)
        baseline_ready = len(hist) >= min_n

        if baseline_ready and len(hist) >= 2:
            shared_med = float(np.median(hist))
            shared_mad = float(np.median(np.abs(hist - shared_med)))
            shared_sigma = 1.4826 * shared_mad
        else:
            shared_med   = log_mean
            shared_sigma = 1.0

        features: dict[str, Any] = {}

        for name in TRAINING_BANDS:
            abs_val = float(absolute.get(name, 0.0))
            log_abs = float(np.log(max(abs_val, 1e-12)))

            # Delta relative to shared total-power baseline
            baseline_delta  = log_abs - shared_med
            baseline_zscore = (baseline_delta / (shared_sigma + 1e-9)) if p.use_mad else baseline_delta

            # Select raw feature per mode
            if p.metric_mode == "relative_4_30":
                raw = float(relative_4_30.get(name, 0.0))
            elif p.metric_mode == "log_absolute":
                raw = log_abs
            elif p.metric_mode == "baseline_zscore":
                raw = baseline_zscore if baseline_ready else 0.0
            else:  # baseline_delta (default)
                raw = baseline_delta  if baseline_ready else 0.0

            # Asymmetric smoothing
            prev = self._smoothed[name]
            if p.smoothing:
                alpha = p.rise_alpha if raw > prev else p.fall_alpha
                smoothed = prev + alpha * (raw - prev)
            else:
                smoothed = raw
            self._smoothed[name] = smoothed

            features[name] = {
                "absolute":        round(abs_val, 6),
                "log_absolute":    round(log_abs, 4),
                "baseline_delta":  round(baseline_delta,  4),
                "baseline_zscore": round(baseline_zscore, 4),
                "smoothed":        round(smoothed,         4),
                "baseline_ready":  baseline_ready,
                "baseline_n":      len(hist),
                "baseline_n_needed": min_n,
            }

        return features
