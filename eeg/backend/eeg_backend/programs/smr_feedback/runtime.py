"""SMR reward + theta/hi-beta inhibit program using asymmetrically smoothed metrics."""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from ...contracts import MetricsSnapshot, ProgramOutput
from ..templates import RewardInhibitRuntime

DEFAULT_REWARD_TARGET_PCT = 27.5
DEFAULT_INHIBIT_TARGET_PCT = 15.0
@dataclass
class SMRFeedbackPayload:
    mode: str
    drives: dict[str, float]
    thresholds: dict[str, float]
    reward_active: bool
    inhibit_active: bool
    theta_inhibit: bool
    hibeta_inhibit: bool
    smr_low: bool
    smr_value: float
    theta_value: float
    hibeta_value: float
    smr_samples: int
    theta_samples: int
    hibeta_samples: int
    reward_target_pct: float
    theta_inhibit_pct: float
    hibeta_inhibit_pct: float


class SMRFeedbackRuntime(RewardInhibitRuntime):
    program_id = "smr_feedback"

    def __init__(self) -> None:
        super().__init__()
        self._reward_target_pct = DEFAULT_REWARD_TARGET_PCT
        self._theta_inhibit_pct = DEFAULT_INHIBIT_TARGET_PCT
        self._hibeta_inhibit_pct = DEFAULT_INHIBIT_TARGET_PCT
        self._init_calibration(["SMR", "Theta", "Hi-Beta"])

    @property
    def program_id(self) -> str:  # type: ignore[override]
        return "smr_feedback"

    def tick(self, snap: MetricsSnapshot, elapsed: float) -> ProgramOutput:
        smr = snap.bands.get("SMR")
        theta = snap.bands.get("Theta")
        hi_beta = snap.bands.get("Hi-Beta")

        # Use the backend's asymmetrically smoothed metric so the program responds
        # with faster rises and slower falls without a separate reward dwell gate.
        smr_val = smr.smoothed if smr else 0.0
        theta_val = theta.smoothed if theta else 0.0
        hibeta_val = hi_beta.smoothed if hi_beta else 0.0

        self._ingest_sample(snap, elapsed, {
            "SMR": smr_val,
            "Theta": theta_val,
            "Hi-Beta": hibeta_val,
        })

        counts = {k: len(v) for k, v in self._history.items()}
        smr_threshold = self._threshold_from_target("SMR", self._reward_target_pct, elapsed=elapsed, fallback=smr_val)
        theta_threshold = self._threshold_from_target("Theta", self._theta_inhibit_pct, elapsed=elapsed, fallback=theta_val)
        hibeta_threshold = self._threshold_from_target("Hi-Beta", self._hibeta_inhibit_pct, elapsed=elapsed, fallback=hibeta_val)

        theta_inhibit = theta_val >= theta_threshold
        hibeta_inhibit = hibeta_val >= hibeta_threshold
        inhibit_active = theta_inhibit or hibeta_inhibit
        reward_active = smr_val >= smr_threshold and not inhibit_active

        smr_low_bound, smr_high = self._range_for_band("SMR", smr_val, elapsed=elapsed)
        # Keep the "SMR low" state aligned with the reward threshold shown in the chart.
        smr_low = smr_val < smr_threshold
        raw_clarity = 0.0 if inhibit_active else self._clarity_from_range(smr_val, smr_threshold, smr_low_bound, smr_high)
        clarity = raw_clarity if reward_active else 0.0
        mode = self._mode_for_elapsed(elapsed)

        payload = SMRFeedbackPayload(
            mode=mode,
            drives={"clarity": round(clarity, 4)},
            thresholds={
                "smr": round(smr_threshold, 4),
                "theta": round(theta_threshold, 4),
                "hibeta": round(hibeta_threshold, 4),
            },
            reward_active=reward_active,
            inhibit_active=inhibit_active,
            theta_inhibit=theta_inhibit,
            hibeta_inhibit=hibeta_inhibit,
            smr_low=smr_low,
            smr_value=round(smr_val, 4),
            theta_value=round(theta_val, 4),
            hibeta_value=round(hibeta_val, 4),
            smr_samples=counts.get("SMR", 0),
            theta_samples=counts.get("Theta", 0),
            hibeta_samples=counts.get("Hi-Beta", 0),
            reward_target_pct=self._reward_target_pct,
            theta_inhibit_pct=self._theta_inhibit_pct,
            hibeta_inhibit_pct=self._hibeta_inhibit_pct,
        )

        state = "INHIBIT" if inhibit_active else "reward" if reward_active else "neutral"
        status = f"{mode} | clarity {clarity:.2f} | {state}"

        return ProgramOutput(
            program_id=self.program_id,
            elapsed=elapsed,
            status_text=status,
            payload=asdict(payload),
        )

    def set_params(self, params: dict) -> None:
        super().set_params(params)
        if "reward_target_pct" in params:
            self._reward_target_pct = float(np.clip(params["reward_target_pct"], 0.0, 100.0))
        elif "reward_percentile" in params:
            self._reward_target_pct = float(np.clip(100.0 - float(params["reward_percentile"]), 0.0, 100.0))
        if "theta_inhibit_pct" in params:
            self._theta_inhibit_pct = float(np.clip(params["theta_inhibit_pct"], 0.0, 100.0))
        elif "theta_inhibit_percentile" in params:
            self._theta_inhibit_pct = float(np.clip(100.0 - float(params["theta_inhibit_percentile"]), 0.0, 100.0))
        if "hibeta_inhibit_pct" in params:
            self._hibeta_inhibit_pct = float(np.clip(params["hibeta_inhibit_pct"], 0.0, 100.0))
        elif "hibeta_inhibit_percentile" in params:
            self._hibeta_inhibit_pct = float(np.clip(100.0 - float(params["hibeta_inhibit_percentile"]), 0.0, 100.0))
    def get_params(self) -> dict:
        return {
            **super().get_params(),
            "reward_target_pct": self._reward_target_pct,
            "theta_inhibit_pct": self._theta_inhibit_pct,
            "hibeta_inhibit_pct": self._hibeta_inhibit_pct,
        }
