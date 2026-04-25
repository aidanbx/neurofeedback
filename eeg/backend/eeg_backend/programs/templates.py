"""Shared template for reward/inhibit programs with rolling calibration."""
from __future__ import annotations

import math
from collections import deque
from typing import Any

import numpy as np

from ..contracts import MetricsSnapshot
from .base import ProgramRuntime

QUALITY_GATE  = 55.0
ARTIFACT_GATE = 0.30


def _log_add_exp(a: float, b: float) -> float:
    hi = max(a, b)
    lo = min(a, b)
    return hi + math.log1p(math.exp(lo - hi))


def _quantile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int((len(s) - 1) * p)))
    return s[idx]


class RewardInhibitRuntime(ProgramRuntime):
    """Rolling calibration + percentile threshold + clarity mapping.

    Subclasses configure band names and target percentages; this class handles
    the calibration deque, threshold computation, and clarity mapping.
    """

    _DEFAULT_CALIBRATION_WINDOW_SEC = 180.0
    _DEFAULT_CLARITY_AT_THRESHOLD   = 0.5
    _MIN_CALIBRATION_SAMPLES_CAP    = 30

    def __init__(self) -> None:
        self._calibration_window_sec = self._DEFAULT_CALIBRATION_WINDOW_SEC
        self._clarity_at_threshold   = self._DEFAULT_CLARITY_AT_THRESHOLD
        # {band_name: deque of (elapsed, value)}
        self._calibration: dict[str, list[tuple[float, float]]] = {}

    def _init_calibration(self, band_names: list[str]) -> None:
        self._calibration = {name: [] for name in band_names}

    def _min_calibration_samples(self) -> int:
        return max(20, round(min(self._calibration_window_sec, 30) / 0.5))

    def _ingest_sample(
        self,
        snap: MetricsSnapshot,
        elapsed: float,
        band_values: dict[str, float],
    ) -> None:
        """Add one calibration sample if quality gates pass."""
        if snap.quality_score < QUALITY_GATE or snap.artifact_fraction >= ARTIFACT_GATE:
            return
        # Require all bands to have ready baselines
        for name in self._calibration:
            feat = snap.bands.get(name)
            if feat is None or not feat.baseline_ready:
                return
        for name, val in band_values.items():
            if name in self._calibration:
                self._calibration[name].append((elapsed, val))
        self._prune_calibration(elapsed)

    def _prune_calibration(self, elapsed: float) -> None:
        for lst in self._calibration.values():
            while len(lst) > 1 and lst[0][0] < elapsed - self._calibration_window_sec:
                lst.pop(0)

    def _enough_samples(self) -> bool:
        min_n = self._min_calibration_samples()
        return all(len(lst) >= min_n for lst in self._calibration.values())

    def _threshold_from_target(self, band: str, target_pct: float) -> float:
        vals = [v for _, v in self._calibration.get(band, [])]
        if not vals:
            return 0.0
        return _quantile(vals, 1.0 - target_pct / 100.0)

    def _clarity_from_range(self, value: float, threshold: float, low: float, high: float) -> float:
        tc = max(0.05, min(0.95, self._clarity_at_threshold))
        if value <= threshold:
            span = max(1e-6, threshold - low)
            return tc * max(0.0, min(1.0, (value - low) / span))
        span = max(1e-6, high - threshold)
        return tc + (1.0 - tc) * max(0.0, min(1.0, (value - threshold) / span))

    def _combined_beta_smoothed(self, snap: MetricsSnapshot) -> float:
        beta    = snap.bands.get("Beta")
        hi_beta = snap.bands.get("Hi-Beta")
        a = beta.smoothed    if beta    else -20.0
        b = hi_beta.smoothed if hi_beta else -20.0
        return _log_add_exp(a, b)

    def _combined_beta_log_absolute(self, snap: MetricsSnapshot) -> float:
        beta = snap.bands.get("Beta")
        hi_beta = snap.bands.get("Hi-Beta")
        absolute = (beta.absolute if beta else 0.0) + (hi_beta.absolute if hi_beta else 0.0)
        return math.log(max(absolute, 1e-12))

    def reset(self) -> None:
        for lst in self._calibration.values():
            lst.clear()

    def set_params(self, params: dict) -> None:
        if "calibration_window_sec" in params:
            self._calibration_window_sec = max(10.0, float(params["calibration_window_sec"]))
        if "clarity_at_threshold" in params:
            self._clarity_at_threshold = float(np.clip(params["clarity_at_threshold"], 0.05, 0.95))

    def get_params(self) -> dict:
        return {
            "calibration_window_sec": self._calibration_window_sec,
            "clarity_at_threshold":   self._clarity_at_threshold,
        }
