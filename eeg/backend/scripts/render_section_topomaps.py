#!/usr/bin/env python3
"""Render EEG band-power topomap panels for each section/state."""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.interpolate import Rbf


BANDS: list[tuple[str, int, int]] = [
    ("Delta", 1, 4),
    ("Theta", 4, 8),
    ("Alpha", 8, 12),
    ("Beta", 12, 25),
    ("High Beta", 25, 30),
    ("Gamma", 30, 40),
    ("High Gamma", 40, 50),
    ("Alpha 1", 8, 10),
    ("Alpha 2", 10, 12),
    ("Beta 1", 12, 15),
    ("Beta 2", 15, 18),
    ("Beta 3", 18, 25),
    ("Gamma 1", 30, 35),
    ("Gamma 2", 35, 40),
]

STATE_LABELS = {
    "EO_rest": "eo",
    "EO_serial7s": "eo_cog",
    "EC_rest": "ec",
    "EC_serial7s": "ec_cog",
}

CHANNEL_POSITIONS: dict[str, tuple[float, float]] = {
    "FP1-A1": (-0.45, 0.92),
    "FP2-A1": (0.45, 0.92),
    "F7-A1": (-0.90, 0.42),
    "F3-A1": (-0.45, 0.42),
    "Fz-A1": (0.0, 0.50),
    "F4-A1": (0.45, 0.42),
    "F8-A1": (0.90, 0.42),
    "T3-A1": (-1.00, 0.0),
    "C3-A1": (-0.45, 0.0),
    "Cz-A1": (0.0, 0.0),
    "C4-A1": (0.45, 0.0),
    "T4-A1": (1.00, 0.0),
    "T5-A1": (-0.82, -0.52),
    "P3-A1": (-0.45, -0.52),
    "Pz-A1": (0.0, -0.56),
    "P4-A1": (0.45, -0.52),
    "T6-A1": (0.82, -0.52),
    "O1-A1": (-0.34, -0.92),
    "O2-A1": (0.34, -0.92),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("section_csv", type=Path, help="Section power CSV")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for PNG files")
    return parser.parse_args()


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def sum_band(row: dict[str, str], start_hz: int, end_hz: int) -> float:
    return sum(float(row[f"hz_{hz}"]) for hz in range(start_hz, end_hz + 1))


def build_section_data(rows: list[dict[str, str]]) -> dict[str, dict[str, dict[str, float]]]:
    sections: dict[str, dict[str, dict[str, float]]] = {}
    for row in rows:
        section = row["section_name"]
        channel = row["channel"]
        sections.setdefault(section, {})[channel] = {
            band_name: sum_band(row, lo, hi) for band_name, lo, hi in BANDS
        }
    return sections


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def jet_color(t: float) -> tuple[int, int, int]:
    stops = [
        (0.00, (0, 0, 180)),
        (0.18, (0, 120, 255)),
        (0.36, (0, 220, 220)),
        (0.54, (60, 220, 60)),
        (0.72, (255, 235, 0)),
        (0.88, (255, 120, 0)),
        (1.00, (220, 0, 0)),
    ]
    t = min(1.0, max(0.0, t))
    for index in range(len(stops) - 1):
        left_t, left_c = stops[index]
        right_t, right_c = stops[index + 1]
        if left_t <= t <= right_t:
            frac = 0.0 if right_t == left_t else (t - left_t) / (right_t - left_t)
            return tuple(int(round(lerp(left_c[i], right_c[i], frac))) for i in range(3))
    return stops[-1][1]


def safe_font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def text_height(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[3] - bbox[1]


def render_topomap(values: dict[str, float], band_name: str, size: int = 250) -> Image.Image:
    image = Image.new("RGB", (size, size + 48), "white")
    draw = ImageDraw.Draw(image)
    title_font = safe_font(16, bold=False)
    small_font = safe_font(13, bold=False)

    radius = 84
    cx = size // 2
    cy = 92

    grid_x = np.linspace(-1.05, 1.05, 180)
    grid_y = np.linspace(1.05, -1.05, 180)
    xx, yy = np.meshgrid(grid_x, grid_y)

    channels = [channel for channel in CHANNEL_POSITIONS if channel in values]
    xs = np.array([CHANNEL_POSITIONS[channel][0] for channel in channels], dtype=float)
    ys = np.array([CHANNEL_POSITIONS[channel][1] for channel in channels], dtype=float)
    zs = np.array([values[channel] for channel in channels], dtype=float)

    interpolator = Rbf(xs, ys, zs, function="multiquadric", smooth=0.05)
    zz = interpolator(xx, yy)
    mask = (xx ** 2 + yy ** 2) <= 1.0

    valid_values = zz[mask]
    vmin = float(np.min(valid_values))
    vmax = float(np.max(valid_values))
    if math.isclose(vmin, vmax):
        vmax = vmin + 1e-6

    for row in range(xx.shape[0]):
        for col in range(xx.shape[1]):
            if not mask[row, col]:
                continue
            t = (zz[row, col] - vmin) / (vmax - vmin)
            px = int(round(cx + xx[row, col] * radius))
            py = int(round(cy - yy[row, col] * radius))
            if 0 <= px < size and 0 <= py < size + 48:
                image.putpixel((px, py), jet_color(float(t)))

    head_fill = (245, 205, 205)
    outline = (30, 30, 30)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=outline, width=2)
    draw.ellipse((cx - radius - 11, cy - 18, cx - radius + 5, cy + 18), fill=head_fill, outline=outline, width=2)
    draw.ellipse((cx + radius - 5, cy - 18, cx + radius + 11, cy + 18), fill=head_fill, outline=outline, width=2)
    nose = [(cx - 12, cy - radius + 2), (cx, cy - radius - 18), (cx + 12, cy - radius + 2)]
    draw.polygon(nose, fill=head_fill, outline=outline)

    for channel in channels:
        px = int(round(cx + CHANNEL_POSITIONS[channel][0] * radius))
        py = int(round(cy - CHANNEL_POSITIONS[channel][1] * radius))
        draw.ellipse((px - 2, py - 2, px + 2, py + 2), fill=(245, 245, 245), outline=outline, width=1)

    title = band_name
    title_x = (size - text_width(draw, title, title_font)) // 2
    draw.text((title_x, 8), title, fill="black", font=title_font)

    bar_left = 40
    bar_top = size + 10
    bar_width = size - 80
    bar_height = 12
    for offset in range(bar_width):
        t = offset / max(1, bar_width - 1)
        color = jet_color(t)
        draw.line((bar_left + offset, bar_top, bar_left + offset, bar_top + bar_height), fill=color)
    draw.rectangle((bar_left, bar_top, bar_left + bar_width, bar_top + bar_height), outline=outline, width=1)

    ticks = [vmin, (vmin + vmax) / 2.0, vmax]
    tick_labels = [f"{value:.1f}" for value in ticks]
    tick_positions = [bar_left, bar_left + bar_width // 2, bar_left + bar_width]
    for position, label in zip(tick_positions, tick_labels):
        label_w = text_width(draw, label, small_font)
        draw.text((position - label_w // 2, bar_top + bar_height + 2), label, fill="black", font=small_font)

    return image


def paste_panel_grid(section_name: str, band_values: dict[str, dict[str, float]], output_path: Path) -> None:
    panel_width = 250
    panel_height = 298
    cols = 4
    rows = 4
    margin_x = 28
    margin_y = 28
    title_space = 78

    canvas_width = cols * panel_width + (cols + 1) * margin_x
    canvas_height = rows * panel_height + (rows + 1) * margin_y + title_space
    canvas = Image.new("RGB", (canvas_width, canvas_height), "white")
    draw = ImageDraw.Draw(canvas)

    header_font = safe_font(18, bold=False)
    title_font = safe_font(24, bold=True)
    sub_font = safe_font(15, bold=False)

    montage_text = "Montage: Discovery_19"
    draw.text((20, 14), montage_text, fill="black", font=header_font)

    state_text = STATE_LABELS.get(section_name, section_name.lower())
    main_title = f"FFT Absolute Power (uV Sq) - {state_text}"
    title_x = (canvas_width - text_width(draw, main_title, title_font)) // 2
    draw.text((title_x, 26), main_title, fill="black", font=title_font)

    units_text = "Bands: Delta, Theta, Alpha, Beta, High Beta, Gamma, High Gamma, Alpha1, Alpha2, Beta1, Beta2, Beta3, Gamma1, Gamma2"
    units_x = (canvas_width - text_width(draw, units_text, sub_font)) // 2
    draw.text((units_x, 56), units_text, fill=(60, 60, 60), font=sub_font)

    for index, (band_name, _, _) in enumerate(BANDS):
        row = index // cols
        col = index % cols
        x = margin_x + col * (panel_width + margin_x)
        y = title_space + margin_y + row * (panel_height + margin_y)
        panel = render_topomap(
            {channel: values[band_name] for channel, values in band_values.items()},
            band_name=band_name,
            size=panel_width,
        )
        canvas.paste(panel, (x, y))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)


def main() -> None:
    args = parse_args()
    rows = read_rows(args.section_csv)
    section_data = build_section_data(rows)

    for section_name, values in section_data.items():
        state_label = STATE_LABELS.get(section_name, section_name.lower())
        output_path = args.output_dir / f"{state_label}_absolute_power_topomaps.png"
        paste_panel_grid(section_name, values, output_path)
        print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
