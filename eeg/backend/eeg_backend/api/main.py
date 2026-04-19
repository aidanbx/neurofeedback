"""FastAPI app + SessionApp orchestrator."""
from __future__ import annotations

import asyncio
import importlib
import json
import logging
import threading
import time
from collections import deque
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from ..contracts import BandFeature, MetricsSnapshot, ProgramOutput
from ..dsp.constants import (
    BANDS, LIVE_BUF_SEC, METRIC_INTERVAL, SRATE, TRAINING_BANDS,
)
from ..dsp.pipeline import (
    apply_view_processing, compute_frame_metrics, compute_psd,
    compute_relative_band_power, compute_view_spectrogram, slice_bounds,
)
from ..hardware.ble_client import (
    ADC_MAX_UV, NUM_CHANNELS, BLEClient, parse_notify_bytes,
)
from ..hardware.replay import ReplayClient
from ..metrics.engine import MetricsEngine
from ..programs.base import ProgramRuntime
from ..sessions.recorder import SessionRecorder
from ..sessions.store import PROGRAMS_DIR, SESSIONS

from .routes import device as device_routes
from .routes import training as training_routes
from .routes import sessions as session_routes
from .routes import audio as audio_routes
from .websocket import manager, ws_endpoint

log = logging.getLogger(__name__)

CHANNEL = 0


# ── Program loader ─────────────────────────────────────────────────────────────

def _load_programs() -> dict[str, ProgramRuntime]:
    programs: dict[str, ProgramRuntime] = {}
    if not PROGRAMS_DIR.is_dir():
        return programs
    for d in sorted(PROGRAMS_DIR.iterdir()):
        if not d.is_dir() or not (d / "manifest.json").exists():
            continue
        prog_id = d.name
        try:
            mod = importlib.import_module(f"eeg_backend.programs.{prog_id}.runtime")
            cls_name = next(
                (name for name in dir(mod) if name.endswith("Runtime") and name != "ProgramRuntime"),
                None,
            )
            if cls_name:
                programs[prog_id] = getattr(mod, cls_name)()
        except Exception as exc:
            log.warning("Failed to load program %s: %s", prog_id, exc)
    return programs


# ── SessionApp orchestrator ────────────────────────────────────────────────────

