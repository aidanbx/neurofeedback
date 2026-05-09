"""Alpha/theta reward + slow-wave and beta-above inhibit program."""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from ...contracts import MetricsSnapshot, ProgramOutput
from ..templates import RewardInhibitRuntime

DEFAULT_REWARD_TARGET_PCT = 27.5
DEFAULT_INHIBIT_TARGET_PCT = 15.0


@dataclass
class AlphaThetaFeedbackPayload:
    mode: str
    drives: dict[str, float]
    thresholds: dict[str, float]
    reward_active: bool
    inhibit_active: bool
    slow_inhibit: bool
    beta_inhibit: bool
    alpha_low: bool
    theta_low: bool
    alpha_value: float
    theta_value: float
    slow_value: float
    beta_value: float
    alpha_samples: int
    theta_samples: int
    slow_samples: int
    beta_samples: int
    alpha_reward_pct: float
    theta_reward_pct: float
    slow_inhibit_pct: float
    beta_inhibit_pct: float


class AlphaThetaFeedbackRuntime(RewardInhibitRuntime):
    program_id = "alpha_theta_feedback"

    def __init__(self) -> None:
        super().__init__()
        self._alpha_reward_pct = DEFAULT_REWARD_TARGET_PCT
        self._theta_reward_pct = DEFAULT_REWARD_TARGET_PCT
        self._slow_inhibit_pct = DEFAULT_INHIBIT_TARGET_PCT
        self._beta_inhibit_pct = DEFAULT_INHIBIT_TARGET_PCT
        self._init_calibration(["Alpha", "Theta", "Delta", "Beta"])

    @property
    def program_id(self) -> str:  # type: ignore[override]
        return "alpha_theta_feedback"

    def tick(self, snap: MetricsSnapshot, elapsed: float) -> ProgramOutput:
        alpha = snap.bands.get("Alpha")
        theta = snap.bands.get("Theta")
        delta = snap.bands.get("Delta")

        # Use the backend's asymmetrically smoothed metric so the program responds
        # with faster rises and slower falls without a separate reward dwell gate.
        alpha_val = alpha.smoothed if alpha else 0.0
        theta_val = theta.smoothed if theta else 0.0
        slow_val = delta.log_absolute if delta else 0.0
        beta_val = self._combined_beta_smoothed(snap)

        self._ingest_sample(snap, elapsed, {
            "Alpha": alpha_val,
            "Theta": theta_val,
            "Delta": slow_val,
            "Beta": beta_val,
        })

        counts = {k: len(v) for k, v in self._history.items()}
        alpha_threshold = self._threshold_from_target("Alpha", self._alpha_reward_pct, elapsed=elapsed, fallback=alpha_val)
        theta_threshold = self._threshold_from_target("Theta", self._theta_reward_pct, elapsed=elapsed, fallback=theta_val)
        slow_threshold = self._threshold_from_target("Delta", self._slow_inhibit_pct, elapsed=elapsed, fallback=slow_val)
        beta_threshold = self._threshold_from_target("Beta", self._beta_inhibit_pct, elapsed=elapsed, fallback=beta_val)

        slow_inhibit = self._slow_inhibit_pct > 0.0 and slow_val >= slow_threshold
        beta_inhibit = self._beta_inhibit_pct > 0.0 and beta_val >= beta_threshold
        inhibit_active = slow_inhibit or beta_inhibit
        alpha_reward = alpha_val >= alpha_threshold
        theta_reward = theta_val >= theta_threshold
        reward_active = (alpha_reward or theta_reward) and not inhibit_active

        alpha_low_bound, alpha_high = self._range_for_band("Alpha", alpha_val, elapsed=elapsed)
        theta_low_bound, theta_high = self._range_for_band("Theta", theta_val, elapsed=elapsed)
        alpha_low = alpha_val < alpha_threshold
        theta_low = theta_val < theta_threshold
        alpha_clarity = 0.0 if inhibit_active else self._clarity_from_range(alpha_val, alpha_threshold, alpha_low_bound, alpha_high)
        theta_clarity = 0.0 if inhibit_active else self._clarity_from_range(theta_val, theta_threshold, theta_low_bound, theta_high)
        if not alpha_reward:
            alpha_clarity = 0.0
        if not theta_reward:
            theta_clarity = 0.0
        mode = self._mode_for_elapsed(elapsed)

        payload = AlphaThetaFeedbackPayload(
            mode=mode,
            drives={
                "alpha": round(alpha_clarity, 4),
                "theta": round(theta_clarity, 4),
            },
            thresholds={
                "alpha": round(alpha_threshold, 4),
                "theta": round(theta_threshold, 4),
                "slow": round(slow_threshold, 4),
                "beta": round(beta_threshold, 4),
            },
            reward_active=reward_active,
            inhibit_active=inhibit_active,
            slow_inhibit=slow_inhibit,
            beta_inhibit=beta_inhibit,
            alpha_low=alpha_low,
            theta_low=theta_low,
            alpha_value=round(alpha_val, 4),
            theta_value=round(theta_val, 4),
            slow_value=round(slow_val, 4),
            beta_value=round(beta_val, 4),
            alpha_samples=counts.get("Alpha", 0),
            theta_samples=counts.get("Theta", 0),
            slow_samples=counts.get("Delta", 0),
            beta_samples=counts.get("Beta", 0),
            alpha_reward_pct=self._alpha_reward_pct,
            theta_reward_pct=self._theta_reward_pct,
            slow_inhibit_pct=self._slow_inhibit_pct,
            beta_inhibit_pct=self._beta_inhibit_pct,
        )

        state = "INHIBIT" if inhibit_active else "reward" if reward_active else "neutral"
        status = f"{mode} | alpha {alpha_clarity:.2f} theta {theta_clarity:.2f} | {state}"

        return ProgramOutput(
            program_id=self.program_id,
            elapsed=elapsed,
            status_text=status,
            payload=asdict(payload),
        )

    def set_params(self, params: dict) -> None:
        super().set_params(params)
        if "alpha_reward_pct" in params:
            self._alpha_reward_pct = float(np.clip(params["alpha_reward_pct"], 0.0, 100.0))
        elif "reward_target_pct" in params:
            self._alpha_reward_pct = float(np.clip(params["reward_target_pct"], 0.0, 100.0))
        elif "reward_percentile" in params:
            self._alpha_reward_pct = float(np.clip(100.0 - float(params["reward_percentile"]), 0.0, 100.0))
        if "theta_reward_pct" in params:
            self._theta_reward_pct = float(np.clip(params["theta_reward_pct"], 0.0, 100.0))
        if "slow_inhibit_pct" in params:
            self._slow_inhibit_pct = float(np.clip(params["slow_inhibit_pct"], 0.0, 100.0))
        if "beta_inhibit_pct" in params:
            self._beta_inhibit_pct = float(np.clip(params["beta_inhibit_pct"], 0.0, 100.0))

    def get_params(self) -> dict:
        return {
            **super().get_params(),
            "alpha_reward_pct": self._alpha_reward_pct,
            "theta_reward_pct": self._theta_reward_pct,
            "slow_inhibit_pct": self._slow_inhibit_pct,
            "beta_inhibit_pct": self._beta_inhibit_pct,
        }
