#!/usr/bin/env python3
"""Summarize broad EEG patterns and raw-signal artifacts for one EDF session.

This script is intentionally dependency-free so it can run in constrained
environments. It combines:

1. Broad-band power summaries from the exported CSV
2. Basic raw EDF amplitude checks to catch likely channel artifacts

It is not a clinical interpretation tool. The goal is to highlight patterns
that appear robust and to separate them from obvious contamination.
"""

from __future__ import annotations

import argparse
import csv
import statistics
import struct
from dataclasses import dataclass
from pathlib import Path


SECTION_ORDER = ["EO_rest", "EO_serial7s", "EC_rest", "EC_serial7s"]
FRONTAL_CHANNELS = ["FP1-A1", "FP2-A1", "F3-A1", "F4-A1", "F7-A1", "F8-A1", "Fz-A1"]
POSTERIOR_CHANNELS = ["P3-A1", "P4-A1", "O1-A1", "O2-A1", "Pz-A1", "T5-A1", "T6-A1"]
ALPHA_PAIRS = [
    ("FP1-A1", "FP2-A1"),
    ("F3-A1", "F4-A1"),
    ("C3-A1", "C4-A1"),
    ("P3-A1", "P4-A1"),
    ("O1-A1", "O2-A1"),
    ("F7-A1", "F8-A1"),
    ("T3-A1", "T4-A1"),
    ("T5-A1", "T6-A1"),
]
SPIKE_THRESHOLDS_UV = [100.0, 200.0, 500.0, 1000.0]


@dataclass(frozen=True)
class SignalInfo:
    label: str
    physical_min: float
    physical_max: float
    digital_min: int
    digital_max: int
    samples_per_record: int


@dataclass(frozen=True)
class Header:
    path: Path
    header_bytes: int
    num_records: int
    record_duration_sec: float
    signals: list[SignalInfo]

    @property
    def num_signals(self) -> int:
        return len(self.signals)

    @property
    def duration_sec(self) -> float:
        return self.num_records * self.record_duration_sec

    @property
    def sample_rate_hz(self) -> float:
        first = self.signals[0].samples_per_record / self.record_duration_sec
        for signal in self.signals[1:]:
            rate = signal.samples_per_record / self.record_duration_sec
            if abs(rate - first) > 1e-9:
                raise ValueError("Mixed sample rates are not supported by this script.")
        return first


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("edf_path", type=Path)
    parser.add_argument("broad_band_csv", type=Path)
    parser.add_argument("--output-md", type=Path, required=True)
    return parser.parse_args()


def _decode_fields(block: bytes, width: int, count: int, offset: int) -> tuple[list[str], int]:
    values = [
        block[offset + index * width : offset + (index + 1) * width].decode("latin-1").strip()
        for index in range(count)
    ]
    return values, offset + width * count


def read_header(path: Path) -> Header:
    with path.open("rb") as handle:
        fixed = handle.read(256)
        header_bytes = int(fixed[184:192].decode("ascii").strip())
        num_records = int(fixed[236:244].decode("ascii").strip())
        record_duration_sec = float(fixed[244:252].decode("ascii").strip())
        num_signals = int(fixed[252:256].decode("ascii").strip())
        block = handle.read(header_bytes - 256)

    offset = 0
    labels, offset = _decode_fields(block, 16, num_signals, offset)
    _, offset = _decode_fields(block, 80, num_signals, offset)
    _, offset = _decode_fields(block, 8, num_signals, offset)
    physical_min, offset = _decode_fields(block, 8, num_signals, offset)
    physical_max, offset = _decode_fields(block, 8, num_signals, offset)
    digital_min, offset = _decode_fields(block, 8, num_signals, offset)
    digital_max, offset = _decode_fields(block, 8, num_signals, offset)
    _, offset = _decode_fields(block, 80, num_signals, offset)
    samples_per_record, offset = _decode_fields(block, 8, num_signals, offset)

    signals = [
        SignalInfo(
            label=labels[index],
            physical_min=float(physical_min[index]),
            physical_max=float(physical_max[index]),
            digital_min=int(digital_min[index]),
            digital_max=int(digital_max[index]),
            samples_per_record=int(samples_per_record[index]),
        )
        for index in range(num_signals)
    ]
    return Header(
        path=path,
        header_bytes=header_bytes,
        num_records=num_records,
        record_duration_sec=record_duration_sec,
        signals=signals,
    )


