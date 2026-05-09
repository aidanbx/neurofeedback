"""Three independent audio channels: alpha, theta, and combined beta."""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from ...contracts import MetricsSnapshot, ProgramOutput
from ..templates import RewardInhibitRuntime

DEFAULT_REWARD_PCT  = 65.0


@dataclass
class AlphaThetaBetaPayload:
    mode:          str
    drives:        dict[str, float]    # {"alpha": ..., "theta": ..., "beta": ...}
    thresholds:    dict[str, float]
    alpha_value:   float
    theta_value:   float
    beta_value:    float
    alpha_clarity: float
    theta_clarity: float
    beta_clarity:  float
    alpha_samples: int
    theta_samples: int
    beta_samples:  int
    alpha_reward_pct: float
    theta_reward_pct: float
    beta_reward_pct:  float


class AlphaThetaBetaRuntime(RewardInhibitRuntime):

    def __init__(self) -> None:
        super().__init__()
        self._alpha_reward_pct = DEFAULT_REWARD_PCT
        self._theta_reward_pct = DEFAULT_REWARD_PCT
        self._beta_reward_pct  = DEFAULT_REWARD_PCT
        self._init_calibration(["Alpha", "Theta", "Beta"])

    @property
    def program_id(self) -> str:
        return "alpha_theta_beta"

    def tick(self, snap: MetricsSnapshot, elapsed: float) -> ProgramOutput:
        alpha = snap.bands.get("Alpha")
        theta = snap.bands.get("Theta")

        alpha_val = alpha.log_absolute if alpha else 0.0
        theta_val = theta.log_absolute if theta else 0.0
        beta_val  = self._combined_beta_log_absolute(snap)

        self._ingest_sample(snap, elapsed, {
            "Alpha": alpha_val,
            "Theta": theta_val,
            "Beta":  beta_val,
        })

        counts = {k: len(v) for k, v in self._history.items()}
        a_thr = self._threshold_from_target("Alpha", self._alpha_reward_pct, elapsed=elapsed, fallback=alpha_val)
        t_thr = self._threshold_from_target("Theta", self._theta_reward_pct, elapsed=elapsed, fallback=theta_val)
        b_thr = self._threshold_from_target("Beta", self._beta_reward_pct, elapsed=elapsed, fallback=beta_val)
        alpha_low, alpha_high = self._range_for_band("Alpha", alpha_val, elapsed=elapsed)
        theta_low, theta_high = self._range_for_band("Theta", theta_val, elapsed=elapsed)
        beta_low, beta_high = self._range_for_band("Beta", beta_val, elapsed=elapsed)
        alpha_clarity = self._clarity_from_range(alpha_val, a_thr, alpha_low, alpha_high)
        theta_clarity = self._clarity_from_range(theta_val, t_thr, theta_low, theta_high)
        beta_clarity = self._clarity_from_range(beta_val, b_thr, beta_low, beta_high)
        mode = self._mode_for_elapsed(elapsed)

        payload = AlphaThetaBetaPayload(
            mode=mode,
            drives={
                "alpha": round(alpha_clarity, 4),
                "theta": round(theta_clarity, 4),
                "beta":  round(beta_clarity,  4),
            },
            thresholds={"alpha": round(a_thr, 4), "theta": round(t_thr, 4), "beta": round(b_thr, 4)},
            alpha_value=round(alpha_val, 4),
            theta_value=round(theta_val, 4),
            beta_value= round(beta_val,  4),
            alpha_clarity=round(alpha_clarity, 4),
            theta_clarity=round(theta_clarity, 4),
            beta_clarity= round(beta_clarity,  4),
            alpha_samples=counts.get("Alpha", 0),
            theta_samples=counts.get("Theta", 0),
            beta_samples= counts.get("Beta",  0),
            alpha_reward_pct=self._alpha_reward_pct,
            theta_reward_pct=self._theta_reward_pct,
            beta_reward_pct= self._beta_reward_pct,
        )

        status = f"{mode} | α={alpha_clarity:.2f} θ={theta_clarity:.2f} β={beta_clarity:.2f}"

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
        if "theta_reward_pct" in params:
            self._theta_reward_pct = float(np.clip(params["theta_reward_pct"], 0.0, 100.0))
        if "beta_reward_pct" in params:
            self._beta_reward_pct  = float(np.clip(params["beta_reward_pct"],  0.0, 100.0))

    def get_params(self) -> dict:
        return {
            **super().get_params(),
            "alpha_reward_pct": self._alpha_reward_pct,
            "theta_reward_pct": self._theta_reward_pct,
            "beta_reward_pct":  self._beta_reward_pct,
        }
