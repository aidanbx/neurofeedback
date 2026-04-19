"""CSV replay for test mode."""
from __future__ import annotations

import csv
import threading
import time
from pathlib import Path
from typing import Callable

from ..contracts import RawFrame
from ..dsp.constants import SRATE
from .ble_client import NUM_CHANNELS, SAMPLES_PER_NOTIFY


class ReplayClient:
    """Replays raw_eeg.csv at exact sample rate, calling on_frame for each packet."""

    def __init__(
        self,
        on_frame: Callable[[RawFrame], None],
        stop_app: threading.Event,
    ) -> None:
        self.on_frame    = on_frame
        self.stop_app    = stop_app
        self.lock        = threading.Lock()

        self.connection_state = "disconnected"
        self.status_message   = "Ready"

        self._replay_thread: threading.Thread | None = None
        self._replay_stop    = threading.Event()
        self._replay_source: str | None = None

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "connection_state": self.connection_state,
                "status_message":   self.status_message,
                "test_mode":        self._replay_thread is not None and self._replay_thread.is_alive(),
                "replay_source":    self._replay_source,
            }

    def toggle(self, csv_path: Path | None = None, sessions_dir: Path | None = None) -> str:
        """Start or stop replay. Returns 'started', 'stopped', or 'no_data'."""
        with self.lock:
            running = self._replay_thread is not None and self._replay_thread.is_alive()
        if running:
            self._replay_stop.set()
            with self.lock:
                if self.connection_state == "replay":
                    self.connection_state = "disconnected"
                    self.status_message   = "Test mode stopped"
                self._replay_source = None
            return "stopped"

        if csv_path is None and sessions_dir is not None and sessions_dir.is_dir():
            candidates = sorted(
                (d for d in sessions_dir.iterdir()
                 if d.is_dir() and d.name != "archive" and (d / "raw_eeg.csv").exists()),
                key=lambda d: d.stat().st_mtime,
                reverse=True,
            )
            csv_path = candidates[0] / "raw_eeg.csv" if candidates else None

        if csv_path is None or not csv_path.exists():
            return "no_data"

        self._replay_stop.clear()
        with self.lock:
            self._replay_source   = str(csv_path)
            self.connection_state = "replay"
            self.status_message   = f"Test mode: {csv_path.parent.name}"

        self._replay_thread = threading.Thread(
            target=self._run_replay, args=(csv_path,), daemon=True
        )
        self._replay_thread.start()
        return "started"

    def _run_replay(self, csv_path: Path) -> None:
        batch_sec = SAMPLES_PER_NOTIFY / SRATE

        all_rows: list[list[float]] = []
        try:
            with csv_path.open(newline="") as f:
                reader  = csv.DictReader(f)
                ch_cols = [f"ch{i+1}_raw_uv" for i in range(NUM_CHANNELS)]
                for row in reader:
                    try:
                        all_rows.append([float(row[c]) for c in ch_cols])
                    except (KeyError, ValueError):
                        pass
        except Exception as exc:
            with self.lock:
                self.status_message   = f"Replay error: {exc}"
                self.connection_state = "disconnected"
                self._replay_source   = None
            return

        if not all_rows:
            with self.lock:
                self.connection_state = "disconnected"
                self._replay_source   = None
            return

        idx      = 0
        total    = len(all_rows)
        deadline = time.monotonic()
        while not self._replay_stop.is_set() and not self.stop_app.is_set():
            batch = [all_rows[(idx + s) % total] for s in range(SAMPLES_PER_NOTIFY)]
            idx  += SAMPLES_PER_NOTIFY
            frame = RawFrame(samples=batch, source="replay")
            self.on_frame(frame)

            deadline  += batch_sec
            sleep_for  = deadline - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)

        with self.lock:
            if self.connection_state == "replay":
                self.connection_state = "disconnected"
                self.status_message   = "Test mode stopped"
            self._replay_source = None
