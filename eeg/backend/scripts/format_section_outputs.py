#!/usr/bin/env python3
"""Create rounded CSV and Markdown table summaries from section power data."""

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
    parser.add_argument("section_csv", type=Path, help="Input CSV from analyze_edf_sections.py")
    parser.add_argument("--section-output-base", type=Path, required=True)
    parser.add_argument("--broad-output-base", type=Path, required=True)
    parser.add_argument("--narrow-output-base", type=Path, required=True)
    return parser.parse_args()


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def ordered_sections(rows: list[dict[str, str]]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for row in rows:
        section_name = row["section_name"]
        if section_name not in seen:
            seen.add(section_name)
            result.append(section_name)
    return result


def round_str(value: float) -> str:
    return f"{value:.2f}"


def band_sum(row: dict[str, str], start_hz: int, end_hz: int) -> float:
    return sum(float(row[f"hz_{hz}"]) for hz in range(start_hz, end_hz + 1))


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def build_section_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    formatted_rows: list[dict[str, str]] = []
    hz_fields = [f"hz_{hz}" for hz in range(1, 51)]
    for row in rows:
        out = {
            "section_name": row["section_name"],
            "eyes_state": row["eyes_state"],
            "serial_7s": row["serial_7s"],
            "window_start_sec": round_str(float(row["window_start_sec"])),
            "window_end_sec": round_str(float(row["window_end_sec"])),
            "window_duration_sec": round_str(float(row["window_duration_sec"])),
            "channel": row["channel"],
            "units": row["units"],
            "sample_rate_hz": round_str(float(row["sample_rate_hz"])),
        }
        for field in hz_fields:
            out[field] = round_str(float(row[field]))
        formatted_rows.append(out)
    return formatted_rows


def build_band_rows(rows: list[dict[str, str]], bands: list[tuple[str, int, int]]) -> list[dict[str, str]]:
    formatted_rows: list[dict[str, str]] = []
    for row in rows:
        out = {
            "section_name": row["section_name"],
            "eyes_state": row["eyes_state"],
            "serial_7s": row["serial_7s"],
            "window_start_sec": round_str(float(row["window_start_sec"])),
            "window_end_sec": round_str(float(row["window_end_sec"])),
            "window_duration_sec": round_str(float(row["window_duration_sec"])),
            "channel": row["channel"],
            "units": row["units"],
        }
        for band_name, start_hz, end_hz in bands:
            out[band_name.lower().replace(" ", "_")] = round_str(band_sum(row, start_hz, end_hz))
        formatted_rows.append(out)
    return formatted_rows


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    header_line = "| " + " | ".join(headers) + " |"
    divider_line = "| " + " | ".join(["---"] * len(headers)) + " |"
    row_lines = ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join([header_line, divider_line, *row_lines])


def build_section_markdown(rows: list[dict[str, str]], source_csv: Path) -> str:
    lines = [
        "# EDF Section Power Summary",
        "",
        f"Source CSV: `{source_csv}`",
        "",
    ]

    headers = [
        "Channel",
        "1Hz",
        "2Hz",
        "3Hz",
        "4Hz",
        "5Hz",
        "6Hz",
        "7Hz",
        "8Hz",
        "9Hz",
        "10Hz",
        "11Hz",
        "12Hz",
        "13Hz",
        "14Hz",
        "15Hz",
        "16Hz",
        "17Hz",
        "18Hz",
        "19Hz",
        "20Hz",
        "21Hz",
        "22Hz",
        "23Hz",
        "24Hz",
        "25Hz",
        "26Hz",
        "27Hz",
        "28Hz",
        "29Hz",
        "30Hz",
        "31Hz",
        "32Hz",
        "33Hz",
        "34Hz",
        "35Hz",
        "36Hz",
        "37Hz",
        "38Hz",
        "39Hz",
        "40Hz",
        "41Hz",
        "42Hz",
        "43Hz",
        "44Hz",
        "45Hz",
        "46Hz",
        "47Hz",
        "48Hz",
        "49Hz",
        "50Hz",
    ]

    for section_name in ordered_sections(rows):
        section_rows = [row for row in rows if row["section_name"] == section_name]
        first = section_rows[0]
        lines.extend(
            [
                f"## {section_name}",
                "",
                f"- Eyes: `{first['eyes_state']}`",
                f"- Serial 7s: `{first['serial_7s']}`",
                f"- Window: `{first['window_start_sec']}` to `{first['window_end_sec']}` seconds",
                f"- Duration: `{first['window_duration_sec']}` seconds",
                "",
                markdown_table(
                    headers,
                    [
                        [row["channel"], *[row[f"hz_{hz}"] for hz in range(1, 51)]]
                        for row in section_rows
                    ],
                ),
                "",
            ]
        )
    return "\n".join(lines)


def build_band_markdown(
    rows: list[dict[str, str]],
    source_csv: Path,
    title: str,
    headers: list[str],
    section_columns: list[str],
) -> str:
    lines = [
        f"# {title}",
        "",
        f"Source CSV: `{source_csv}`",
        "",
    ]
    for section_name in ordered_sections(rows):
        section_rows = [row for row in rows if row["section_name"] == section_name]
        first = section_rows[0]
        lines.extend(
            [
                f"## {section_name}",
                "",
                f"- Eyes: `{first['eyes_state']}`",
                f"- Serial 7s: `{first['serial_7s']}`",
                f"- Window: `{first['window_start_sec']}` to `{first['window_end_sec']}` seconds",
                f"- Duration: `{first['window_duration_sec']}` seconds",
                "",
                markdown_table(
                    ["Channel", *headers],
                    [[row["channel"], *[row[column] for column in section_columns]] for row in section_rows],
                ),
                "",
            ]
        )
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    source_rows = read_rows(args.section_csv)

    section_rows = build_section_rows(source_rows)
    section_fields = list(section_rows[0].keys())
    section_csv_path = args.section_output_base.with_suffix(".csv")
    section_md_path = args.section_output_base.with_suffix(".md")
    write_csv(section_csv_path, section_rows, section_fields)
    section_md_path.write_text(build_section_markdown(section_rows, section_csv_path) + "\n")

    broad_rows = build_band_rows(source_rows, BROAD_BANDS)
    broad_fields = list(broad_rows[0].keys())
    broad_csv_path = args.broad_output_base.with_suffix(".csv")
    broad_md_path = args.broad_output_base.with_suffix(".md")
    write_csv(broad_csv_path, broad_rows, broad_fields)
    broad_md_path.write_text(
        build_band_markdown(
            broad_rows,
            broad_csv_path,
            "EDF Section Power Summary by Broad Bands",
            [band_name for band_name, _, _ in BROAD_BANDS],
            [band_name.lower().replace(" ", "_") for band_name, _, _ in BROAD_BANDS],
        )
        + "\n"
    )

    narrow_rows = build_band_rows(source_rows, NARROW_BANDS)
    narrow_fields = list(narrow_rows[0].keys())
    narrow_csv_path = args.narrow_output_base.with_suffix(".csv")
    narrow_md_path = args.narrow_output_base.with_suffix(".md")
    write_csv(narrow_csv_path, narrow_rows, narrow_fields)
    narrow_md_path.write_text(
        build_band_markdown(
            narrow_rows,
            narrow_csv_path,
            "EDF Section Power Summary by Narrow Bands",
            [band_name for band_name, _, _ in NARROW_BANDS],
            [band_name.lower().replace(" ", "_") for band_name, _, _ in NARROW_BANDS],
        )
        + "\n"
    )

    print(f"Wrote section CSV: {section_csv_path}")
    print(f"Wrote section Markdown: {section_md_path}")
    print(f"Wrote broad-band CSV: {broad_csv_path}")
    print(f"Wrote broad-band Markdown: {broad_md_path}")
    print(f"Wrote narrow-band CSV: {narrow_csv_path}")
    print(f"Wrote narrow-band Markdown: {narrow_md_path}")


if __name__ == "__main__":
    main()
