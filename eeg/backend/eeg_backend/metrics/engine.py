"""Stateful training metric pipeline (renamed from TrainingMetricsState)."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any

import numpy as np

from ..dsp.constants import ANALYSIS_INTERVAL_SEC, BANDS, TRAINING_BANDS
from ..contracts import BandFeature

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
    quality_gate:     float = 55.0
    artifact_gate:    float = 0.30


class MetricsEngine:
    """Call .update() every metric tick; returns per-band BandFeature dict."""

    def __init__(self) -> None:
        self.params = TrainingParams()
        self._band_history: dict[str, deque] = {name: deque() for name in TRAINING_BANDS}
        self._smoothed: dict[str, float] = {name: 0.0 for name in TRAINING_BANDS}
        self._rebuild_history()

    def _rebuild_history(self) -> None:
        max_n = max(1, round(self.params.baseline_sec / ANALYSIS_INTERVAL_SEC))
        for name in TRAINING_BANDS:
            old = list(self._band_history.get(name, deque()))
            self._band_history[name] = deque(old[-max_n:], maxlen=max_n)

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
        if "artifact_gate"    in d: p.artifact_gate    = float(np.clip(d["artifact_gate"], 0.0, 1.0))
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
        for hist in self._band_history.values():
            hist.clear()
        self._smoothed = {name: 0.0 for name in TRAINING_BANDS}

    def update(
        self,
        absolute:          dict[str, float],
        relative_1_30:     dict[str, float],
        relative_4_30:     dict[str, float],
        quality_score:     float,
        artifact_fraction: float,
    ) -> dict[str, BandFeature]:
        p = self.params
        good = quality_score >= p.quality_gate and artifact_fraction < p.artifact_gate
        min_n = max(1, round(p.baseline_min_sec / ANALYSIS_INTERVAL_SEC))

        features: dict[str, BandFeature] = {}

        for name in TRAINING_BANDS:
            abs_val = float(absolute.get(name, 0.0))
            log_abs = float(np.log(max(abs_val, 1e-12)))
            if good:
                self._band_history[name].append(log_abs)

            hist = np.array(self._band_history[name], dtype=float)
            baseline_ready = len(hist) >= min_n

            if baseline_ready and len(hist) >= 2:
                band_med   = float(np.median(hist))
                band_mad   = float(np.median(np.abs(hist - band_med)))
                band_sigma = max(1.4826 * band_mad, 1e-6)
            else:
                band_med   = log_abs
                band_sigma = 1.0

            baseline_delta_raw  = log_abs - band_med
            baseline_zscore_raw = (baseline_delta_raw / band_sigma) if p.use_mad else baseline_delta_raw
            baseline_delta = baseline_delta_raw if baseline_ready else 0.0
            baseline_zscore = baseline_zscore_raw if baseline_ready else 0.0

            if p.metric_mode == "relative_4_30":
                raw = float(relative_4_30.get(name, 0.0))
            elif p.metric_mode == "log_absolute":
                raw = log_abs
            elif p.metric_mode == "baseline_zscore":
                raw = baseline_zscore
            else:
                raw = baseline_delta

            prev = self._smoothed[name]
            if p.smoothing:
                alpha    = p.rise_alpha if raw > prev else p.fall_alpha
                smoothed = prev + alpha * (raw - prev)
            else:
                smoothed = raw
            self._smoothed[name] = smoothed

            features[name] = BandFeature(
                absolute=round(abs_val, 6),
                relative_1_30=round(float(relative_1_30.get(name, 0.0)), 4),
                relative_4_30=round(float(relative_4_30.get(name, 0.0)), 4),
                log_absolute=round(log_abs, 4),
                baseline_delta=round(baseline_delta, 4),
                baseline_zscore=round(baseline_zscore, 4),
                smoothed=round(smoothed, 4),
                baseline_ready=baseline_ready,
                baseline_n=len(hist),
                baseline_n_needed=min_n,
            )

        return features
