#!/usr/bin/env python3
"""HTTP server + SessionApp orchestrator.

Thin layer that wires together:
  ble_client    — hardware connection and test-mode replay
  signal_engine — DSP, band power, quality scoring
  session_store — recording state and file persistence
"""
from __future__ import annotations

import csv
import json
import re
import shutil
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

import numpy as np

from ble_client import (
    ADC_SCALE_VOLTS, NUM_CHANNELS,
    BLEClient, convert_sample,
)
from session_store import (
    SESSIONS, SESSIONS_ARCHIVE, PROGRAMS_DIR,
    SessionRecorder, find_session_dir, note_template,
)
from signal_engine import (
    BANDS, SRATE, LIVE_BUF_SEC, METRIC_INTERVAL,
    apply_view_processing, compute_frame_metrics,
    compute_psd, compute_relative_band_power,
    compute_view_spectrogram, slice_bounds,
)
from training_metrics import TrainingMetricsState

HOST = "127.0.0.1"
PORT = 8765

MIME_TYPES: dict[str, str] = {
    ".html":  "text/html; charset=utf-8",
    ".css":   "text/css; charset=utf-8",
    ".js":    "application/javascript; charset=utf-8",
    ".json":  "application/json",
    ".jsonl": "application/jsonl",
    ".png":   "image/png",
    ".csv":   "text/csv",
    ".mp3":   "audio/mpeg",
    ".ogg":   "audio/ogg",
    ".wav":   "audio/wav",
}

SESSION_SERVE_EXTS = {".html", ".png", ".json", ".csv", ".jsonl"}

STATIC = Path(__file__).resolve().parent / "static"

DEVICE_META = {
    "device_name":          "EAREEG",
    "sample_rate_hz":       SRATE,
    "channel_visualized":   1,
    "adc_scale_volts":      ADC_SCALE_VOLTS,
    "analysis_highpass_hz": 0.3,
    "display_highpass_hz":  0.5,
    "notch_hz":             60.0,
}

CHANNEL = 0   # primary display/analysis channel
TRAINING_TRACE_BANDS = [name for name in BANDS if name != "Delta"]


# ── SessionApp (orchestrator) ─────────────────────────────────────────────────

