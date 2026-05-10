"""Configurable master neurofeedback runtime.

This runtime promotes frequency-band conditions to data. Presets mimic the
older fixed programs, while custom JSON params can define arbitrary bands.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from ...contracts import MetricsSnapshot, ProgramOutput
from ..templates import ARTIFACT_GATE, QUALITY_GATE, RewardInhibitRuntime


DEFAULT_BANDS_JSON = json.dumps([
    {"id": "alpha", "label": "Alpha", "lo_hz": 8.0, "hi_hz": 12.0, "role": "reward", "direction": "above", "target_pct": 65.0, "feature": "log_power", "dwell_sec": 0.0},
    {"id": "delta", "label": "Delta", "lo_hz": 0.5, "hi_hz": 4.0, "role": "inhibit_sfx", "direction": "above", "target_pct": 15.0, "feature": "log_power", "dwell_sec": 2.0},
    {"id": "beta", "label": "Beta+", "lo_hz": 15.0, "hi_hz": 30.0, "role": "inhibit_sfx", "direction": "above", "target_pct": 15.0, "feature": "log_power", "dwell_sec": 2.0},
])


PRESETS: dict[str, list[dict[str, Any]]] = {
    "alpha_feedback": [
        {"id": "alpha", "label": "Alpha", "lo_hz": 8.0, "hi_hz": 12.0, "role": "reward", "direction": "above", "target_pct": 65.0, "feature": "log_power", "dwell_sec": 0.0},
        {"id": "theta", "label": "Theta", "lo_hz": 4.0, "hi_hz": 8.0, "role": "inhibit", "direction": "above", "target_pct": 15.0, "feature": "log_power", "dwell_sec": 0.5},
        {"id": "beta", "label": "Beta+", "lo_hz": 15.0, "hi_hz": 30.0, "role": "inhibit_sfx", "direction": "above", "target_pct": 15.0, "feature": "log_power", "dwell_sec": 2.0},
    ],
    "alpha_theta_beta": [
        {"id": "alpha", "label": "Alpha", "lo_hz": 8.0, "hi_hz": 12.0, "role": "reward", "direction": "above", "target_pct": 65.0, "feature": "log_power", "dwell_sec": 0.0},
        {"id": "theta", "label": "Theta", "lo_hz": 4.0, "hi_hz": 8.0, "role": "reward", "direction": "above", "target_pct": 65.0, "feature": "log_power", "dwell_sec": 0.0},
        {"id": "beta", "label": "Beta+", "lo_hz": 15.0, "hi_hz": 30.0, "role": "reward", "direction": "above", "target_pct": 65.0, "feature": "log_power", "dwell_sec": 0.0},
    ],
    "alpha_theta_feedback": [
        {"id": "alpha", "label": "Alpha", "lo_hz": 8.0, "hi_hz": 12.0, "role": "reward", "direction": "above", "target_pct": 65.0, "feature": "smoothed", "dwell_sec": 0.0},
        {"id": "theta", "label": "Theta", "lo_hz": 4.0, "hi_hz": 8.0, "role": "reward", "direction": "above", "target_pct": 65.0, "feature": "smoothed", "dwell_sec": 0.0},
        {"id": "slow", "label": "Slow", "lo_hz": 0.5, "hi_hz": 4.0, "role": "inhibit_sfx", "direction": "above", "target_pct": 15.0, "feature": "log_power", "dwell_sec": 2.0},
        {"id": "beta", "label": "Beta+", "lo_hz": 15.0, "hi_hz": 30.0, "role": "inhibit_sfx", "direction": "above", "target_pct": 15.0, "feature": "smoothed", "dwell_sec": 2.0},
    ],
    "smr_feedback": [
        {"id": "smr", "label": "SMR", "lo_hz": 12.0, "hi_hz": 15.0, "role": "reward", "direction": "above", "target_pct": 27.5, "feature": "smoothed"},
        {"id": "theta", "label": "Theta", "lo_hz": 4.0, "hi_hz": 8.0, "role": "inhibit", "direction": "above", "target_pct": 15.0, "feature": "smoothed"},
        {"id": "hibeta", "label": "Hi-Beta", "lo_hz": 20.0, "hi_hz": 30.0, "role": "inhibit", "direction": "above", "target_pct": 15.0, "feature": "smoothed"},
    ],
    "debug": [
        {"id": "theta", "label": "Theta", "lo_hz": 4.0, "hi_hz": 8.0, "role": "observe", "direction": "above", "target_pct": 50.0, "feature": "log_power"},
        {"id": "alpha", "label": "Alpha", "lo_hz": 8.0, "hi_hz": 12.0, "role": "observe", "direction": "above", "target_pct": 50.0, "feature": "log_power"},
        {"id": "smr", "label": "SMR", "lo_hz": 12.0, "hi_hz": 15.0, "role": "observe", "direction": "above", "target_pct": 50.0, "feature": "log_power"},
        {"id": "beta", "label": "Beta+", "lo_hz": 15.0, "hi_hz": 30.0, "role": "observe", "direction": "above", "target_pct": 50.0, "feature": "log_power"},
    ],
}


@dataclass
class BandConditionPayload:
    id: str
    label: str
    lo_hz: float
    hi_hz: float
    role: str
    direction: str
    feature: str
    value: float
    threshold: float
    active: bool
    drive: float
    mean: float
    std: float
    zscore: float
    samples: int
    target_pct: float
    dwell_sec: float


@dataclass
class MasterFeedbackPayload:
    mode: str
    preset: str
    bands: list[dict[str, Any]]
    drives: dict[str, float]
    gates: dict[str, bool]
    reward_active: bool
    inhibit_active: bool
    any_active: bool
    all_rewards_active: bool


def _safe_id(value: Any, fallback: str) -> str:
    raw = str(value or fallback).strip().lower()
    out = "".join(ch if ch.isalnum() else "_" for ch in raw).strip("_")
    return out or fallback


def _coerce_band(raw: dict[str, Any], index: int) -> dict[str, Any]:
    lo = float(raw.get("lo_hz", raw.get("loHz", 8.0)))
    hi = float(raw.get("hi_hz", raw.get("hiHz", lo + 4.0)))
    lo, hi = sorted((max(0.0, lo), max(0.1, hi)))
    if math.isclose(lo, hi):
        hi = lo + 0.5
    direction = str(raw.get("direction", "above"))
    role = str(raw.get("role", "reward"))
    feature = str(raw.get("feature", "log_power"))
    return {
        "id": _safe_id(raw.get("id"), f"band_{index + 1}"),
        "label": str(raw.get("label") or f"{lo:g}-{hi:g} Hz"),
        "lo_hz": float(np.clip(lo, 0.0, 70.0)),
        "hi_hz": float(np.clip(hi, 0.1, 70.0)),
        "role": role if role in {"reward", "inhibit", "inhibit_sfx", "observe"} else "reward",
        "direction": direction if direction in {"above", "below"} else "above",
        "target_pct": float(np.clip(raw.get("target_pct", raw.get("targetPct", 50.0)), 0.0, 100.0)),
        "dwell_sec": float(np.clip(raw.get("dwell_sec", raw.get("dwellSec", 0.0)), 0.0, 10.0)),
        "feature": feature if feature in {"log_power", "absolute_power", "smoothed"} else "log_power",
    }


def _parse_bands(value: Any) -> list[dict[str, Any]]:
    raw = json.loads(value) if isinstance(value, str) else value
    if not isinstance(raw, list):
        raise ValueError("bands_json must decode to a list")
    bands = [_coerce_band(item, i) for i, item in enumerate(raw) if isinstance(item, dict)]
    return bands[:12]


class MasterFeedbackRuntime(RewardInhibitRuntime):
    program_id = "master_feedback"

    def __init__(self) -> None:
        super().__init__()
        self._preset = "alpha_feedback"
        self._bands = _parse_bands(DEFAULT_BANDS_JSON)
        self._bands_json = json.dumps(self._bands)
        self._init_calibration([band["id"] for band in self._bands])

    @property
    def program_id(self) -> str:  # type: ignore[override]
        return "master_feedback"

    def _apply_bands(self, bands: list[dict[str, Any]]) -> None:
        old = self._history
        self._bands = bands
        self._bands_json = json.dumps(bands)
        self._history = {band["id"]: old.get(band["id"], []) for band in bands}

    def _value_for_band(self, snap: MetricsSnapshot, band: dict[str, Any]) -> float:
        lo = band["lo_hz"]
        hi = band["hi_hz"]
        pairs = [(f, v) for f, v in zip(snap.psd_freqs, snap.psd_values) if lo <= f <= hi and NumberLike(v)]
        if not pairs:
            return 0.0
        vals = [float(v) for _, v in pairs]
        absolute = float(np.mean(vals))
        if band["feature"] == "absolute_power":
            return absolute
        log_power = math.log(max(absolute, 1e-12))
        if band["feature"] != "smoothed":
            return log_power
        named = self._matching_named_band(snap, lo, hi)
        return named.smoothed if named is not None else log_power

    def _matching_named_band(self, snap: MetricsSnapshot, lo: float, hi: float):
        ranges = {
            "Delta": (0.5, 4.0),
            "Theta": (4.0, 8.0),
            "Alpha": (8.0, 12.0),
            "SMR": (12.0, 15.0),
            "Beta": (15.0, 20.0),
            "Hi-Beta": (20.0, 30.0),
        }
        for name, (band_lo, band_hi) in ranges.items():
            if math.isclose(lo, band_lo, abs_tol=0.01) and math.isclose(hi, band_hi, abs_tol=0.01):
                return snap.bands.get(name)
        return None

    def tick(self, snap: MetricsSnapshot, elapsed: float) -> ProgramOutput:
        values = {band["id"]: self._value_for_band(snap, band) for band in self._bands}
        if snap.quality_score >= QUALITY_GATE and snap.artifact_fraction < ARTIFACT_GATE:
            for band_id, value in values.items():
                self._history.setdefault(band_id, []).append((elapsed, value))
            self._prune_history(elapsed)

        payload_bands: list[BandConditionPayload] = []
        drives: dict[str, float] = {}
        gates: dict[str, bool] = {}
        reward_states: list[bool] = []
        inhibit_states: list[bool] = []

        for band in self._bands:
            band_id = band["id"]
            value = values.get(band_id, 0.0)
            target = band["target_pct"]
            if band["direction"] == "below":
                threshold = self._threshold_below_target(band_id, target, elapsed=elapsed, fallback=value)
                active = value <= threshold
            else:
                threshold = self._threshold_from_target(band_id, target, elapsed=elapsed, fallback=value)
                active = value >= threshold
            active = self._dwell_active(band_id, threshold, band["direction"], band["dwell_sec"], elapsed, active)
            low, high = self._range_for_band(band_id, value, elapsed=elapsed)
            drive = self._condition_drive(value, threshold, low, high, band["direction"])
            vals = self._window_values(band_id)
            mean = float(np.mean(vals)) if vals else value
            std = float(np.std(vals)) if len(vals) > 1 else 0.0
            zscore = (value - mean) / max(std, 1e-6) if std > 0 else 0.0
            count = len(vals)
            drives[band_id] = round(drive, 4)
            gates[band_id] = active
            if band["role"] == "reward":
                reward_states.append(active)
            elif band["role"] in {"inhibit", "inhibit_sfx"}:
                inhibit_states.append(active)
            payload_bands.append(BandConditionPayload(
                id=band_id,
                label=band["label"],
                lo_hz=round(band["lo_hz"], 3),
                hi_hz=round(band["hi_hz"], 3),
                role=band["role"],
                direction=band["direction"],
                feature=band["feature"],
                value=round(value, 4),
                threshold=round(threshold, 4),
                active=active,
                drive=round(drive, 4),
                mean=round(mean, 4),
                std=round(std, 4),
                zscore=round(zscore, 4),
                samples=count,
                target_pct=target,
                dwell_sec=band["dwell_sec"],
            ))

        inhibit_active = any(inhibit_states)
        all_rewards_active = bool(reward_states) and all(reward_states)
        reward_active = bool(reward_states) and any(reward_states) and not inhibit_active
        any_active = any(gates.values())
        mode = self._mode_for_elapsed(elapsed)
        payload = MasterFeedbackPayload(
            mode=mode,
            preset=self._preset,
            bands=[asdict(band) for band in payload_bands],
            drives=drives,
            gates=gates,
            reward_active=reward_active,
            inhibit_active=inhibit_active,
            any_active=any_active,
            all_rewards_active=all_rewards_active,
        )
        state = "INHIBIT" if inhibit_active else "reward" if reward_active else "neutral"
        status = f"{mode} | {state} | {sum(1 for active in gates.values() if active)}/{len(gates)} gated"
        return ProgramOutput(self.program_id, elapsed, status, asdict(payload))

    def _threshold_below_target(self, band: str, target_pct: float, *, elapsed: float, fallback: float) -> float:
        vals = self._window_values(band)
        if not vals:
            return fallback
        if elapsed < self._threshold_window_sec:
            return self._fixed_threshold(band, fallback)
        return float(np.quantile(vals, target_pct / 100.0))

    def _prune_history(self, elapsed: float) -> None:
        max_dwell = max((band.get("dwell_sec", 0.0) for band in self._bands), default=0.0)
        keep_sec = max(self._threshold_window_sec, max_dwell)
        for lst in self._history.values():
            while len(lst) > 1 and lst[0][0] < elapsed - keep_sec - 1e-9:
                lst.pop(0)

    def _condition_drive(self, value: float, threshold: float, low: float, high: float, direction: str) -> float:
        if direction == "below":
            span = max(1e-6, threshold - low)
            return max(0.0, min(1.0, (threshold - value) / span))
        span = max(1e-6, high - threshold)
        return max(0.0, min(1.0, (value - threshold) / span))

    def _dwell_active(
        self,
        band: str,
        threshold: float,
        direction: str,
        dwell_sec: float,
        elapsed: float,
        immediate_active: bool,
    ) -> bool:
        if dwell_sec <= 0.0:
            return immediate_active
        samples = [(t, v) for t, v in self._history.get(band, []) if t >= elapsed - dwell_sec - 1e-9]
        if not samples:
            return False
        oldest = samples[0][0]
        if elapsed - oldest < dwell_sec:
            return False
        avg = float(np.mean([v for _, v in samples]))
        eps = 1e-9
        return avg <= threshold + eps if direction == "below" else avg >= threshold - eps

    def reset(self) -> None:
        self._history = {band["id"]: [] for band in self._bands}

    def set_params(self, params: dict) -> None:
        super().set_params(params)
        next_preset = str(params.get("preset", self._preset))
        preset_changed = next_preset != self._preset
        if next_preset == "custom":
            self._preset = "custom"
        elif next_preset in PRESETS and preset_changed:
            self._preset = next_preset
            self._apply_bands(_parse_bands(PRESETS[next_preset]))
        elif next_preset in PRESETS:
            self._preset = next_preset
        if "bands_json" in params and (next_preset == "custom" or not preset_changed):
            try:
                self._apply_bands(_parse_bands(params["bands_json"]))
            except Exception:
                pass

    def get_params(self) -> dict:
        return {
            **super().get_params(),
            "preset": self._preset,
            "bands_json": self._bands_json,
        }


def NumberLike(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except Exception:
        return False
