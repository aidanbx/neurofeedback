"""Minimal default HTML report for sessions without a program-specific report."""
from __future__ import annotations

import html
import sys
from pathlib import Path

from eeg_backend.reports.base import (
    html_shell, load_csv, load_jsonl, load_metadata, load_program_outputs,
    table_from_rows,
)


def _artifact_row(session_dir: Path, name: str) -> str:
    path = session_dir / name
    status = "yes" if path.exists() else "no"
    size = path.stat().st_size if path.exists() else 0
    return f"<tr><td>{html.escape(name)}</td><td>{status}</td><td>{size}</td></tr>"


def build_report(session_dir: Path) -> str:
    metadata = load_metadata(session_dir)
    events = load_jsonl(session_dir / "session_events.jsonl")
    outputs = load_program_outputs(session_dir)
    _, input_rows = load_csv(session_dir / "program_input_trace.csv")

    final_output = outputs[-1:] if outputs else []
    final_input = input_rows[-1:] if input_rows else []

    body = f"""
<h1>EEG Session Report</h1>
<h2>Metadata</h2>
{table_from_rows([metadata])}
<h2>Artifacts</h2>
<table><thead><tr><th>File</th><th>Present</th><th>Bytes</th></tr></thead><tbody>
{_artifact_row(session_dir, "raw_eeg.csv")}
{_artifact_row(session_dir, "program_input_trace.csv")}
{_artifact_row(session_dir, "program_outputs.jsonl")}
{_artifact_row(session_dir, "program_output_trace.csv")}
{_artifact_row(session_dir, "session_events.jsonl")}
</tbody></table>
<h2>Session Events</h2>
{table_from_rows(events, limit=100)}
<h2>Final Metrics</h2>
{table_from_rows(final_input)}
<h2>Final Program Output</h2>
{table_from_rows(final_output)}
"""
    return html_shell("EEG Session Report", body)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: default_report.py SESSION_DIR", file=sys.stderr)
        return 2
    session_dir = Path(sys.argv[1])
    (session_dir / "report.html").write_text(build_report(session_dir), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
