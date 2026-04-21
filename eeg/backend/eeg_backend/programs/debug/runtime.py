"""Debug program runtime for instrumentation and UI diagnostics."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from ...contracts import MetricsSnapshot, ProgramOutput
from ..base import ProgramRuntime


@dataclass
class DebugPayload:
    eyes_closed: bool
    debug_gain: float
    marker_level: float
    debug_mode: str
    quality_score: float
    artifact_fraction: float
    alpha_smoothed: float
    beta_smoothed: float
    baseline_ready_count: int


class DebugRuntime(ProgramRuntime):
    def __init__(self) -> None:
        self._params: dict[str, Any] = {
            "eyes_closed": False,
            "debug_gain": 1.0,
            "marker_level": 50.0,
            "debug_mode": "observe",
        }

    @property
    def program_id(self) -> str:
        return "debug"

    def reset(self) -> None:
        pass

    def set_params(self, params: dict) -> None:
        self._params.update({
            "eyes_closed": bool(params.get("eyes_closed", self._params["eyes_closed"])),
            "debug_gain": float(params.get("debug_gain", self._params["debug_gain"])),
            "marker_level": float(params.get("marker_level", self._params["marker_level"])),
            "debug_mode": str(params.get("debug_mode", self._params["debug_mode"])),
        })

    def get_params(self) -> dict:
        return dict(self._params)

    def tick(self, snap: MetricsSnapshot, elapsed: float) -> ProgramOutput:
        alpha = snap.bands.get("Alpha")
        beta = snap.bands.get("Beta")
        ready_count = sum(1 for feat in snap.bands.values() if feat.baseline_ready)
        payload = DebugPayload(
            eyes_closed=bool(self._params["eyes_closed"]),
            debug_gain=float(self._params["debug_gain"]),
            marker_level=float(self._params["marker_level"]),
            debug_mode=str(self._params["debug_mode"]),
            quality_score=round(snap.quality_score, 2),
            artifact_fraction=round(snap.artifact_fraction, 4),
            alpha_smoothed=alpha.smoothed if alpha else 0.0,
            beta_smoothed=beta.smoothed if beta else 0.0,
            baseline_ready_count=ready_count,
        )
        state = "eyes closed" if payload.eyes_closed else "eyes open"
        return ProgramOutput(
            program_id=self.program_id,
            elapsed=elapsed,
            status_text=f"{payload.debug_mode} | {state} | gain {payload.debug_gain:.2f}",
            payload=asdict(payload),
        )