class SessionApp:
    def __init__(self) -> None:
        self.lock     = threading.Lock()
        self.stop_app = threading.Event()

        self.live_buffers: list[deque] = [
            deque([0.0] * (SRATE * LIVE_BUF_SEC), maxlen=SRATE * LIVE_BUF_SEC)
            for _ in range(NUM_CHANNELS)
        ]
        self.artifact_rejection = False

        self.latest_snap: MetricsSnapshot | None = None
        self.latest_program_output: ProgramOutput | None = None

        self.recorder        = SessionRecorder()
        self.metrics_engine  = MetricsEngine()
        self.programs        = _load_programs()
        self.active_program_id: str | None = None

        self.ble   = BLEClient(on_frame=self._on_frame, stop_app=self.stop_app)
        self.replay = ReplayClient(on_frame=self._on_frame, stop_app=self.stop_app)

        self._analysis_thread = threading.Thread(target=self._analysis_loop, daemon=True)
        self._analysis_thread.start()

    def _on_frame(self, frame) -> None:
        with self.lock:
            rec        = self.recorder.recording
            started_at = self.recorder.recording_started_at
            idx        = self.recorder.record_sample_index

            for s_idx, values in enumerate(frame.samples):
                for ch, v in enumerate(values):
                    self.live_buffers[ch].append(v)
                if rec and started_at is not None:
                    self.recorder.on_sample(values, idx, started_at)
                    idx += 1

            if rec:
                self.recorder.record_sample_index = idx

    def _analysis_loop(self) -> None:
        while not self.stop_app.is_set():
            try:
                self._update_metrics()
            except Exception as exc:
                log.error("Analysis error: %s", exc)
            time.sleep(0.25)

    def _update_metrics(self) -> None:
        now = time.monotonic()
        with self.lock:
            live        = np.asarray(self.live_buffers[CHANNEL], dtype=float)
            channels    = [np.asarray(buf, dtype=float) for buf in self.live_buffers]
            recording   = self.recorder.recording
            started_at  = self.recorder.recording_started_at
            should_log  = recording and (now - self.recorder.last_metric_monotonic >= METRIC_INTERVAL)
            art_rej     = self.artifact_rejection
            elapsed     = self.recorder.session_duration_sec()
            prog_id     = self.active_program_id

        frame = compute_frame_metrics(live, channels, CHANNEL, art_rej, ADC_MAX_UV)
        if frame is None:
            return

        absolute_d = {
            "Delta": frame.absolute_training.delta,
            "Theta": frame.absolute_training.theta,
            "Alpha": frame.absolute_training.alpha,
            "SMR":   frame.absolute_training.smr,
            "Beta":  frame.absolute_training.beta,
            "Hi-Beta": frame.absolute_training.hi_beta,
        }
        relative_4_30_d = {
            "Theta":   frame.relative_4_30_training.theta,
            "Alpha":   frame.relative_4_30_training.alpha,
            "SMR":     frame.relative_4_30_training.smr,
            "Beta":    frame.relative_4_30_training.beta,
            "Hi-Beta": frame.relative_4_30_training.hi_beta,
        }

        band_features = self.metrics_engine.update(
            absolute=absolute_d,
            relative_4_30=relative_4_30_d,
            quality_score=frame.quality_score,
            artifact_fraction=frame.artifact_fraction,
        )
        # Include Delta as a stub so MetricsSnapshot.bands is complete
        delta_abs = frame.absolute_training.delta
        import math
        band_features["Delta"] = BandFeature(
            absolute=delta_abs,
            log_absolute=math.log(max(delta_abs, 1e-12)),
            baseline_delta=0.0,
            baseline_zscore=0.0,
            smoothed=0.0,
            baseline_ready=False,
            baseline_n=0,
            baseline_n_needed=0,
        )

        params = self.metrics_engine.get_params()
        snap = MetricsSnapshot(
            elapsed_sec=elapsed,
            quality_score=frame.quality_score,
            quality_label=frame.quality_label,
            artifact_fraction=frame.artifact_fraction,
            psd_freqs=frame.psd_freqs,
            psd_values=frame.psd_values,
            live_trace_t=frame.live_trace_t,
            live_trace_y=frame.live_trace_y,
            bands=band_features,
            params=params,
        )

        program_out: ProgramOutput | None = None
        if prog_id and prog_id in self.programs and recording:
            try:
                program_out = self.programs[prog_id].tick(snap, elapsed)
            except Exception as exc:
                log.error("Program error (%s): %s", prog_id, exc)

        with self.lock:
            self.latest_snap           = snap
            self.latest_program_output = program_out

            if should_log and started_at is not None:
                self._log_input_trace(snap, relative_4_30_d, band_features, elapsed, now)
            if program_out is not None and recording:
                self.recorder.write_program_output(program_out)

    def _log_input_trace(self, snap, rel, tf, elapsed, now) -> None:
        params = snap.params
        stamp  = (self.recorder.recording_started_at or datetime.now()) + timedelta(seconds=elapsed)
        row = {
            "time":             stamp.isoformat(timespec="milliseconds"),
            "elapsed":          f"{elapsed:.3f}",
            "metric_mode":      str(params.get("metric_mode", "baseline_delta")),
            "baseline_sec":     f"{float(params.get('baseline_sec', 0.0)):.3f}",
            "baseline_min_sec": f"{float(params.get('baseline_min_sec', 0.0)):.3f}",
            "quality_gate":     f"{float(params.get('quality_gate', 0.0)):.2f}",
            "artifact_gate":    f"{float(params.get('artifact_gate', 0.0)):.4f}",
            "quality_score":    f"{snap.quality_score:.2f}",
            "artifact_fraction":f"{snap.artifact_fraction:.4f}",
        }
        for name in TRAINING_BANDS:
            key  = name.lower().replace("-", "_")
            feat = tf.get(name)
            row[f"{key}_rel_pct"]           = f"{rel.get(name, 0.0):.4f}"
            row[f"{key}_absolute"]          = f"{feat.absolute:.6f}" if feat else "0.0"
            row[f"{key}_log_absolute"]      = f"{feat.log_absolute:.4f}" if feat else "0.0"
            row[f"{key}_baseline_delta"]    = f"{feat.baseline_delta:.4f}" if feat else "0.0"
            row[f"{key}_baseline_zscore"]   = f"{feat.baseline_zscore:.4f}" if feat else "0.0"
            row[f"{key}_smoothed"]          = f"{feat.smoothed:.4f}" if feat else "0.0"
            row[f"{key}_baseline_ready"]    = "1" if feat and feat.baseline_ready else "0"
            row[f"{key}_baseline_n"]        = str(feat.baseline_n if feat else 0)
            row[f"{key}_baseline_n_needed"] = str(feat.baseline_n_needed if feat else 0)
        self.recorder.log_input_trace(row)
        self.recorder.last_metric_monotonic = now

    def snapshot(self) -> dict[str, Any]:
        ble_snap    = self.ble.snapshot()
        replay_snap = self.replay.snapshot()
        with self.lock:
            duration = self.recorder.session_duration_sec()
            recording = self.recorder.recording
            snap_dict: dict[str, Any] = {}
            if self.latest_snap:
                snap_dict = asdict(self.latest_snap)
        return {
            "connection_state": replay_snap["connection_state"] if replay_snap.get("test_mode") else ble_snap["connection_state"],
            "status_message":   replay_snap["status_message"]   if replay_snap.get("test_mode") else ble_snap["status_message"],
            "test_mode":        replay_snap.get("test_mode", False),
            "recording":        recording,
            "artifact_rejection": self.artifact_rejection,
            "duration_sec":     duration,
            "metrics":          snap_dict,
            "active_program":   self.active_program_id,
        }

    def get_view(
        self,
        *,
        live_mode: bool,
        cursor_sec: float,
        window_sec: float,
        selected_channel: int,
        notch_60hz: bool,
        recenter: bool,
    ) -> dict[str, Any]:
        selected_channel = min(max(selected_channel, 0), NUM_CHANNELS - 1)
        window_sec = float(np.clip(window_sec, 1.0, 20.0))

        with self.lock:
            duration  = self.recorder.session_duration_sec()
            recording = self.recorder.recording
            rec_chans = self.recorder.recorded_channels
            if live_mode or not any(rec_chans):
                traces           = [np.asarray(buf, dtype=float) for buf in self.live_buffers]
                use_abs          = bool(recording and any(rec_chans))
                cursor_sec       = len(traces[selected_channel]) / SRATE
                base_offset_sec  = (duration - len(traces[selected_channel]) / SRATE) if use_abs else 0.0
            else:
                traces          = [np.asarray(ch, dtype=float) for ch in rec_chans]
                cursor_sec      = min(max(cursor_sec, window_sec), max(duration, window_sec))
                use_abs         = True
                base_offset_sec = 0.0

        available = len(traces[selected_channel]) if traces else 0
        if available == 0:
            return {"window_start_sec": 0.0, "window_end_sec": window_sec, "selected_channel": selected_channel,
                    "all_channels": [], "selected_trace": {"t": [], "y": []}}

        start_idx, end_idx, start_sec, end_sec = slice_bounds(cursor_sec, window_sec, available)
        if not use_abs:
            start_sec = 0.0
            end_sec   = (end_idx - start_idx) / SRATE
        else:
            start_sec += base_offset_sec
            end_sec   += base_offset_sec

        all_channels = []
        for idx, trace in enumerate(traces):
            seg = trace[start_idx:end_idx]
            if len(seg) == 0:
                all_channels.append({"channel": idx, "t": [], "y": []})
                continue
            x = (base_offset_sec + np.arange(start_idx, end_idx) / SRATE).tolist() if use_abs else (np.arange(len(seg)) / SRATE).tolist()
            all_channels.append({"channel": idx, "t": x, "y": seg.tolist()})

        selected_full    = traces[selected_channel]
        raw_selected_seg = selected_full[start_idx:end_idx]
        selected_seg     = raw_selected_seg.copy()
        if notch_60hz or recenter:
            proc         = apply_view_processing(selected_full, notch_60hz=notch_60hz, recenter=False)
            selected_seg = proc[start_idx:end_idx]
            if recenter:
                selected_seg = selected_seg - np.mean(selected_seg)
        selected_x = (base_offset_sec + np.arange(start_idx, end_idx) / SRATE) if use_abs else np.arange(len(selected_seg)) / SRATE

        raw_freqs, raw_psd         = compute_psd(raw_selected_seg)
        display_freqs, display_psd = compute_psd(selected_seg)
        rel_band_power = (
            compute_relative_band_power(display_freqs, display_psd)
            if len(display_freqs) else {name: 0.0 for name in BANDS}
        )

        return {
            "window_start_sec":    start_sec,
            "window_end_sec":      end_sec,
            "selected_channel":    selected_channel,
            "selected_trace":      {"t": selected_x.tolist(), "y": selected_seg.tolist()},
            "raw_trace":           {"t": selected_x.tolist(), "y": raw_selected_seg.tolist()},
            "raw_psd":             {"freqs": raw_freqs.tolist(), "values": raw_psd.tolist()},
            "display_psd":         {"freqs": display_freqs.tolist(), "values": display_psd.tolist()},
            "relative_band_power": rel_band_power,
            "spectrogram":         compute_view_spectrogram(selected_seg, start_sec),
        }