class SessionApp:
    def __init__(self) -> None:
        self.lock     = threading.Lock()
        self.stop_app = threading.Event()

        self.live_buffers = [
            deque([0.0] * (SRATE * LIVE_BUF_SEC), maxlen=SRATE * LIVE_BUF_SEC)
            for _ in range(NUM_CHANNELS)
        ]
        self.artifact_rejection = False

        self.latest_metrics:      dict[str, Any] = {}
        self.latest_psd_freqs:    list[float]    = []
        self.latest_psd_values:   list[float]    = []
        self.latest_live_trace_t: list[float]    = []
        self.latest_live_trace_y: list[float]    = []

        self.recorder        = SessionRecorder()
        self.ble             = BLEClient(on_notify=self.on_notify, stop_app=self.stop_app)
        self.training_state  = TrainingMetricsState()

        self._analysis_thread = threading.Thread(target=self._analysis_loop, daemon=True)
        self._analysis_thread.start()

    # ── BLE data ingestion ────────────────────────────────────────────────────

    def on_notify(self, _: str, data: bytes) -> None:
        n_samples = len(data) // (NUM_CHANNELS * 3)
        with self.lock:
            rec        = self.recorder.recording
            started_at = self.recorder.recording_started_at
            idx        = self.recorder.record_sample_index

            for s in range(n_samples):
                values = [
                    convert_sample(data[(s * NUM_CHANNELS + ch) * 3:(s * NUM_CHANNELS + ch) * 3 + 3])
                    for ch in range(NUM_CHANNELS)
                ]
                for ch, v in enumerate(values):
                    self.live_buffers[ch].append(v)
                if rec and started_at is not None:
                    self.recorder.on_sample(values, idx, started_at)
                    idx += 1

            if rec:
                self.recorder.record_sample_index = idx

    # ── Analysis loop ─────────────────────────────────────────────────────────

    def _analysis_loop(self) -> None:
        while not self.stop_app.is_set():
            try:
                self._update_metrics()
            except Exception as exc:
                with self.lock:
                    self.ble.status_message = f"Analysis error: {exc}"
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

        result = compute_frame_metrics(live, channels, CHANNEL, art_rej, ADC_SCALE_VOLTS * 1e6)
        if result is None:
            return

        # Training features (stateful — must be called outside the lock)
        training_features = self.training_state.update(
            absolute       = result["absolute_training"],
            relative_4_30  = result["relative_4_30_training"],
            quality_score  = result["metrics"]["quality_score"],
            artifact_fraction = result["metrics"]["artifact_fraction"],
        )

        with self.lock:
            metrics = dict(result["metrics"])
            metrics["training_features"] = training_features
            metrics["training_params"]   = self.training_state.get_params()
            self.latest_metrics      = metrics
            self.latest_psd_freqs    = result["psd_freqs"]
            self.latest_psd_values   = result["psd_values"]
            self.latest_live_trace_t = result["live_trace_t"]
            self.latest_live_trace_y = result["live_trace_y"]

            if should_log and started_at is not None:
                elapsed = self.recorder.session_duration_sec()
                stamp   = started_at + timedelta(seconds=elapsed)
                rel     = result["relative_4_30_training"]
                tf      = training_features
                params  = self.training_state.get_params()
                row = {
                    "time":              stamp.isoformat(timespec="milliseconds"),
                    "elapsed":           f"{elapsed:.3f}",
                    "metric_mode":       str(params.get("metric_mode", "baseline_delta")),
                    "baseline_sec":      f"{float(params.get('baseline_sec', 0.0)):.3f}",
                    "baseline_min_sec":  f"{float(params.get('baseline_min_sec', 0.0)):.3f}",
                    "quality_gate":      f"{float(params.get('quality_gate', 0.0)):.2f}",
                    "artifact_gate":     f"{float(params.get('artifact_gate', 0.0)):.4f}",
                    "quality_score":     f"{result['score']:.2f}",
                    "artifact_fraction": f"{result['artifact_fraction']:.4f}",
                }
                for name in TRAINING_TRACE_BANDS:
                    key = name.lower().replace("-", "_")
                    feat = tf.get(name, {})
                    row[f"{key}_rel_pct"]            = f"{rel.get(name, 0.0):.4f}"
                    row[f"{key}_absolute"]           = f"{float(feat.get('absolute', 0.0)):.6f}"
                    row[f"{key}_log_absolute"]       = f"{float(feat.get('log_absolute', 0.0)):.4f}"
                    row[f"{key}_baseline_delta"]     = f"{float(feat.get('baseline_delta', 0.0)):.4f}"
                    row[f"{key}_baseline_zscore"]    = f"{float(feat.get('baseline_zscore', 0.0)):.4f}"
                    row[f"{key}_smoothed"]           = f"{float(feat.get('smoothed', 0.0)):.4f}"
                    row[f"{key}_baseline_ready"]     = "1" if feat.get("baseline_ready") else "0"
                    row[f"{key}_baseline_n"]         = str(int(feat.get("baseline_n", 0) or 0))
                    row[f"{key}_baseline_n_needed"]  = str(int(feat.get("baseline_n_needed", 0) or 0))
                self.recorder.log_input_trace(row)
                self.recorder.last_metric_monotonic = now

    # ── Snapshot ──────────────────────────────────────────────────────────────

    def snapshot(self) -> dict[str, Any]:
        ble_snap = self.ble.snapshot()
        with self.lock:
            duration = self.recorder.session_duration_sec()
            return {
                **ble_snap,
                "recording":         self.recorder.recording,
                "artifact_rejection": self.artifact_rejection,
                "duration_sec":      duration,
                "metrics":           dict(self.latest_metrics),
            }

    # ── Waveform view ─────────────────────────────────────────────────────────

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
            duration   = self.recorder.session_duration_sec()
            recording  = self.recorder.recording
            rec_chans  = self.recorder.recorded_channels
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
            return {
                "window_start_sec":    0.0,
                "window_end_sec":      window_sec,
                "selected_channel":    selected_channel,
                "selected_notch_60hz": notch_60hz,
                "selected_recenter":   recenter,
                "all_channels":        [],
                "selected_trace":      {"t": [], "y": []},
            }

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
            if use_abs:
                x = (base_offset_sec + np.arange(start_idx, end_idx) / SRATE).tolist()
            else:
                x = (np.arange(len(seg)) / SRATE).tolist()
            all_channels.append({"channel": idx, "t": x, "y": seg.tolist()})

        selected_full     = traces[selected_channel]
        raw_selected_seg  = selected_full[start_idx:end_idx]
        selected_seg      = raw_selected_seg.copy()
        if notch_60hz or recenter:
            proc         = apply_view_processing(selected_full, notch_60hz=notch_60hz, recenter=False)
            selected_seg = proc[start_idx:end_idx]
            if recenter:
                selected_seg = selected_seg - np.mean(selected_seg)
        if use_abs:
            selected_x = base_offset_sec + np.arange(start_idx, end_idx) / SRATE
        else:
            selected_x = np.arange(len(selected_seg)) / SRATE

        raw_freqs,     raw_psd     = compute_psd(raw_selected_seg)
        display_freqs, display_psd = compute_psd(selected_seg)
        rel_band_power = (
            compute_relative_band_power(display_freqs, display_psd)
            if len(display_freqs) else {name: 0.0 for name in BANDS}
        )

        return {
            "window_start_sec":    start_sec,
            "window_end_sec":      end_sec,
            "selected_channel":    selected_channel,
            "selected_notch_60hz": notch_60hz,
            "selected_recenter":   recenter,
            "selected_trace":      {"t": selected_x.tolist(), "y": selected_seg.tolist()},
            "raw_trace":           {"t": selected_x.tolist(), "y": raw_selected_seg.tolist()},
            "raw_psd":             {"freqs": raw_freqs.tolist(), "values": raw_psd.tolist()},
            "display_psd":         {"freqs": display_freqs.tolist(), "values": display_psd.tolist()},
            "relative_band_power": rel_band_power,
            "spectrogram":         compute_view_spectrogram(selected_seg, start_sec),
        }