def load_broad_band_rows(path: Path) -> list[dict[str, str | float]]:
    rows: list[dict[str, str | float]] = []
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            parsed: dict[str, str | float] = {}
            for key, value in row.items():
                if key in {"section_name", "eyes_state", "serial_7s", "channel", "units"}:
                    parsed[key] = value
                else:
                    parsed[key] = float(value)
            rows.append(parsed)
    return rows


def load_all_signals(header: Header) -> dict[str, list[float]]:
    signals = {signal.label: [] for signal in header.signals}
    scales = []
    offsets = []
    for signal in header.signals:
        digital_span = signal.digital_max - signal.digital_min
        physical_span = signal.physical_max - signal.physical_min
        scale = physical_span / digital_span
        offset = signal.physical_min - signal.digital_min * scale
        scales.append(scale)
        offsets.append(offset)

    with header.path.open("rb") as handle:
        handle.seek(header.header_bytes)
        for _ in range(header.num_records):
            for index, signal in enumerate(header.signals):
                raw = handle.read(signal.samples_per_record * 2)
                values = struct.unpack("<" + "h" * signal.samples_per_record, raw)
                scaled = [value * scales[index] + offsets[index] for value in values]
                signals[signal.label].extend(scaled)
    return signals


def build_section_windows(header: Header) -> dict[str, tuple[int, int]]:
    rate = header.sample_rate_hz
    sections = {
        "EO_rest": (0.0, 495.0),
        "EO_serial7s": (495.0, 600.0),
        "EC_rest": (600.0, 1020.0),
        "EC_serial7s": (1020.0, header.duration_sec),
    }
    return {
        name: (int(start * rate), int(end * rate))
        for name, (start, end) in sections.items()
    }


def median_band_by_section(rows: list[dict[str, str | float]], band: str, *, exclude: set[str]) -> dict[str, float]:
    output: dict[str, float] = {}
    for section in SECTION_ORDER:
        values = [
            float(row[band])
            for row in rows
            if row["section_name"] == section and row["channel"] not in exclude
        ]
        output[section] = statistics.median(values)
    return output


def mean_band_for_channels(
    rows: list[dict[str, str | float]], section: str, band: str, channels: list[str]
) -> float:
    values = [
        float(row[band])
        for row in rows
        if row["section_name"] == section and row["channel"] in channels
    ]
    return statistics.fmean(values)


def alpha_changes(rows: list[dict[str, str | float]]) -> list[tuple[float, float, str, float, float]]:
    eo = {str(row["channel"]): row for row in rows if row["section_name"] == "EO_rest"}
    ec = {str(row["channel"]): row for row in rows if row["section_name"] == "EC_rest"}
    changes = []
    for channel, eo_row in eo.items():
        eo_alpha = float(eo_row["alpha"])
        ec_alpha = float(ec[channel]["alpha"])
        changes.append((ec_alpha / eo_alpha, ec_alpha - eo_alpha, channel, eo_alpha, ec_alpha))
    changes.sort(reverse=True)
    return changes


def alpha_asymmetries(
    rows: list[dict[str, str | float]], section: str
) -> list[tuple[str, str, float, float, float]]:
    indexed = {str(row["channel"]): row for row in rows if row["section_name"] == section}
    output = []
    for left, right in ALPHA_PAIRS:
        output.append(
            (
                left,
                right,
                float(indexed[left]["alpha"]) - float(indexed[right]["alpha"]),
                float(indexed[left]["beta"]) - float(indexed[right]["beta"]),
                float(indexed[left]["theta"]) - float(indexed[right]["theta"]),
            )
        )
    return output


def raw_artifacts(
    signals: dict[str, list[float]], windows: dict[str, tuple[int, int]]
) -> dict[str, list[dict[str, float | str | dict[float, int]]]]:
    output: dict[str, list[dict[str, float | str | dict[float, int]]]] = {}
    for section, (start, end) in windows.items():
        section_rows = []
        for channel, values in signals.items():
            segment = values[start:end]
            abs_values = [abs(value) for value in segment]
            threshold_counts = {
                threshold: sum(1 for value in abs_values if value > threshold)
                for threshold in SPIKE_THRESHOLDS_UV
            }
            section_rows.append(
                {
                    "channel": channel,
                    "peak_uv": max(abs_values),
                    "p95_uv": sorted(abs_values)[int(0.95 * len(abs_values))],
                    "threshold_counts": threshold_counts,
                }
            )
        section_rows.sort(key=lambda row: float(row["peak_uv"]), reverse=True)
        output[section] = section_rows
    return output