# ── FastAPI app ────────────────────────────────────────────────────────────────

APP = SessionApp()

app = FastAPI(title="EEG Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inject app into route modules
device_routes.set_app(APP)
training_routes.set_app(APP)
session_routes.set_app(APP)

app.include_router(device_routes.router, prefix="/api")
app.include_router(training_routes.router, prefix="/api/training")
app.include_router(session_routes.router, prefix="/api")
app.include_router(audio_routes.router, prefix="/api")


@app.get("/api/view")
async def get_view(
    mode: str = "live",
    cursor: float = 0.0,
    window: float = 4.0,
    channel: int = 0,
    notch60: int = 0,
    recenter: int = 0,
):
    return APP.get_view(
        live_mode=mode == "live",
        cursor_sec=cursor,
        window_sec=window,
        selected_channel=channel,
        notch_60hz=bool(notch60),
        recenter=bool(recenter),
    )


@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        manager.disconnect(websocket)


async def _broadcast_loop() -> None:
    while True:
        await asyncio.sleep(0.25)  # 4 Hz
        with APP.lock:
            snap    = APP.latest_snap
            prog_out = APP.latest_program_output

        if snap is None:
            continue

        msg = {
            "type": "metrics",
            "data": asdict(snap),
            "program_output": asdict(prog_out) if prog_out else None,
        }
        await manager.broadcast(msg)


@app.on_event("startup")
async def startup():
    asyncio.create_task(_broadcast_loop())
