"""BLE client state-machine tests."""
import asyncio
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import bleak  # noqa: F401
except ModuleNotFoundError:
    sys.modules["bleak"] = SimpleNamespace(
        BleakClient=object,
        BleakScanner=SimpleNamespace(discover=None),
    )

from eeg_backend.hardware import ble_client as ble_module
from eeg_backend.hardware.ble_client import BLEClient


def wait_for_state(client: BLEClient, state: str, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if client.snapshot()["connection_state"] == state:
            return
        time.sleep(0.01)
    raise AssertionError(f"timed out waiting for {state}")


def test_toggle_cancels_scan(monkeypatch):
    async def slow_discover(timeout):
        await asyncio.sleep(0.05)
        return []

    monkeypatch.setattr(ble_module.BleakScanner, "discover", slow_discover)

    client = BLEClient(on_frame=lambda frame: None, stop_app=threading.Event())
    client.toggle_connection()
    wait_for_state(client, "scanning")

    client.toggle_connection()
    client._ble_thread.join(timeout=1.0)

    snap = client.snapshot()
    assert snap["connection_state"] == "disconnected"
    assert snap["status_message"] == "Scan cancelled"


def test_cancelled_scan_does_not_connect(monkeypatch):
    connect_attempts = []

    async def slow_discover(timeout):
        await asyncio.sleep(0.05)
        return [SimpleNamespace(name=ble_module.DEVICE_NAME, address="test-device")]

    class FailIfConnected:
        def __init__(self, address):
            connect_attempts.append(address)

        async def __aenter__(self):
            raise AssertionError("cancelled scan should not connect")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(ble_module.BleakScanner, "discover", slow_discover)
    monkeypatch.setattr(ble_module, "BleakClient", FailIfConnected)

    client = BLEClient(on_frame=lambda frame: None, stop_app=threading.Event())
    client.toggle_connection()
    wait_for_state(client, "scanning")
    client.toggle_connection()
    client._ble_thread.join(timeout=1.0)

    assert connect_attempts == []
    assert client.snapshot()["connection_state"] == "disconnected"
