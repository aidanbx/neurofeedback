"""Shared utilities for HTML report generation."""
from __future__ import annotations

import csv
import json
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