APP = SessionApp()


# ── HTTP Handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def _write_response(self, data: bytes) -> None:
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self._write_response(data)

    def _serve_file(self, path: Path, content_type: str) -> None:
        size = path.stat().st_size
        range_header = self.headers.get("Range", "")
        range_match = re.match(r"bytes=(\d*)-(\d*)$", range_header)

        if range_match:
            start_s, end_s = range_match.groups()
            if start_s == "" and end_s == "":
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return
            if start_s == "":
                suffix_len = int(end_s)
                start = max(0, size - suffix_len)
                end = size - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else size - 1
            end = min(end, size - 1)
            if start >= size or start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return

            length = end - start + 1
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Type", content_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
            try:
                with path.open("rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        self._write_response(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                return
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        try:
            with path.open("rb") as f:
                shutil.copyfileobj(f, self.wfile, length=1024 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _serve_static(self, url_path: str) -> bool:
        rel = unquote(url_path[len("/static/"):])
        if ".." in rel:
            return False
        target = STATIC / rel
        if not target.exists() or not target.is_file():
            return False
        mime = MIME_TYPES.get(target.suffix.lower(), "application/octet-stream")
        self._serve_file(target, mime)
        return True

    # ── GET ───────────────────────────────────────────────────────────────────

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/state":
            self._send_json(APP.snapshot())
            return

        if parsed.path == "/api/view":
            q = parse_qs(parsed.query)
            self._send_json(APP.get_view(
                live_mode        = q.get("mode", ["live"])[0] == "live",
                cursor_sec       = float(q.get("cursor", ["0"])[0] or 0.0),
                window_sec       = float(q.get("window", ["4"])[0] or 4.0),
                selected_channel = int(q.get("channel", ["0"])[0] or 0),
                notch_60hz       = q.get("notch60", ["0"])[0] == "1",
                recenter         = q.get("recenter", ["0"])[0] == "1",
            ))
            return

        if parsed.path == "/api/sessions":
            self._send_json(APP.recorder.list_sessions())
            return

        if parsed.path == "/api/session/note":
            try:
                session_id = parse_qs(parsed.query).get("id", [""])[0]
                d = find_session_dir(session_id)
                if not d:
                    self._send_json({"ok": False, "error": "session not found", "exists": False})
                    return
                note_file = next(d.glob("*.md"), None)
                if note_file:
                    self._send_json({"ok": True, "content": note_file.read_text("utf-8"),
                                     "filename": note_file.name, "exists": True})
                else:
                    filename, template = note_template(session_id)
                    self._send_json({"ok": True, "content": template,
                                     "filename": filename, "exists": False})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc), "exists": False})
            return

        if parsed.path == "/api/test-mode":
            snap = APP.ble.snapshot()
            self._send_json({"active": snap["test_mode"], "source": APP.ble._replay_source})
            return

        if parsed.path == "/api/training/params":
            self._send_json(APP.training_state.get_params())
            return

        # Serve files from session directories: /session/<id>/<filename>
        if parsed.path.startswith("/session/"):
            parts = parsed.path.lstrip("/").split("/", 2)
            if len(parts) == 3:
                _, session_id, filename = parts
                safe_name = Path(filename).name
                ext = Path(safe_name).suffix.lower()
                if ext in SESSION_SERVE_EXTS:
                    d = find_session_dir(session_id)
                    if d:
                        target = d / safe_name
                        if target.exists():
                            mime = MIME_TYPES.get(ext, "application/octet-stream")
                            self._serve_file(target, mime)
                            return
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if parsed.path == "/api/programs":
            programs: list[dict[str, Any]] = []
            seen: set[str] = set()
            if PROGRAMS_DIR.is_dir():
                for d in sorted(PROGRAMS_DIR.iterdir()):
                    if d.is_dir() and (d / "manifest.json").exists():
                        try:
                            m = json.loads((d / "manifest.json").read_text())
                            m["_has_program_js"]  = (d / "program.js").exists()
                            m["_has_analysis_js"] = (d / "analysis.js").exists()
                            programs.append(m)
                            seen.add(d.name)
                        except Exception:
                            pass
                for f in sorted(PROGRAMS_DIR.glob("*.json")):
                    if f.stem not in seen:
                        try:
                            programs.append(json.loads(f.read_text()))
                        except Exception:
                            pass
            self._send_json(programs)
            return

        if parsed.path.startswith("/programs/"):
            parts = parsed.path.lstrip("/").split("/")
            if len(parts) == 3 and re.match(r"^[\w-]+$", parts[1]):
                prog_id, filename = parts[1], parts[2]
                if filename in ("program.js", "analysis.js", "manifest.json"):
                    target = PROGRAMS_DIR / prog_id / filename
                    if target.exists():
                        self._serve_file(target, MIME_TYPES.get(Path(filename).suffix, "text/plain"))
                        return
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if parsed.path == "/api/audio-tracks":
            tracks_dir = STATIC / "audio" / "tracks"
            tracks: list[dict[str, str]] = []
            if tracks_dir.is_dir():
                for f in sorted(tracks_dir.iterdir()):
                    if f.suffix.lower() in {".mp3", ".ogg", ".wav"}:
                        tracks.append({
                            "name": f.stem, "filename": f.name,
                            "url":  f"/static/audio/tracks/{quote(f.name)}",
                        })
            self._send_json(tracks)
            return

        if parsed.path in ("/", "/index.html"):
            self._serve_file(STATIC / "index.html", "text/html; charset=utf-8")
            return

        if parsed.path.startswith("/static/"):
            if self._serve_static(parsed.path):
                return

        self.send_error(HTTPStatus.NOT_FOUND)

    # ── POST ──────────────────────────────────────────────────────────────────

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/test-mode":
            body    = self._read_json_body()
            sid     = body.get("session_id")
            csv_path = None
            if sid:
                d = find_session_dir(sid)
                if d and (d / "raw_eeg.csv").exists():
                    csv_path = d / "raw_eeg.csv"
            result = APP.ble.toggle_test_mode(csv_path=csv_path, sessions_dir=SESSIONS)
            self._send_json({"ok": True, "result": result})
            return

        if parsed.path == "/api/connect-toggle":
            APP.ble.toggle_connection()
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/record-toggle":
            if APP.recorder.recording:
                path = APP.recorder.stop_recording(DEVICE_META)
                if path:
                    APP.recorder.start_analysis(path)
                self._send_json({"ok": True, "saved_to": str(path) if path else None})
            else:
                APP.recorder.start_recording()
                self._send_json({"ok": True})
            return

        if parsed.path == "/api/artifact-toggle":
            with APP.lock:
                APP.artifact_rejection = not APP.artifact_rejection
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/training/params":
            body = self._read_json_body()
            APP.training_state.set_params(body)
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/training/reset-baseline":
            APP.training_state.reset_baseline()
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/training/start":
            body = self._read_json_body()
            if not APP.recorder.recording:
                APP.recorder.start_recording()
            program = body.get("program")
            if program:
                APP.recorder.set_training_program(program)
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/training/stop":
            path = APP.recorder.stop_recording(DEVICE_META)
            if path:
                APP.recorder.start_analysis(path)
            self._send_json({"ok": True, "saved_to": str(path) if path else None})
            return

        if parsed.path == "/api/session/log":
            body = self._read_json_body()
            with APP.lock:
                if not APP.recorder.recording or not APP.recorder.recording_id:
                    self._send_json({"ok": False, "error": "not recording"})
                    return
                session_id = APP.recorder.recording_id
                elapsed    = (datetime.now() - APP.recorder.recording_started_at).total_seconds()
            out_dir = SESSIONS / session_id
            out_dir.mkdir(parents=True, exist_ok=True)
            line = json.dumps({"elapsed": round(elapsed, 3), **body}) + "\n"
            with open(out_dir / "session_events.jsonl", "a") as f:
                f.write(line)
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/session/output-trace":
            body = self._read_json_body()
            with APP.lock:
                if not APP.recorder.recording or not APP.recorder.recording_id:
                    self._send_json({"ok": False, "error": "not recording"})
                    return
                session_id = APP.recorder.recording_id
                elapsed    = (datetime.now() - APP.recorder.recording_started_at).total_seconds()
            out_dir    = SESSIONS / session_id
            out_dir.mkdir(parents=True, exist_ok=True)
            trace_file = out_dir / "program_output_trace.csv"
            row        = {"elapsed": f"{elapsed:.3f}", **{k: str(v) for k, v in body.items() if k != "elapsed"}}
            file_exists = trace_file.exists()
            with trace_file.open("a", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=list(row.keys()))
                if not file_exists:
                    writer.writeheader()
                writer.writerow(row)
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/session/note":
            body       = self._read_json_body()
            session_id = body.get("id", "")
            content    = body.get("content", "")
            d = find_session_dir(session_id)
            if not d:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            filename, _ = note_template(session_id)
            for old in d.glob("*.md"):
                old.unlink()
            (d / filename).write_text(content, encoding="utf-8")
            self._send_json({"ok": True, "filename": filename})
            return

        if parsed.path == "/api/session/note/append":
            body       = self._read_json_body()
            elapsed_sec = float(body.get("elapsed_sec", 0))
            text = str(body.get("text", "")).strip()
            if not text:
                self._send_json({"ok": False, "error": "empty text"})
                return
            with APP.lock:
                recording   = APP.recorder.recording
                session_id  = APP.recorder.recording_id or body.get("id", "")
                rec_started = APP.recorder.recording_started_at
            if not session_id:
                self._send_json({"ok": False, "error": "no active session"})
                return
            if recording and rec_started is not None:
                elapsed = (datetime.now() - rec_started).total_seconds()
                out_dir = SESSIONS / session_id
                out_dir.mkdir(parents=True, exist_ok=True)
                line = json.dumps({"elapsed": round(elapsed, 3), "type": "note", "text": text}) + "\n"
                with open(out_dir / "session_events.jsonl", "a") as f:
                    f.write(line)
            else:
                d = find_session_dir(session_id)
                if not d:
                    d = SESSIONS / session_id
                    d.mkdir(parents=True, exist_ok=True)
                existing = list(d.glob("*.md"))
                if existing:
                    note_path = existing[0]
                    note_content = note_path.read_text(encoding="utf-8")
                else:
                    filename, note_content = note_template(session_id)
                    note_path = d / filename
                m = int(elapsed_sec // 60)
                s = int(elapsed_sec % 60)
                note_path.write_text(
                    note_content.rstrip() + f"\n[{m}:{s:02d}] {text}\n", encoding="utf-8"
                )
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/session/note/delete":
            body       = self._read_json_body()
            session_id = body.get("id", "")
            d = find_session_dir(session_id)
            if d:
                for f in d.glob("*.md"):
                    f.unlink()
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/session/archive":
            body = self._read_json_body()
            ids  = body.get("ids", [])
            SESSIONS_ARCHIVE.mkdir(parents=True, exist_ok=True)
            moved, errors = [], []
            for sid in ids:
                if not re.match(r"^[\w]+$", sid):
                    errors.append(f"invalid id: {sid}")
                    continue
                src = SESSIONS / sid
                if not src.is_dir():
                    errors.append(f"not found: {sid}")
                    continue
                shutil.move(str(src), str(SESSIONS_ARCHIVE / sid))
                moved.append(sid)
            self._send_json({"ok": True, "moved": moved, "errors": errors})
            return

        if parsed.path == "/api/session/favorite":
            body     = self._read_json_body()
            sid      = body.get("id", "")
            want_fav = bool(body.get("favorite", True))
            if not re.match(r"^[\w]+$", sid):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            src = SESSIONS / sid
            if not src.is_dir():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            base     = re.sub(r"Favorite$", "", sid)
            new_name = base + ("Favorite" if want_fav else "")
            if new_name != sid:
                (SESSIONS / sid).rename(SESSIONS / new_name)
            self._send_json({"ok": True, "new_id": new_name})
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            return {}

    def log_message(self, format: str, *args: Any) -> None:
        return


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://{HOST}:{PORT}"
    print(f"Local UI at {url}")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        APP.stop_app.set()
        APP.ble._replay_stop.set()
        APP.ble._disconnect_requested.set()
        APP.recorder.stop_recording(DEVICE_META)
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
