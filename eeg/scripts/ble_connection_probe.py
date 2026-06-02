#!/usr/bin/env python3
"""Standalone BLE probe for the EEG headset.

This intentionally avoids the EEG app so Bluetooth/device issues can be tested
directly. It logs scans, matched devices, connect attempts, and notifications.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import signal
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from bleak import BleakClient, BleakScanner


DEFAULT_NAME = "EAREEG"
DEFAULT_NOTIFY_UUID = "0000fe42-8e22-4541-9d4c-21edae82ed19"


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def safe_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): safe_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [safe_json(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return repr(value)


class Logger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("a", buffering=1)

    def close(self) -> None:
        self.file.close()

    def event(self, kind: str, **data: Any) -> None:
        row = {"ts": now_iso(), "kind": kind, **safe_json(data)}
        line = json.dumps(row, sort_keys=True)
        print(line, flush=True)
        self.file.write(line + "\n")


def device_row(device: Any, adv: Any | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "name": getattr(device, "name", None),
        "address": getattr(device, "address", None),
        "details": getattr(device, "details", None),
        "metadata": getattr(device, "metadata", None),
        "rssi": getattr(device, "rssi", None),
    }
    if adv is not None:
        row.update(
            {
                "adv_local_name": getattr(adv, "local_name", None),
                "adv_service_uuids": getattr(adv, "service_uuids", None),
                "adv_manufacturer_data": getattr(adv, "manufacturer_data", None),
                "adv_service_data": getattr(adv, "service_data", None),
                "adv_tx_power": getattr(adv, "tx_power", None),
                "adv_rssi": getattr(adv, "rssi", None),
            }
        )
    return row


def matches(device: Any, adv: Any | None, *, name: str, address: str | None, contains: str | None) -> bool:
    dev_name = getattr(device, "name", None) or ""
    local_name = getattr(adv, "local_name", None) or ""
    dev_addr = getattr(device, "address", None) or ""
    if address and dev_addr.lower() == address.lower():
        return True
    if dev_name == name or local_name == name:
        return True
    if contains:
        needle = contains.lower()
        return needle in dev_name.lower() or needle in local_name.lower()
    return False


async def scan_once(args: argparse.Namespace, logger: Logger) -> list[tuple[Any, Any | None]]:
    seen: dict[str, tuple[Any, Any | None]] = {}

    def on_detect(device: Any, adv: Any) -> None:
        key = getattr(device, "address", None) or repr(device)
        seen[key] = (device, adv)
        if args.log_all:
            logger.event("advertisement", device=device_row(device, adv))

    scanner = BleakScanner(detection_callback=on_detect)
    logger.event("scan_start", timeout_sec=args.scan_timeout)
    await scanner.start()
    await asyncio.sleep(args.scan_timeout)
    await scanner.stop()

    devices = list(seen.values())
    logger.event("scan_stop", count=len(devices))
    for device, adv in devices:
        is_match = matches(device, adv, name=args.name, address=args.address, contains=args.contains)
        if args.log_all or is_match:
            logger.event("device_seen", match=is_match, device=device_row(device, adv))
    return devices


async def connect_probe(device: Any, args: argparse.Namespace, logger: Logger) -> bool:
    notifications = 0

    def on_notify(_: Any, data: bytearray) -> None:
        nonlocal notifications
        notifications += 1
        if notifications <= args.max_notification_logs:
            logger.event(
                "notification",
                count=notifications,
                byte_count=len(data),
                first_bytes=bytes(data[:24]).hex(),
            )

    address = getattr(device, "address", None)
    logger.event("connect_start", address=address, name=getattr(device, "name", None))
    try:
        async with BleakClient(address, timeout=args.connect_timeout) as client:
            logger.event("connect_success", is_connected=client.is_connected)
            services = await client.get_services()
            logger.event(
                "services",
                services=[
                    {
                        "uuid": service.uuid,
                        "description": service.description,
                        "characteristics": [
                            {
                                "uuid": char.uuid,
                                "description": char.description,
                                "properties": list(char.properties),
                            }
                            for char in service.characteristics
                        ],
                    }
                    for service in services
                ],
            )
            if args.notify_uuid:
                logger.event("notify_start", uuid=args.notify_uuid)
                await client.start_notify(args.notify_uuid, on_notify)
                await asyncio.sleep(args.listen_sec)
                await client.stop_notify(args.notify_uuid)
                logger.event("notify_stop", notifications=notifications)
            return True
    except Exception as exc:
        logger.event(
            "connect_error",
            error_type=type(exc).__name__,
            error=str(exc),
            traceback=traceback.format_exc(),
        )
        return False


async def run(args: argparse.Namespace, logger: Logger) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    logger.event(
        "probe_start",
        python=sys.version,
        name=args.name,
        address=args.address,
        contains=args.contains,
        connect=args.connect,
        notify_uuid=args.notify_uuid,
    )

    attempt = 0
    while not stop.is_set() and (args.max_attempts == 0 or attempt < args.max_attempts):
        attempt += 1
        logger.event("attempt_start", attempt=attempt)
        try:
            devices = await scan_once(args, logger)
            matches_found = [
                (device, adv)
                for device, adv in devices
                if matches(device, adv, name=args.name, address=args.address, contains=args.contains)
            ]
            logger.event("matches", attempt=attempt, count=len(matches_found))
            for device, adv in matches_found:
                logger.event("match", attempt=attempt, device=device_row(device, adv))
                if args.connect:
                    ok = await connect_probe(device, args, logger)
                    if ok and args.stop_after_success:
                        logger.event("probe_stop", reason="success")
                        return
        except Exception:
            logger.event("attempt_error", attempt=attempt, traceback=traceback.format_exc())
        logger.event("attempt_stop", attempt=attempt)
        try:
            await asyncio.wait_for(stop.wait(), timeout=args.interval)
        except asyncio.TimeoutError:
            pass
    logger.event("probe_stop", reason="complete")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Continuously scan/connect to a BLE EEG headset.")
    parser.add_argument("--name", default=DEFAULT_NAME, help="Exact advertised name to match.")
    parser.add_argument("--contains", help="Case-insensitive substring to match in advertised names.")
    parser.add_argument("--address", help="Exact BLE address/UUID to connect to.")
    parser.add_argument("--notify-uuid", default=DEFAULT_NOTIFY_UUID, help="Notify characteristic UUID.")
    parser.add_argument("--no-notify", action="store_true", help="Connect but do not start notifications.")
    parser.add_argument("--connect", action="store_true", help="Try connecting to matched devices.")
    parser.add_argument("--scan-timeout", type=float, default=5.0, help="Seconds per scan attempt.")
    parser.add_argument("--connect-timeout", type=float, default=12.0, help="Seconds per connect attempt.")
    parser.add_argument("--listen-sec", type=float, default=5.0, help="Seconds to listen for notifications.")
    parser.add_argument("--interval", type=float, default=2.0, help="Seconds between attempts.")
    parser.add_argument("--max-attempts", type=int, default=0, help="0 means run until Ctrl-C.")
    parser.add_argument("--stop-after-success", action="store_true", help="Exit after first successful connect.")
    parser.add_argument("--log-all", action="store_true", help="Log all detected BLE advertisements.")
    parser.add_argument("--max-notification-logs", type=int, default=5, help="Limit notification sample logs.")
    parser.add_argument(
        "--log-file",
        default=f"logs/ble_probe_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl",
        help="JSONL output path.",
    )
    args = parser.parse_args()
    if args.no_notify:
        args.notify_uuid = None
    return args


def main() -> None:
    args = parse_args()
    logger = Logger(Path(args.log_file))
    try:
        asyncio.run(run(args, logger))
    finally:
        logger.close()


if __name__ == "__main__":
    main()
