#!/usr/bin/env python3
"""Aggregate EDF power by named session sections and export CSV + Markdown."""

from __future__ import annotations

import argparse
import csv
import importlib.util
import sys
from pathlib import Path


def _load_power_module(script_path: Path):
    spec = importlib.util.spec_from_file_location("analyze_edf_power", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("edf_path", type=Path, help="Path to the EDF file.")
    parser.add_argument("--output-csv", type=Path, required=True, help="Output CSV path.")
    parser.add_argument("--output-md", type=Path, required=True, help="Output Markdown path.")
    parser.add_argument("--min-hz", type=int, default=1)
    parser.add_argument("--max-hz", type=int, default=50)
    parser.add_argument("--nperseg", type=int, default=1024)
    parser.add_argument("--highpass-hz", type=float, default=0.3)
    parser.add_argument("--lowpass-hz", type=float, default=None)
    parser.add_argument("--notch-hz", type=float, default=60.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    power = _load_power_module(script_dir / "analyze_edf_power.py")

    header = power.read_edf_header(args.edf_path)
    total_duration_sec = header.duration_sec
    sections = [
        {
            "section_name": "EO_rest",
            "eyes_state": "eyes_open",
            "serial_7s": "no",
            "start_sec": 0.0,
            "end_sec": 8 * 60 + 15,
        },
        {
            "section_name": "EO_serial7s",
            "eyes_state": "eyes_open",
            "serial_7s": "yes",
            "start_sec": 8 * 60 + 15,
            "end_sec": 10 * 60,
        },
        {
            "section_name": "EC_rest",
            "eyes_state": "eyes_closed",
            "serial_7s": "no",
            "start_sec": 10 * 60,
            "end_sec": 17 * 60,
        },
        {
            "section_name": "EC_serial7s",
            "eyes_state": "eyes_closed",
            "serial_7s": "yes",
            "start_sec": 17 * 60,
            "end_sec": total_duration_sec,
        },
    ]

    rows: list[dict[str, str | float]] = []
    markdown_lines = [
        "# EDF Section Power Summary",
        "",
        f"- Source EDF: `{args.edf_path}`",
        f"- Total duration: `{total_duration_sec:.3f}` seconds",
        f"- Frequency bins: `{args.min_hz}` to `{args.max_hz}` Hz",
        "",
    ]

    for section in sections:
        duration_sec = section["end_sec"] - section["start_sec"]
        samples, labels, sample_rate = power.load_edf_window(
            header,
            section["start_sec"],
            duration_sec,
        )

        markdown_lines.extend(
            [
                f"- Section: `{section['section_name']}`",
                f"  - Eyes: `{section['eyes_state']}`",
                f"  - Serial 7s: `{section['serial_7s']}`",
                f"  - Time window: `{section['start_sec']:.3f}` to `{section['end_sec']:.3f}` seconds",
                f"  - Duration: `{duration_sec:.3f}` seconds",
            ]
        )

        for index, label in enumerate(labels):
            filtered = power.bandpass_filter(
                samples[index],
                sample_rate,
                highpass_hz=args.highpass_hz or None,
                lowpass_hz=args.lowpass_hz,
                notch_hz=args.notch_hz or None,
            )
            bin_powers = power.compute_one_hz_bin_powers(
                filtered,
                sample_rate=sample_rate,
                min_hz=args.min_hz,
                max_hz=args.max_hz,
                nperseg=args.nperseg,
            )

            row: dict[str, str | float] = {
                "section_name": section["section_name"],
                "eyes_state": section["eyes_state"],
                "serial_7s": section["serial_7s"],
                "window_start_sec": section["start_sec"],
                "window_end_sec": section["end_sec"],
                "window_duration_sec": duration_sec,
                "channel": label,
                "units": f"{header.signals[index].physical_dimension}^2",
                "sample_rate_hz": sample_rate,
            }
            for hz, value in bin_powers.items():
                row[f"hz_{hz}"] = value
            rows.append(row)

            freq_summary = ", ".join(
                f"{hz}Hz={bin_powers[hz]:.6f}" for hz in range(args.min_hz, args.max_hz + 1)
            )
            markdown_lines.extend(
                [
                    f"  - Channel: `{label}`",
                    f"    - Powers ({header.signals[index].physical_dimension}^2): {freq_summary}",
                ]
            )

        markdown_lines.append("")

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    args.output_md.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = list(rows[0].keys())
    with args.output_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    args.output_md.write_text("\n".join(markdown_lines) + "\n")

    print(f"Wrote CSV: {args.output_csv}")
    print(f"Wrote Markdown: {args.output_md}")
    print(f"Rows: {len(rows)}")


if __name__ == "__main__":
    main()
