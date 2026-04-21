"""Shared utilities for HTML report generation."""
from __future__ import annotations

import csv
import json
import html
from pathlib import Path


def load_metadata(session_dir: Path) -> dict:
    try:
        return json.loads((session_dir / "metadata.json").read_text())
    except Exception:
        return {}


def load_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists():
        return [], []
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    return list(rows[0].keys()) if rows else [], rows


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


def load_program_outputs(session_dir: Path) -> list[dict]:
    rows = load_jsonl(session_dir / "program_outputs.jsonl")
    if rows:
        return rows
    _, csv_rows = load_csv(session_dir / "program_output_trace.csv")
    return [
        {
            "elapsed": row.get("elapsed"),
            "program_id": row.get("program_id"),
            "status_text": row.get("status_text"),
            "payload": {
                key: value for key, value in row.items()
                if key not in {"elapsed", "program_id", "status_text"}
            },
        }
        for row in csv_rows
    ]


def table_from_rows(rows: list[dict], *, limit: int = 20) -> str:
    if not rows:
        return "<p>No rows.</p>"
    keys = list(rows[0].keys())
    head = "".join(f"<th>{html.escape(str(k))}</th>" for k in keys)
    body = []
    for row in rows[:limit]:
        body.append(
            "<tr>"
            + "".join(f"<td>{html.escape(str(row.get(k, '')))}</td>" for k in keys)
            + "</tr>"
        )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def html_shell(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  body {{ font-family: ui-monospace, monospace; background: #0d0d16; color: #ddd; padding: 24px; }}
  h1 {{ color: #88aaff; }}
  table {{ border-collapse: collapse; width: 100%; }}
  th, td {{ border: 1px solid #1e1e2c; padding: 4px 8px; }}
  th {{ background: #13131e; }}
</style>
</head>
<body>
{body}
</body>
</html>"""
