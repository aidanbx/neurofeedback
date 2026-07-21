"""Shared template for reward/inhibit programs with rolling thresholds."""
from __future__ import annotations

import math

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
    """Rolling thresholds + clarity mapping.

    Subclasses configure band names and target percentages; this class handles
    the rolling window, threshold computation, and clarity mapping.
    """

    _DEFAULT_THRESHOLD_WINDOW_SEC   = 180.0
    _DEFAULT_CLARITY_AT_THRESHOLD   = 0.5
    _BOOTSTRAP_THRESHOLD_SEC        = 5.0
    _DEFAULT_QUALITY_GATE           = QUALITY_GATE
    _DEFAULT_ARTIFACT_GATE          = ARTIFACT_GATE

    def __init__(self) -> None:
        self._threshold_window_sec   = self._DEFAULT_THRESHOLD_WINDOW_SEC
        self._clarity_at_threshold   = self._DEFAULT_CLARITY_AT_THRESHOLD
        self._quality_gate           = self._DEFAULT_QUALITY_GATE
        self._artifact_gate          = self._DEFAULT_ARTIFACT_GATE
        self._gate_rewards_on_quality = True
        self._gate_rewards_on_artifacts = True
        self._gate_inhibits_on_quality = False
        self._gate_inhibits_on_artifacts = False
        self._history: dict[str, list[tuple[float, float]]] = {}

    def _init_calibration(self, band_names: list[str]) -> None:
        self._history = {name: [] for name in band_names}

    def _window_values(self, band: str) -> list[float]:
        return [v for _, v in self._history.get(band, [])]

    def _bootstrap_values(self, band: str) -> list[float]:
        bootstrap_sec = min(self._BOOTSTRAP_THRESHOLD_SEC, self._threshold_window_sec)
        return [v for t, v in self._history.get(band, []) if t <= bootstrap_sec]

    def _ingest_sample(
        self,
        snap: MetricsSnapshot,
        elapsed: float,
        band_values: dict[str, float],
    ) -> None:
        """Add one rolling-threshold sample if quality gates pass."""
        if not self._calibration_allowed(snap):
            return
        for name, val in band_values.items():
            if name in self._history:
                self._history[name].append((elapsed, val))
        self._prune_history(elapsed)

    def _gate_status(self, snap: MetricsSnapshot) -> dict[str, bool | float]:
        quality_pass = snap.quality_score >= self._quality_gate
        artifact_pass = snap.artifact_fraction < self._artifact_gate
        reward_allowed = (
            (quality_pass or not self._gate_rewards_on_quality)
            and (artifact_pass or not self._gate_rewards_on_artifacts)
        )
        inhibit_allowed = (
            (quality_pass or not self._gate_inhibits_on_quality)
            and (artifact_pass or not self._gate_inhibits_on_artifacts)
        )
        return {
            "quality_score": float(snap.quality_score),
            "quality_gate": float(self._quality_gate),
            "quality_pass": bool(quality_pass),
            "artifact_fraction": float(snap.artifact_fraction),
            "artifact_gate": float(self._artifact_gate),
            "artifact_pass": bool(artifact_pass),
            "reward_allowed": bool(reward_allowed),
            "inhibit_allowed": bool(inhibit_allowed),
            "gate_rewards_on_quality": bool(self._gate_rewards_on_quality),
            "gate_rewards_on_artifacts": bool(self._gate_rewards_on_artifacts),
            "gate_inhibits_on_quality": bool(self._gate_inhibits_on_quality),
            "gate_inhibits_on_artifacts": bool(self._gate_inhibits_on_artifacts),
        }

    def _calibration_allowed(self, snap: MetricsSnapshot) -> bool:
        return snap.quality_score >= self._quality_gate and snap.artifact_fraction < self._artifact_gate

    def _reward_allowed(self, snap: MetricsSnapshot) -> bool:
        return bool(self._gate_status(snap)["reward_allowed"])

    def _inhibit_allowed(self, snap: MetricsSnapshot) -> bool:
        return bool(self._gate_status(snap)["inhibit_allowed"])

    def _prune_history(self, elapsed: float) -> None:
        for lst in self._history.values():
            while len(lst) > 1 and lst[0][0] < elapsed - self._threshold_window_sec:
                lst.pop(0)

    def _fixed_threshold(self, band: str, fallback: float) -> float:
        vals = self._bootstrap_values(band)
        if vals:
            return float(np.mean(vals))
        vals = self._window_values(band)
        if vals:
            return float(np.mean(vals))
        return fallback

    def _threshold_from_target(self, band: str, target_pct: float, *, elapsed: float, fallback: float) -> float:
        vals = self._window_values(band)
        if not vals:
            return fallback
        if elapsed < self._threshold_window_sec:
            return self._fixed_threshold(band, fallback)
        return _quantile(vals, 1.0 - target_pct / 100.0)

    def _range_for_band(self, band: str, fallback: float, *, elapsed: float) -> tuple[float, float]:
        vals = self._window_values(band) if elapsed >= self._threshold_window_sec else self._bootstrap_values(band)
        if not vals:
            return (fallback - 0.25, fallback + 0.25)
        low = min(vals) if elapsed < self._threshold_window_sec else _quantile(vals, 0.1)
        high = max(vals) if elapsed < self._threshold_window_sec else _quantile(vals, 0.9)
        if math.isclose(low, high):
            return (low - 0.1, high + 0.1)
        return (low, high)

    def _mode_for_elapsed(self, elapsed: float) -> str:
        return "rolling" if elapsed >= self._threshold_window_sec else "starting"

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
        for lst in self._history.values():
            lst.clear()

    def set_params(self, params: dict) -> None:
        if "threshold_window_sec" in params:
            self._threshold_window_sec = float(np.clip(params["threshold_window_sec"], 1.0, 300.0))
        elif "calibration_window_sec" in params:
            self._threshold_window_sec = float(np.clip(params["calibration_window_sec"], 1.0, 300.0))
        if "clarity_at_threshold" in params:
            self._clarity_at_threshold = float(np.clip(params["clarity_at_threshold"], 0.05, 0.95))
        if "quality_gate" in params:
            self._quality_gate = float(np.clip(params["quality_gate"], 0.0, 100.0))
        if "artifact_gate" in params:
            self._artifact_gate = float(np.clip(params["artifact_gate"], 0.0, 1.0))
        if "gate_rewards_on_quality" in params:
            self._gate_rewards_on_quality = bool(params["gate_rewards_on_quality"])
        if "gate_rewards_on_artifacts" in params:
            self._gate_rewards_on_artifacts = bool(params["gate_rewards_on_artifacts"])
        if "gate_inhibits_on_quality" in params:
            self._gate_inhibits_on_quality = bool(params["gate_inhibits_on_quality"])
        if "gate_inhibits_on_artifacts" in params:
            self._gate_inhibits_on_artifacts = bool(params["gate_inhibits_on_artifacts"])

    def get_params(self) -> dict:
        return {
            "threshold_window_sec": self._threshold_window_sec,
            "clarity_at_threshold":   self._clarity_at_threshold,
            "quality_gate": self._quality_gate,
            "artifact_gate": self._artifact_gate,
            "gate_rewards_on_quality": self._gate_rewards_on_quality,
            "gate_rewards_on_artifacts": self._gate_rewards_on_artifacts,
            "gate_inhibits_on_quality": self._gate_inhibits_on_quality,
            "gate_inhibits_on_artifacts": self._gate_inhibits_on_artifacts,
        }
