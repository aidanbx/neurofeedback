#!/usr/bin/env python3
"""Export 1 Hz EEG power values per electrode from an EDF file.

The script reads an EDF file directly, extracts a configurable time window,
computes Welch PSD for each channel, then integrates the PSD into 1 Hz bins
centered on integer frequencies (1 Hz through 50 Hz by default).

Output is a wide CSV with one row per channel and one column per frequency.
Power units are physical-units squared, so for this EDF they are uV^2.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np

try:
    from scipy.signal import butter, filtfilt, iirnotch, sosfiltfilt, welch

    HAS_SCIPY = True
except ImportError:
    butter = filtfilt = iirnotch = sosfiltfilt = welch = None
    HAS_SCIPY = False

if hasattr(np, "trapezoid"):
    TRAPEZOID = np.trapezoid
else:
    TRAPEZOID = np.trapz


@dataclass(frozen=True)
class EdfSignalInfo:
    label: str
    physical_dimension: str
    physical_min: float
    physical_max: float
    digital_min: int
    digital_max: int
    samples_per_record: int


@dataclass(frozen=True)
class EdfHeader:
    path: Path
    num_records: int
    record_duration_sec: float
    num_signals: int
    signals: list[EdfSignalInfo]
    header_bytes: int

    @property
    def sample_rates(self) -> list[float]:
        return [signal.samples_per_record / self.record_duration_sec for signal in self.signals]

    @property
    def duration_sec(self) -> float:
        return self.num_records * self.record_duration_sec


def _decode_field(block: bytes, width: int, count: int) -> list[str]:
    return [
        block[index * width : (index + 1) * width].decode("latin-1").strip()
        for index in range(count)
    ]


def read_edf_header(path: Path) -> EdfHeader:
    with path.open("rb") as handle:
        fixed = handle.read(256)
        if len(fixed) != 256:
            raise ValueError(f"{path} is too small to be a valid EDF file.")

        try:
            header_bytes = int(fixed[184:192].decode("ascii").strip())
            num_records = int(fixed[236:244].decode("ascii").strip())
            record_duration_sec = float(fixed[244:252].decode("ascii").strip())
            num_signals = int(fixed[252:256].decode("ascii").strip())
        except ValueError as exc:
            raise ValueError(f"Unable to parse EDF header from {path}.") from exc

        signal_block = handle.read(header_bytes - 256)
        if len(signal_block) != header_bytes - 256:
            raise ValueError(f"{path} ended before the full EDF signal header could be read.")

    widths = [
        ("label", 16),
        ("transducer", 80),
        ("physical_dimension", 8),
        ("physical_min", 8),
        ("physical_max", 8),
        ("digital_min", 8),
        ("digital_max", 8),
        ("prefilter", 80),
        ("samples_per_record", 8),
        ("reserved", 32),
    ]

    parsed: dict[str, list[str]] = {}
    offset = 0
    for name, width in widths:
        parsed[name] = _decode_field(signal_block[offset : offset + width * num_signals], width, num_signals)
        offset += width * num_signals

    signals = [
        EdfSignalInfo(
            label=parsed["label"][index],
            physical_dimension=parsed["physical_dimension"][index],
            physical_min=float(parsed["physical_min"][index]),
            physical_max=float(parsed["physical_max"][index]),
            digital_min=int(parsed["digital_min"][index]),
            digital_max=int(parsed["digital_max"][index]),
            samples_per_record=int(parsed["samples_per_record"][index]),
        )
        for index in range(num_signals)
    ]

    return EdfHeader(
        path=path,
        num_records=num_records,
        record_duration_sec=record_duration_sec,
        num_signals=num_signals,
        signals=signals,
        header_bytes=header_bytes,
    )


def load_edf_window(header: EdfHeader, start_sec: float, duration_sec: float | None) -> tuple[np.ndarray, list[str], float]:
    sample_rates = header.sample_rates
    first_rate = sample_rates[0]
    if any(abs(rate - first_rate) > 1e-9 for rate in sample_rates[1:]):
        raise ValueError("This script currently expects the same sample rate on every EDF channel.")

    samples_per_record = header.signals[0].samples_per_record
    total_samples = header.num_records * samples_per_record
    total_duration = header.duration_sec

    if start_sec < 0:
        raise ValueError("--start-sec must be zero or greater.")
    if start_sec >= total_duration:
        raise ValueError(
            f"--start-sec ({start_sec}) is past the end of the recording ({total_duration:.2f} sec)."
        )

    end_sec = total_duration if duration_sec is None else min(total_duration, start_sec + duration_sec)
    if end_sec <= start_sec:
        raise ValueError("Requested window is empty. Increase --duration-sec or lower --start-sec.")

    start_sample = int(np.floor(start_sec * first_rate))
    end_sample = int(np.ceil(end_sec * first_rate))
    end_sample = min(end_sample, total_samples)

    raw = np.memmap(
        header.path,
        dtype="<i2",
        mode="r",
        offset=header.header_bytes,
        shape=(header.num_records, header.num_signals, samples_per_record),
    )

    digital = np.asarray(raw).transpose(1, 0, 2).reshape(header.num_signals, total_samples)
    windowed = digital[:, start_sample:end_sample].astype(np.float64, copy=False)

    scaled = np.empty_like(windowed, dtype=np.float64)
    for index, signal in enumerate(header.signals):
        digital_span = signal.digital_max - signal.digital_min
        physical_span = signal.physical_max - signal.physical_min
        if digital_span == 0:
            raise ValueError(f"Channel {signal.label} has invalid EDF calibration (digital span is zero).")
        scaled[index] = (
            (windowed[index] - signal.digital_min) * (physical_span / digital_span)
        ) + signal.physical_min

    labels = [signal.label for signal in header.signals]
    return scaled, labels, first_rate


def bandpass_filter(
    signal: np.ndarray,
    sample_rate: float,
    *,
    highpass_hz: float | None,
    lowpass_hz: float | None,
    notch_hz: float | None,
) -> np.ndarray:
    filtered = signal - np.mean(signal)

    if not HAS_SCIPY:
        return filtered

    if highpass_hz is not None and highpass_hz > 0:
        sos = butter(2, highpass_hz, btype="highpass", fs=sample_rate, output="sos")
        filtered = sosfiltfilt(sos, filtered)

    if lowpass_hz is not None and lowpass_hz > 0:
        if lowpass_hz >= sample_rate / 2:
            raise ValueError("--lowpass-hz must be below the Nyquist frequency.")
        sos = butter(4, lowpass_hz, btype="lowpass", fs=sample_rate, output="sos")
        filtered = sosfiltfilt(sos, filtered)

    if notch_hz is not None and 0 < notch_hz < sample_rate / 2:
        b, a = iirnotch(notch_hz, Q=30.0, fs=sample_rate)
        filtered = filtfilt(b, a, filtered)

    return filtered


def welch_numpy(
    signal: np.ndarray,
    sample_rate: float,
    segment_length: int,
    overlap: int,
) -> tuple[np.ndarray, np.ndarray]:
    step = max(1, segment_length - overlap)
    if len(signal) < segment_length:
        padded = np.zeros(segment_length, dtype=np.float64)
        padded[: len(signal)] = signal
        frames = padded[np.newaxis, :]
    else:
        starts = range(0, len(signal) - segment_length + 1, step)
        frames = np.stack([signal[start : start + segment_length] for start in starts], axis=0)

    window = np.hanning(segment_length)
    window_power = np.sum(window ** 2)
    detrended = frames - np.mean(frames, axis=1, keepdims=True)
    tapered = detrended * window
    fft_values = np.fft.rfft(tapered, axis=1)
    psd = (np.abs(fft_values) ** 2) / (sample_rate * window_power)
    if segment_length % 2 == 0:
        psd[:, 1:-1] *= 2.0
    else:
        psd[:, 1:] *= 2.0
    avg_psd = np.mean(psd, axis=0)
    freqs = np.fft.rfftfreq(segment_length, d=1.0 / sample_rate)
    return freqs, avg_psd


def compute_one_hz_bin_powers(
    signal: np.ndarray,
    sample_rate: float,
    min_hz: int,
    max_hz: int,
    nperseg: int | None,
) -> dict[int, float]:
    if len(signal) < 16:
        raise ValueError("Requested window is too short for PSD analysis.")

    segment_length = min(len(signal), nperseg or 1024)
    if segment_length < 16:
        raise ValueError("PSD segment length fell below 16 samples; increase the time window.")

    overlap = segment_length // 2
    if HAS_SCIPY:
        freqs, psd = welch(
            signal,
            fs=sample_rate,
            window="hann",
            nperseg=segment_length,
            noverlap=overlap,
            detrend="constant",
            scaling="density",
        )
    else:
        freqs, psd = welch_numpy(signal, sample_rate, segment_length, overlap)

    bin_powers: dict[int, float] = {}
    for hz in range(min_hz, max_hz + 1):
        lo = max(0.0, hz - 0.5)
        hi = hz + 0.5
        mask = (freqs >= lo) & (freqs <= hi)
        if np.count_nonzero(mask) < 2:
            bin_powers[hz] = 0.0
            continue
        bin_powers[hz] = float(TRAPEZOID(psd[mask], freqs[mask]))

    return bin_powers


def build_output_path(input_path: Path, output_path: Path | None, start_sec: float, end_sec: float) -> Path:
    if output_path is not None:
        return output_path
    stem = input_path.stem
    return input_path.with_name(f"{stem}_power_{int(start_sec)}s_to_{int(end_sec)}s.csv")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("edf_path", type=Path, help="Path to the EDF file to analyze.")
    parser.add_argument("--output", type=Path, help="Output CSV path.")
    parser.add_argument("--start-sec", type=float, default=0.0, help="Window start time in seconds.")
    parser.add_argument(
        "--duration-sec",
        type=float,
        default=None,
        help="Window duration in seconds. Omit to analyze from the start time to the end.",
    )
    parser.add_argument("--min-hz", type=int, default=1, help="Lowest 1 Hz bin to export.")
    parser.add_argument("--max-hz", type=int, default=50, help="Highest 1 Hz bin to export.")
    parser.add_argument(
        "--nperseg",
        type=int,
        default=1024,
        help="Welch segment length. Larger values increase frequency resolution when enough data exists.",
    )
    parser.add_argument(
        "--highpass-hz",
        type=float,
        default=0.3,
        help="Optional high-pass filter before PSD. Set to 0 to disable.",
    )
    parser.add_argument(
        "--lowpass-hz",
        type=float,
        default=None,
        help="Optional low-pass filter before PSD. Leave unset to keep frequencies up to the Nyquist limit.",
    )
    parser.add_argument(
        "--notch-hz",
        type=float,
        default=60.0,
        help="Optional notch filter frequency. Set to 0 to disable.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.min_hz < 0:
        raise ValueError("--min-hz must be zero or greater.")
    if args.max_hz < args.min_hz:
        raise ValueError("--max-hz must be greater than or equal to --min-hz.")
    if args.duration_sec is not None and args.duration_sec <= 0:
        raise ValueError("--duration-sec must be positive when provided.")

    header = read_edf_header(args.edf_path)
    samples, labels, sample_rate = load_edf_window(header, args.start_sec, args.duration_sec)
    actual_end_sec = args.start_sec + samples.shape[1] / sample_rate
    output_path = build_output_path(args.edf_path, args.output, args.start_sec, actual_end_sec)

    rows: list[dict[str, str | float]] = []
    for index, label in enumerate(labels):
        filtered = bandpass_filter(
            samples[index],
            sample_rate,
            highpass_hz=args.highpass_hz or None,
            lowpass_hz=args.lowpass_hz,
            notch_hz=args.notch_hz or None,
        )
        bin_powers = compute_one_hz_bin_powers(
            filtered,
            sample_rate=sample_rate,
            min_hz=args.min_hz,
            max_hz=args.max_hz,
            nperseg=args.nperseg,
        )
        row: dict[str, str | float] = {
            "channel": label,
            "units": f"{header.signals[index].physical_dimension}^2",
            "sample_rate_hz": sample_rate,
            "window_start_sec": args.start_sec,
            "window_end_sec": actual_end_sec,
            "window_duration_sec": samples.shape[1] / sample_rate,
        }
        for hz, power in bin_powers.items():
            row[f"hz_{hz}"] = power
        rows.append(row)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys())
    with output_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Analyzed EDF: {args.edf_path}")
    print(f"Channels: {len(labels)}")
    print(f"Sample rate: {sample_rate:.3f} Hz")
    print(f"Window: {args.start_sec:.3f}s to {actual_end_sec:.3f}s")
    if not HAS_SCIPY:
        print("Warning: scipy not available, so PSD used the NumPy Welch fallback and filters were skipped.")
    print(f"CSV written to: {output_path}")


if __name__ == "__main__":
    main()
