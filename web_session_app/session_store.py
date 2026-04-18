"""Session recording, file persistence, note handling, and session listing."""
from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROOT             = Path(__file__).resolve().parent
SESSIONS         = ROOT.parent / "sessions"
SESSIONS_ARCHIVE = SESSIONS / "archive"
PROGRAMS_DIR     = ROOT / "programs"
DEFAULT_REPORT   = PROGRAMS_DIR / "default_report.py"


# ── Session path helpers ──────────────────────────────────────────────────────

def find_session_dir(session_id: str) -> Path | None:
    if not re.match(r"^[\w]+$", session_id):
        return None
    d = SESSIONS / session_id
    if d.is_dir():
        return d
    arc = SESSIONS_ARCHIVE / session_id
    if arc.is_dir():
        return arc
    return None


def note_template(session_id: str) -> tuple[str, str]:
    """Return (filename, initial_content) for a new session note."""
    base_id = re.sub(r"Favorite$", "", session_id)
    m = re.match(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})", base_id)
    if m:
        year, mon, day, hour, minute = (int(x) for x in m.groups())
        ddd      = datetime(year, mon, day).strftime("%a")
        yy       = str(year)[2:]
        date_str = f"{yy}-{mon:02d}-{day:02d} {ddd}"
        time_str = f"{hour:02d}.{minute:02d}"
    else:
        date_str, time_str = session_id, ""

    protocol = "Session"
    d = find_session_dir(session_id)
    if d:
        try:
            meta = json.loads((d / "metadata.json").read_text())
            prog = meta.get("program") or meta.get("training_program")
            if prog:
                protocol = prog.get("title", "Session")
        except Exception:
            pass

    safe_proto  = re.sub(r'[/\\:*?"<>|]', "", protocol).strip()
    filename    = f"{date_str} {time_str} {safe_proto}.md".strip()
    daily_link  = f"[[{date_str}]]" if date_str else ""
    title       = f"{protocol} — {date_str} {time_str}".strip(" —")
    content     = f"{daily_link}\n\n# {title}\n\n## Notes\n\n"
    return filename, content


# ── Session recorder ──────────────────────────────────────────────────────────