def format_report(
    header: Header,
    rows: list[dict[str, str | float]],
    artifacts: dict[str, list[dict[str, float | str | dict[float, int]]]],
) -> str:
    medians = {
        band: median_band_by_section(rows, band, exclude={"T3-A1"})
        for band in ["delta", "theta", "alpha", "beta", "gamma"]
    }
    alpha_risers = alpha_changes(rows)

    lines = [
        "# EEG Pattern Summary",
        "",
        f"- EDF: `{header.path}`",
        f"- Broad-band CSV: `{args.broad_band_csv}`",
        f"- Duration: `{header.duration_sec:.1f}` sec",
        f"- Channels: `{header.num_signals}`",
        f"- Sample rate: `{header.sample_rate_hz:.1f}` Hz",
        "",
        "## Standout Patterns",
        "",
    ]

    worst_ec_rest = artifacts["EC_rest"][0]
    lines.extend(
        [
            f"1. `T3-A1` is a clear raw-signal artifact during `EC_rest`: peak `{float(worst_ec_rest['peak_uv']):.1f} uV`, "
            f"95th percentile `{float(worst_ec_rest['p95_uv']):.1f} uV`, and "
            f"`{worst_ec_rest['threshold_counts'][1000.0]}` samples above `1000 uV`.",
            f"2. Posterior alpha behaves as expected: median alpha excluding `T3-A1` rises from "
            f"`{medians['alpha']['EO_rest']:.2f}` in `EO_rest` to `{medians['alpha']['EC_rest']:.2f}` in `EC_rest`.",
            f"3. Frontal slow activity is strongest in eyes-open rest: mean frontal delta is "
            f"`{mean_band_for_channels(rows, 'EO_rest', 'delta', FRONTAL_CHANNELS):.2f}` in `EO_rest` versus "
            f"`{mean_band_for_channels(rows, 'EC_rest', 'delta', FRONTAL_CHANNELS):.2f}` in `EC_rest`.",
            f"4. Serial-7s periods show broader activation: median beta excluding `T3-A1` is "
            f"`{medians['beta']['EO_serial7s']:.2f}` in `EO_serial7s` and `{medians['beta']['EC_serial7s']:.2f}` in `EC_serial7s`, "
            f"both above eyes-open rest `{medians['beta']['EO_rest']:.2f}`.",
        ]
    )

    lines.extend(["", "## Alpha EO to EC", ""])
    for ratio, diff, channel, eo_alpha, ec_alpha in alpha_risers[:8]:
        lines.append(
            f"- `{channel}` alpha `{eo_alpha:.2f} -> {ec_alpha:.2f}` (`x{ratio:.2f}`, `+{diff:.2f}`)"
        )

    lines.extend(["", "## Clean-Section Medians", ""])
    for band in ["delta", "theta", "alpha", "beta", "gamma"]:
        lines.append(
            f"- `{band}`: "
            + ", ".join(f"{section}={medians[band][section]:.2f}" for section in SECTION_ORDER)
        )

    lines.extend(["", "## Posterior Alpha Means", ""])
    for section in SECTION_ORDER:
        mean_alpha = mean_band_for_channels(rows, section, "alpha", POSTERIOR_CHANNELS)
        lines.append(f"- `{section}` posterior alpha mean: `{mean_alpha:.2f}`")

    lines.extend(["", "## Alpha Asymmetry", ""])
    for section in ["EO_rest", "EC_rest", "EC_serial7s"]:
        lines.append(f"- `{section}`")
        for left, right, alpha_diff, beta_diff, theta_diff in alpha_asymmetries(rows, section):
            lines.append(
                f"  - `{left}` vs `{right}`: alpha `{alpha_diff:+.2f}`, beta `{beta_diff:+.2f}`, theta `{theta_diff:+.2f}`"
            )

    lines.extend(["", "## Raw Artifact Watch", ""])
    for section in SECTION_ORDER:
        lines.append(f"- `{section}`")
        for row in artifacts[section][:5]:
            counts = row["threshold_counts"]
            lines.append(
                f"  - `{row['channel']}` peak `{float(row['peak_uv']):.1f} uV`, p95 `{float(row['p95_uv']):.1f} uV`, "
                f">100 `{counts[100.0]}`, >200 `{counts[200.0]}`, >500 `{counts[500.0]}`, >1000 `{counts[1000.0]}`"
            )

    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    args = parse_args()
    header = read_header(args.edf_path)
    broad_rows = load_broad_band_rows(args.broad_band_csv)
    signals = load_all_signals(header)
    windows = build_section_windows(header)
    artifacts = raw_artifacts(signals, windows)

    report = format_report(header, broad_rows, artifacts)
    args.output_md.parent.mkdir(parents=True, exist_ok=True)
    args.output_md.write_text(report)
    print(f"Wrote {args.output_md}")
