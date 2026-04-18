"""BLE hardware interface: device connection, byte parsing, test-mode replay."""
from __future__ import annotations

import asyncio
import csv
import threading
import time
from pathlib import Path
from typing import Callable

from bleak import BleakClient, BleakScanner

from signal_engine import SRATE

# ── Hardware constants ────────────────────────────────────────────────────────
DEVICE_NAME      = "EAREEG"
NOTIFY_UUID      = "0000fe42-8e22-4541-9d4c-21edae82ed19"
WRITE_UUID       = "0000fe41-8e22-4541-9d4c-21edae82ed19"
NUM_CHANNELS     = 8
ADC_SCALE_VOLTS  = 4.5
ADC_COUNTS       = 8_388_608   # 2^23
ADC_GAIN_DIVISOR = 1.0
SCAN_RETRIES     = 3
SCAN_TIMEOUT     = 5
SAMPLES_PER_NOTIFY = 5         # BLE packet = 5 samples × 8 ch × 3 bytes = 120 bytes


# ── ADC conversion helpers ────────────────────────────────────────────────────

def convert_sample(sample_bytes: bytes) -> float:
    """24-bit big-endian signed ADC value → microvolts."""
    value = (sample_bytes[0] << 16) | (sample_bytes[1] << 8) | sample_bytes[2]
    if value >= 0x800000:
        value -= 0x1000000
    return value * ADC_SCALE_VOLTS / (ADC_COUNTS * ADC_GAIN_DIVISOR) * 1e6


def uv_to_sample_bytes(uv: float) -> bytes:
    """Microvolts → 24-bit big-endian signed ADC bytes (inverse of convert_sample)."""
    value = round(uv * ADC_COUNTS * ADC_GAIN_DIVISOR / (ADC_SCALE_VOLTS * 1e6))
    value = max(-0x800000, min(0x7FFFFF, value))
    if value < 0:
        value += 0x1000000
    return bytes([(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF])


# ── BLE client ────────────────────────────────────────────────────────────────

class BLEClient:
    """Manages BLE connection to the EEG headset and test-mode replay.

    Calls ``on_notify(handle, data)`` whenever a BLE notification arrives,
    exactly as the bleak callback signature — so the rest of the app is
    oblivious to whether data comes from hardware or replay.
    """

    def __init__(
        self,
        on_notify: Callable[[str, bytes], None],
        stop_app: threading.Event,
    ) -> None:
        self.on_notify   = on_notify
        self.stop_app    = stop_app
        self.lock        = threading.Lock()

        self.connection_state = "disconnected"
        self.status_message   = "Ready"

        self._ble_thread:    threading.Thread | None = None
        self._replay_thread: threading.Thread | None = None
        self._replay_stop    = threading.Event()
        self._replay_source: str | None = None
        self._disconnect_requested = threading.Event()

    # ── Public state ──────────────────────────────────────────────────────────

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "connection_state": self.connection_state,
                "status_message":   self.status_message,
                "test_mode":        self._replay_thread is not None and self._replay_thread.is_alive(),
            }

    # ── BLE connection ────────────────────────────────────────────────────────

    def toggle_connection(self) -> None:
        with self.lock:
            state      = self.connection_state
            ble_thread = self._ble_thread
        if state == "replay":
            return
        if state == "connected":
            self._disconnect_requested.set()
            with self.lock:
                self.status_message = "Disconnect requested…"
            return
        if state in {"scanning", "connecting"}:
            return
        if ble_thread is not None and ble_thread.is_alive():
            return
        self._disconnect_requested.clear()
        self._ble_thread = threading.Thread(target=self._run_ble, daemon=True)
        self._ble_thread.start()

    def _run_ble(self) -> None:
        asyncio.run(self._ble_stream())

    async def _ble_stream(self) -> None:
        with self.lock:
            self.connection_state = "scanning"
            self.status_message   = f"Scanning for {DEVICE_NAME}…"
        device = None
        for attempt in range(SCAN_RETRIES):
            devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT)
            device  = next((d for d in devices if d.name == DEVICE_NAME), None)
            if device:
                break
            with self.lock:
                self.status_message = f"Retry {attempt + 1}/{SCAN_RETRIES}…"
        if device is None:
            with self.lock:
                self.connection_state = "disconnected"
                self.status_message   = f"{DEVICE_NAME} not found"
            return
        try:
            async with BleakClient(device.address) as client:
                await client.start_notify(NOTIFY_UUID, self.on_notify)
                with self.lock:
                    self.connection_state = "connected"
                    self.status_message   = f"Connected to {device.address}"
                while not self.stop_app.is_set() and not self._disconnect_requested.is_set():
                    await asyncio.sleep(0.1)
                await client.stop_notify(NOTIFY_UUID)
        except Exception as exc:
            with self.lock:
                self.status_message = f"BLE error: {exc}"
        finally:
            with self.lock:
                self.connection_state = "disconnected"
            self._disconnect_requested.clear()

    # ── Test-mode replay ──────────────────────────────────────────────────────

    def toggle_test_mode(self, csv_path: Path | None = None, sessions_dir: Path | None = None) -> str:
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
        batch_sec = SAMPLES_PER_NOTIFY / SRATE   # 0.02 s

        all_rows: list[list[float]] = []
        try:
            with csv_path.open(newline="") as f:
                reader   = csv.DictReader(f)
                ch_cols  = [f"ch{i+1}_raw_uv" for i in range(NUM_CHANNELS)]
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
            payload = bytearray()
            for _ in range(SAMPLES_PER_NOTIFY):
                for ch_uv in all_rows[idx % total]:
                    payload.extend(uv_to_sample_bytes(ch_uv))
                idx += 1
            self.on_notify("replay", bytes(payload))

            deadline   += batch_sec
            sleep_for   = deadline - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)

        with self.lock:
            if self.connection_state == "replay":
                self.connection_state = "disconnected"
                self.status_message   = "Test mode stopped"
            self._replay_source = None