class SessionRecorder:
    """Owns all mutable recording state and handles file persistence."""

    def __init__(self) -> None:
        self.lock = threading.Lock()

        self.recording             = False
        self.recording_started_at: datetime | None = None
        self.recording_id:         str | None = None
        self.record_sample_index   = 0
        self.last_metric_monotonic = 0.0

        self.raw_rows:           list[dict[str, Any]] = []
        self.recorded_channels:  list[list[float]]    = [[] for _ in range(8)]
        self.input_trace_rows:   list[dict[str, Any]] = []
        self.training_program:   dict | None          = None

        self._analysis_status: dict[str, str] = {}

    # ── Duration ──────────────────────────────────────────────────────────────

    def session_duration_sec(self) -> float:
        if self.recording_started_at is None:
            if self.recorded_channels[0]:
                return len(self.recorded_channels[0]) / 250
            return 0.0
        return self.record_sample_index / 250

    # ── Recording lifecycle ───────────────────────────────────────────────────

    def start_recording(self) -> None:
        with self.lock:
            if self.recording:
                return
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            self.recording             = True
            self.recording_started_at  = datetime.now()
            self.recording_id          = stamp
            self.record_sample_index   = 0
            self.last_metric_monotonic = 0.0
            self.raw_rows              = []
            self.recorded_channels     = [[] for _ in range(8)]
            self.input_trace_rows      = []
            self.training_program      = None

    def set_training_program(self, program: dict) -> None:
        with self.lock:
            self.training_program = program

    # ── Per-sample / per-tick accumulation ───────────────────────────────────

    def on_sample(self, values: list[float], sample_index: int, started_at: datetime) -> None:
        """Accumulate one raw sample (called inside the main app lock)."""
        elapsed = sample_index / 250
        stamp   = started_at + timedelta(seconds=elapsed)
        self.raw_rows.append({
            "time":         stamp.isoformat(timespec="milliseconds"),
            "elapsed":      f"{elapsed:.3f}",
            "sample_index": sample_index,
            **{f"ch{idx+1}_raw_uv": f"{v:.3f}" for idx, v in enumerate(values)},
        })
        for idx, v in enumerate(values):
            self.recorded_channels[idx].append(v)

    def log_input_trace(self, row: dict[str, Any]) -> None:
        """Accumulate one metrics tick row (called inside the main app lock)."""
        self.input_trace_rows.append(row)

    # ── Save session ──────────────────────────────────────────────────────────

    def stop_recording(self, device_meta: dict) -> Path | None:
        with self.lock:
            if not self.recording:
                return None
            self.recording  = False
            session_id      = self.recording_id
            raw_rows        = list(self.raw_rows)
            input_trace     = list(self.input_trace_rows)
            training_prog   = self.training_program
            started_at      = self.recording_started_at

        if not session_id or started_at is None:
            return None

        stopped_at = datetime.now()
        out_dir    = SESSIONS / session_id
        out_dir.mkdir(parents=True, exist_ok=True)

        # Raw EEG
        if raw_rows:
            with (out_dir / "raw_eeg.csv").open("w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=list(raw_rows[0].keys()))
                writer.writeheader()
                writer.writerows(raw_rows)

        # Program input trace (band powers + quality, always written if any data)
        if input_trace:
            with (out_dir / "program_input_trace.csv").open("w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=list(input_trace[0].keys()))
                writer.writeheader()
                writer.writerows(input_trace)

        metadata = {
            **device_meta,
            "recording_started_at": started_at.isoformat(timespec="milliseconds"),
            "recording_stopped_at": stopped_at.isoformat(timespec="milliseconds"),
            "program":              training_prog,
        }
        (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

        # Compile note events → .md
        events_file = out_dir / "session_events.jsonl"
        if events_file.exists() and not list(out_dir.glob("*.md")):
            note_events = []
            for line in events_file.read_text().splitlines():
                if line.strip():
                    try:
                        ev = json.loads(line)
                        if ev.get("type") == "note":
                            note_events.append(ev)
                    except json.JSONDecodeError:
                        pass
            if note_events:
                filename, content = note_template(session_id)
                for note in note_events:
                    elapsed = float(note.get("elapsed", 0))
                    text    = str(note.get("text", "")).strip()
                    if text:
                        m, s     = int(elapsed // 60), int(elapsed % 60)
                        content += f"\n[{m}:{s:02d}] {text}"
                (out_dir / filename).write_text(content.rstrip() + "\n", encoding="utf-8")

        return out_dir

    # ── Report / analysis ─────────────────────────────────────────────────────

    def start_analysis(self, session_dir: Path) -> None:
        session_id  = session_dir.name
        program_id: str | None = None
        try:
            meta       = json.loads((session_dir / "metadata.json").read_text())
            program_id = (meta.get("program") or meta.get("training_program") or {}).get("id")
        except Exception:
            pass
        script: Path | None = None
        if program_id:
            candidate = PROGRAMS_DIR / program_id / "report.py"
            if candidate.exists():
                script = candidate
        if script is None and DEFAULT_REPORT.exists():
            script = DEFAULT_REPORT
        if script is None:
            return
        with self.lock:
            self._analysis_status[session_id] = "running"
        t = threading.Thread(
            target=self._run_analysis_bg,
            args=(session_id, session_dir, script),
            daemon=True,
        )
        t.start()

    def _run_analysis_bg(self, session_id: str, session_dir: Path, script: Path) -> None:
        try:
            result = subprocess.run(
                [sys.executable, str(script), str(session_dir)],
                capture_output=True, text=True, timeout=120,
            )
            status = "done" if result.returncode == 0 else f"error: {result.stderr.strip()[:200]}"
        except Exception as exc:
            status = f"error: {exc}"
        with self.lock:
            self._analysis_status[session_id] = status

    # ── Session listing ───────────────────────────────────────────────────────

    def list_sessions(self) -> list[dict[str, Any]]:
        sessions: list[dict[str, Any]] = []
        if not SESSIONS.is_dir():
            return sessions
        with self.lock:
            status_map = dict(self._analysis_status)
        for d in sorted(SESSIONS.iterdir(), reverse=True):
            if not d.is_dir() or d.name == "archive":
                continue
            meta_file = d / "metadata.json"
            if not meta_file.exists():
                continue
            try:
                meta = json.loads(meta_file.read_text())
            except Exception:
                continue
            duration = 0.0
            started  = meta.get("recording_started_at", "")
            stopped  = meta.get("recording_stopped_at", "")
            if started and stopped:
                try:
                    duration = (datetime.fromisoformat(stopped) - datetime.fromisoformat(started)).total_seconds()
                except Exception:
                    pass
            if not duration:
                for csv_name in ("program_input_trace.csv", "derived_metrics.csv"):
                    try:
                        p = d / csv_name
                        if p.exists():
                            rows = list(csv.reader(p.open()))
                            if len(rows) > 1 and "elapsed" in rows[0]:
                                duration = float(rows[-1][rows[0].index("elapsed")])
                                break
                    except Exception:
                        pass
            prog      = meta.get("program") or meta.get("training_program")
            note_file = next(d.glob("*.md"), None)
            sessions.append({
                "id":               d.name,
                "started_at":       meta.get("recording_started_at", ""),
                "duration_sec":     duration,
                "device":           meta.get("device_name", ""),
                "has_report":       (d / "report.html").exists(),
                "analysis_status":  status_map.get(d.name, "not_run"),
                "training_program": prog.get("title") if prog else None,
                "is_favorite":      d.name.endswith("Favorite"),
                "has_note":         note_file is not None,
            })
        return sessions
