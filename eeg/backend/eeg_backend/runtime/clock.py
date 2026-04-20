"""Session clock abstraction.

All timestamped session output (events, input-trace rows, output-trace rows,
notes) goes through a `SessionClock`. `LiveSessionClock` is sample-counter-
driven while EEG is streaming and falls back to wall time otherwise. Replay
will later add a `ReplaySessionClock` that drives `elapsed_sec()` from the
cursor of a recorded session; nothing else has to change.
"""
from __future__ import annotations

from datetime import datetime
from typing import Callable, Protocol

from ..dsp.constants import SRATE


class SessionClock(Protocol):
    def elapsed_sec(self) -> float: ...


class LiveSessionClock:
    """Sample-counter-driven; falls back to wall time before samples arrive.

    The sample counter is authoritative because it matches the timeline of the
    data actually recorded to disk. Wall time is only used as a fallback when a
    session has been started but no frames have arrived yet.
    """

    def __init__(
        self,
        get_sample_index: Callable[[], int],
        get_wall_anchor: Callable[[], datetime | None],
        srate: float = SRATE,
    ) -> None:
        self._get_sample_index = get_sample_index
        self._get_wall_anchor = get_wall_anchor
        self._srate = srate

    def elapsed_sec(self) -> float:
        idx = self._get_sample_index()
        if idx > 0:
            return idx / self._srate
        anchor = self._get_wall_anchor()
        if anchor is not None:
            return (datetime.now() - anchor).total_seconds()
        return 0.0


class FakeClock:
    """Deterministic clock for tests. Advance manually."""

    def __init__(self, t: float = 0.0) -> None:
        self.t = t

    def elapsed_sec(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt
