"""Abstract base class for all neurofeedback program runtimes."""
from __future__ import annotations

from abc import ABC, abstractmethod

from ..contracts import MetricsSnapshot, ProgramOutput


class ProgramRuntime(ABC):

    @abstractmethod
    def tick(self, snap: MetricsSnapshot, elapsed: float) -> ProgramOutput: ...

    @abstractmethod
    def reset(self) -> None: ...

    @abstractmethod
    def set_params(self, params: dict) -> None: ...

    @abstractmethod
    def get_params(self) -> dict: ...

    @property
    @abstractmethod
    def program_id(self) -> str: ...
