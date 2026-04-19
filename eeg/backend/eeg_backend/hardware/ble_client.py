"""BLE hardware interface: device connection and byte parsing."""
from __future__ import annotations

import asyncio
import threading
from typing import Callable

from bleak import BleakClient, BleakScanner

from ..contracts import RawFrame

DEVICE_NAME      = "EAREEG"
NOTIFY_UUID      = "0000fe42-8e22-4541-9d4c-21edae82ed19"
WRITE_UUID       = "0000fe41-8e22-4541-9d4c-21edae82ed19"
NUM_CHANNELS     = 8
ADC_SCALE_VOLTS  = 4.5
ADC_COUNTS       = 8_388_608   # 2^23
ADC_GAIN_DIVISOR = 1.0
SCAN_RETRIES     = 3
SCAN_TIMEOUT     = 5
SAMPLES_PER_NOTIFY = 5         # 5 samples × 8 ch × 3 bytes = 120 bytes
ADC_MAX_UV       = ADC_SCALE_VOLTS / ADC_GAIN_DIVISOR * 1e6


def convert_sample(sample_bytes: bytes) -> float:
    """24-bit big-endian signed ADC → microvolts."""
    value = (sample_bytes[0] << 16) | (sample_bytes[1] << 8) | sample_bytes[2]
    if value >= 0x800000:
        value -= 0x1000000
    return value * ADC_SCALE_VOLTS / (ADC_COUNTS * ADC_GAIN_DIVISOR) * 1e6


def uv_to_sample_bytes(uv: float) -> bytes:
    """Microvolts → 24-bit big-endian signed ADC bytes."""
    value = round(uv * ADC_COUNTS * ADC_GAIN_DIVISOR / (ADC_SCALE_VOLTS * 1e6))
    value = max(-0x800000, min(0x7FFFFF, value))
    if value < 0:
        value += 0x1000000
    return bytes([(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF])


def parse_notify_bytes(data: bytes) -> RawFrame:
    n_samples = len(data) // (NUM_CHANNELS * 3)
    samples = []
    for s in range(n_samples):
        row = [
            convert_sample(data[(s * NUM_CHANNELS + ch) * 3:(s * NUM_CHANNELS + ch) * 3 + 3])
            for ch in range(NUM_CHANNELS)
        ]
        samples.append(row)
    return RawFrame(samples=samples, source="ble")


class BLEClient:
    """Manages BLE connection to the EEG headset.

    Calls ``on_frame(RawFrame)`` whenever a BLE notification arrives.
    """

    def __init__(
        self,
        on_frame: Callable[[RawFrame], None],
        stop_app: threading.Event,
    ) -> None:
        self.on_frame  = on_frame
        self.stop_app  = stop_app
        self.lock      = threading.Lock()

        self.connection_state = "disconnected"
        self.status_message   = "Ready"

        self._ble_thread: threading.Thread | None = None
        self._disconnect_requested = threading.Event()

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "connection_state": self.connection_state,
                "status_message":   self.status_message,
            }

    def toggle_connection(self) -> None:
        with self.lock:
            state      = self.connection_state
            ble_thread = self._ble_thread
        if state in {"replay", "scanning", "connecting"}:
            return
        if state == "connected":
            self._disconnect_requested.set()
            with self.lock:
                self.status_message = "Disconnect requested…"
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

        def _on_notify(_: str, data: bytes) -> None:
            self.on_frame(parse_notify_bytes(data))

        try:
            async with BleakClient(device.address) as client:
                await client.start_notify(NOTIFY_UUID, _on_notify)
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
