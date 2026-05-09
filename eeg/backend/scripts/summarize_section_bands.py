#!/usr/bin/env python3
"""Create band-level markdown summaries from the section power CSV."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


BROAD_BANDS: list[tuple[str, int, int]] = [
    ("Delta", 1, 4),
    ("Theta", 4, 8),
    ("Alpha", 8, 12),
    ("Beta", 12, 25),
    ("High Beta", 25, 30),
    ("Gamma", 30, 40),
    ("High Gamma", 40, 50),
]

NARROW_BANDS: list[tuple[str, int, int]] = [
    ("Alpha 1", 8, 10),
    ("Alpha 2", 10, 12),
    ("Beta 1", 12, 15),
    ("Beta 2", 15, 18),
    ("Beta 3", 18, 25),
    ("Gamma 1", 30, 35),
    ("Gamma 2", 35, 40),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("section_csv", type=Path, help="Section power CSV from analyze_edf_sections.py")
    parser.add_argument("--short-output", type=Path, required=True, help="Broad-band markdown output path")
    parser.add_argument(
        "--medium-output",
        type=Path,
        required=True,
        help="Broad + narrow-band markdown output path",
    )
    return parser.parse_args()


def sum_band(row: dict[str, str], start_hz: int, end_hz: int) -> float:
    total = 0.0
    for hz in range(start_hz, end_hz + 1):
        total += float(row[f"hz_{hz}"])
    return total


def format_band_line(row: dict[str, str], bands: list[tuple[str, int, int]]) -> str:
    return ", ".join(
        f"{name}={sum_band(row, start_hz, end_hz):.6f}"
        for name, start_hz, end_hz in bands
    )


def build_markdown(
    rows: list[dict[str, str]],
    bands: list[tuple[str, int, int]],
    *,
    title: str,
) -> str:
    lines = [
        f"# {title}",
        "",
        f"- Source CSV: `{rows[0]['_source_csv']}`",
        "- Units: `uV^2` summed across each named frequency band",
        "",
    ]

    ordered_sections = []
    seen = set()
    for row in rows:
        key = row["section_name"]
        if key not in seen:
            seen.add(key)
            ordered_sections.append(key)

    for section_name in ordered_sections:
        section_rows = [row for row in rows if row["section_name"] == section_name]
        first = section_rows[0]
        lines.extend(
            [
                f"- Section: `{section_name}`",
                f"  - Eyes: `{first['eyes_state']}`",
                f"  - Serial 7s: `{first['serial_7s']}`",
                f"  - Time window: `{float(first['window_start_sec']):.3f}` to `{float(first['window_end_sec']):.3f}` seconds",
                f"  - Duration: `{float(first['window_duration_sec']):.3f}` seconds",
            ]
        )
        for row in section_rows:
            lines.extend(
                [
                    f"  - Channel: `{row['channel']}`",
                    f"    - Band powers: {format_band_line(row, bands)}",
                ]
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()

    with args.section_csv.open(newline="") as handle:
        rows = list(csv.DictReader(handle))

    if not rows:
        raise ValueError(f"No rows found in {args.section_csv}")

    for row in rows:
        row["_source_csv"] = str(args.section_csv)

    short_md = build_markdown(
        rows,
        BROAD_BANDS,
        title="EDF Section Power Summary by Broad Bands",
    )
    medium_md = build_markdown(
        rows,
        BROAD_BANDS + NARROW_BANDS,
        title="EDF Section Power Summary by Broad and Narrow Bands",
    )

    args.short_output.parent.mkdir(parents=True, exist_ok=True)
    args.medium_output.parent.mkdir(parents=True, exist_ok=True)
    args.short_output.write_text(short_md)
    args.medium_output.write_text(medium_md)

    print(f"Wrote short markdown: {args.short_output}")
    print(f"Wrote medium markdown: {args.medium_output}")


if __name__ == "__main__":
    main()
