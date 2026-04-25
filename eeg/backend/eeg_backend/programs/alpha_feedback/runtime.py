"""Alpha reward + theta/beta inhibit program."""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from ...contracts import MetricsSnapshot, ProgramOutput
from ..templates import RewardInhibitRuntime, _quantile

DEFAULT_REWARD_PCT     = 65.0
DEFAULT_THETA_INHIB    = 15.0
DEFAULT_BETA_INHIB     = 15.0


@dataclass
class AlphaFeedbackPayload:
    mode:           str
    drives:         dict[str, float]   # {"clarity": 0–1}
    thresholds:     dict[str, float]   # {"alpha": ..., "theta": ..., "beta": ...}
    reward_active:  bool
    inhibit_active: bool
    theta_inhibit:  bool
    beta_inhibit:   bool
    alpha_value:    float
    theta_value:    float
    beta_value:     float
    alpha_norm:     float
    theta_norm:     float
    beta_norm:      float
    alpha_samples:  int
    theta_samples:  int
    beta_samples:   int
    reward_target_pct:   float
    theta_inhibit_pct:   float
    beta_inhibit_pct:    float


class AlphaFeedbackRuntime(RewardInhibitRuntime):
    program_id = "alpha_feedback"

    def __init__(self) -> None:
        super().__init__()
        self._reward_target_pct = DEFAULT_REWARD_PCT
        self._theta_inhibit_pct = DEFAULT_THETA_INHIB
        self._beta_inhibit_pct  = DEFAULT_BETA_INHIB
        self._init_calibration(["Alpha", "Theta", "Beta"])

    @property
    def program_id(self) -> str:  # type: ignore[override]
        return "alpha_feedback"

    def tick(self, snap: MetricsSnapshot, elapsed: float) -> ProgramOutput:
        alpha = snap.bands.get("Alpha")
        theta = snap.bands.get("Theta")

        alpha_val  = alpha.log_absolute if alpha else 0.0
        theta_val  = theta.log_absolute if theta else 0.0
        beta_val   = self._combined_beta_log_absolute(snap)

        combined_beta = beta_val

        # Calibration sample
        self._ingest_sample(snap, elapsed, {
            "Alpha": alpha_val,
            "Theta": theta_val,
            "Beta":  combined_beta,
        })

        enough = self._enough_samples()
        counts = {k: len(v) for k, v in self._calibration.items()}

        if not enough:
            alpha_vals = [v for _, v in self._calibration["Alpha"]]
            theta_vals = [v for _, v in self._calibration["Theta"]]
            beta_vals  = [v for _, v in self._calibration["Beta"]]
            alpha_threshold = self._threshold_from_target("Alpha", self._reward_target_pct) if alpha_vals else alpha_val
            theta_threshold = self._threshold_from_target("Theta", self._theta_inhibit_pct) if theta_vals else theta_val
            beta_threshold  = self._threshold_from_target("Beta",  self._beta_inhibit_pct) if beta_vals else combined_beta
            theta_inhibit   = theta_val >= theta_threshold
            beta_inhibit    = combined_beta  >= beta_threshold
            inhibit_active  = theta_inhibit or beta_inhibit
            alpha_low = min(alpha_vals) if alpha_vals else alpha_val - 0.25
            alpha_high = max(alpha_vals) if alpha_vals else alpha_val + 0.25
            clarity = 0.0 if inhibit_active else self._clarity_from_range(alpha_val, alpha_threshold, alpha_low, alpha_high)
            reward_active = not inhibit_active and alpha_val >= alpha_threshold
            mode = "warm_start"
        else:
            alpha_vals = [v for _, v in self._calibration["Alpha"]]
            theta_vals = [v for _, v in self._calibration["Theta"]]
            beta_vals  = [v for _, v in self._calibration["Beta"]]
            alpha_threshold = self._threshold_from_target("Alpha", self._reward_target_pct)
            theta_threshold = self._threshold_from_target("Theta", self._theta_inhibit_pct)
            beta_threshold  = self._threshold_from_target("Beta",  self._beta_inhibit_pct)
            theta_inhibit   = theta_val >= theta_threshold
            beta_inhibit    = combined_beta >= beta_threshold
            inhibit_active  = theta_inhibit or beta_inhibit
            alpha_low  = _quantile(alpha_vals, 0.1)
            alpha_high = _quantile(alpha_vals, 0.9)
            clarity = 0.0 if inhibit_active else self._clarity_from_range(
                alpha_val, alpha_threshold, alpha_low, alpha_high
            )
            reward_active = not inhibit_active and alpha_val >= alpha_threshold
            mode = "rolling"

        payload = AlphaFeedbackPayload(
            mode=mode,
            drives={"clarity": round(clarity, 4)},
            thresholds={
                "alpha": round(alpha_threshold, 4),
                "theta": round(theta_threshold, 4),
                "beta":  round(beta_threshold,  4),
            },
            reward_active=reward_active,
            inhibit_active=inhibit_active,
            theta_inhibit=theta_inhibit,
            beta_inhibit=beta_inhibit,
            alpha_value=round(alpha_val,   4),
            theta_value=round(theta_val,   4),
            beta_value= round(combined_beta, 4),
            alpha_norm= round(alpha_val,  4),
            theta_norm= round(theta_val,  4),
            beta_norm=  round(combined_beta,   4),
            alpha_samples=counts.get("Alpha", 0),
            theta_samples=counts.get("Theta", 0),
            beta_samples= counts.get("Beta",  0),
            reward_target_pct=self._reward_target_pct,
            theta_inhibit_pct=self._theta_inhibit_pct,
            beta_inhibit_pct= self._beta_inhibit_pct,
        )

        status = f"{mode} | clarity {clarity:.2f}" + (" | INHIBIT" if inhibit_active else " | reward" if reward_active else "")

        return ProgramOutput(
            program_id=self.program_id,
            elapsed=elapsed,
            status_text=status,
            payload=asdict(payload),
        )

    def set_params(self, params: dict) -> None:
        super().set_params(params)
        if "reward_target_pct" in params:
            self._reward_target_pct = float(np.clip(params["reward_target_pct"], 1.0, 99.0))
        if "theta_inhibit_pct" in params:
            self._theta_inhibit_pct = float(np.clip(params["theta_inhibit_pct"], 1.0, 99.0))
        if "beta_inhibit_pct" in params:
            self._beta_inhibit_pct  = float(np.clip(params["beta_inhibit_pct"],  1.0, 99.0))

    def get_params(self) -> dict:
        return {
            **super().get_params(),
            "reward_target_pct": self._reward_target_pct,
            "theta_inhibit_pct": self._theta_inhibit_pct,
            "beta_inhibit_pct":  self._beta_inhibit_pct,
        }
