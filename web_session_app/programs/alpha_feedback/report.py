#!/usr/bin/env python3
from __future__ import annotations

import base64
import csv
import io
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

BG = "#0d0d14"
PANEL = "#13131e"
FG = "#c4c4d4"
MUTED = "#55556a"
GOOD = "#44cc66"
FAIR = "#ddaa33"
POOR = "#cc4444"

COLORS = {
    "alpha": "#f0cc44",
    "theta": "#55bb88",
    "beta": "#e05050",
    "clarity": "#d9dde8",
}


def fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def style_ax(ax):
    ax.set_facecolor(PANEL)
    ax.tick_params(colors=MUTED, labelsize=8)
    for spine in ax.spines.values():
        spine.set_edgecolor("#252535")
    ax.xaxis.label.set_color(MUTED)
    ax.yaxis.label.set_color(MUTED)


def load_rows(path: Path):
    return list(csv.DictReader(path.open())) if path.exists() else []


def load_jsonl(path: Path):
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def load_session(session_dir: Path):
    input_rows = load_rows(session_dir / "program_input_trace.csv")
    output_rows = load_rows(session_dir / "program_output_trace.csv")
    meta = json.loads((session_dir / "metadata.json").read_text()) if (session_dir / "metadata.json").exists() else {}
    events = load_jsonl(session_dir / "session_events.jsonl")
    return input_rows, output_rows, meta, events


def f(row, key, default=0.0):
    v = row.get(key, default)
    return float(v) if v not in (None, "") else float(default)


def fig_thresholds(output_rows) -> str:
    rows = [r for r in output_rows if r.get("calibration_mode") == "rolling"] or output_rows
    t = np.array([f(r, "elapsed") for r in rows])
    alpha = np.array([f(r, "alpha_value") for r in rows])
    theta = np.array([f(r, "theta_value") for r in rows])
    beta = np.array([f(r, "beta_value") for r in rows])
    alpha_th = np.array([f(r, "alpha_threshold") for r in rows])
    theta_th = np.array([f(r, "theta_threshold") for r in rows])
    beta_th = np.array([f(r, "beta_threshold") for r in rows])

    fig, axes = plt.subplots(3, 1, figsize=(12, 7), facecolor=BG, sharex=True, gridspec_kw={"hspace": 0.28})
    series = [
        (axes[0], alpha, alpha_th, "Alpha reward", COLORS["alpha"]),
        (axes[1], theta, theta_th, "Theta inhibit", COLORS["theta"]),
        (axes[2], beta, beta_th, "Beta inhibit", COLORS["beta"]),
    ]
    for ax, values, thresholds, title, color in series:
        ax.plot(t, values, color=color, lw=1.8, label="feature")
        ax.plot(t, thresholds, color=color, lw=1.0, ls="--", alpha=0.9, label="threshold")
        ax.fill_between(t, values, thresholds, where=values >= thresholds, color=color, alpha=0.12)
        ax.set_ylabel("Program metric", color=FG, fontsize=8)
        ax.set_title(title, color=FG, fontsize=10, pad=6)
        ax.legend(loc="upper right", fontsize=7, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
        style_ax(ax)
    axes[-1].set_xlabel("Elapsed (s)", color=FG, fontsize=9)
    return fig_to_b64(fig)


def fig_clarity(output_rows) -> str:
    t = np.array([f(r, "elapsed") for r in output_rows])
    clarity = np.array([f(r, "clarity") for r in output_rows])
    theta_inhibit = np.array([f(r, "theta_inhibit") for r in output_rows])
    beta_inhibit = np.array([f(r, "beta_inhibit") for r in output_rows])
    warm = np.array([1.0 if r.get("calibration_mode") == "warm_start" else 0.0 for r in output_rows])

    fig, ax = plt.subplots(figsize=(12, 3.4), facecolor=BG)
    ax.plot(t, clarity, color=COLORS["clarity"], lw=2.0, label="clarity")
    ax.fill_between(t, clarity, color=COLORS["clarity"], alpha=0.16)
    ax.fill_between(t, 0, 1, where=theta_inhibit > 0, color=COLORS["theta"], alpha=0.10, label="theta inhibit")
    ax.fill_between(t, 0, 1, where=beta_inhibit > 0, color=COLORS["beta"], alpha=0.10, label="beta inhibit")
    ax.fill_between(t, 0, 1, where=warm > 0, color="#6f78aa", alpha=0.08, label="warm start")
    ax.set_ylim(0, 1)
    ax.set_ylabel("Clarity", color=FG, fontsize=9)
    ax.set_xlabel("Elapsed (s)", color=FG, fontsize=9)
    ax.legend(loc="upper right", fontsize=7, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
    style_ax(ax)
    return fig_to_b64(fig)


def compute_summary(input_rows, output_rows, meta, events):
    quality = np.array([f(r, "quality_score") for r in input_rows]) if input_rows else np.array([])
    duration = f(output_rows[-1], "elapsed") if output_rows else (f(input_rows[-1], "elapsed") if input_rows else 0.0)
    clarity = np.array([f(r, "clarity") for r in output_rows]) if output_rows else np.array([])
    reward = np.array([f(r, "reward_active") for r in output_rows]) if output_rows else np.array([])
    theta_inhibit = np.array([f(r, "theta_inhibit") for r in output_rows]) if output_rows else np.array([])
    beta_inhibit = np.array([f(r, "beta_inhibit") for r in output_rows]) if output_rows else np.array([])
    warm = np.array([1.0 if r.get("calibration_mode") == "warm_start" else 0.0 for r in output_rows]) if output_rows else np.array([])

    init = next((e for e in events if e.get("type") == "session_start"), {})
    settings = init.get("settings", {})
    return {
        "duration": f"{int(duration // 60)}:{int(duration % 60):02d}",
        "quality": f"{float(np.mean(quality)):.1f}" if quality.size else "0.0",
        "reward_target_pct": settings.get("reward_target_pct", 65),
        "theta_inhibit_pct": settings.get("theta_inhibit_pct", 15),
        "beta_inhibit_pct": settings.get("beta_inhibit_pct", 15),
        "calibration_window_sec": settings.get("calibration_window_sec", 180),
        "clarity_at_threshold_pct": settings.get("clarity_at_threshold_pct", 75),
        "reward_time_pct": f"{float(np.mean(reward) * 100):.1f}" if reward.size else "0.0",
        "theta_inhibit_time_pct": f"{float(np.mean(theta_inhibit) * 100):.1f}" if theta_inhibit.size else "0.0",
        "beta_inhibit_time_pct": f"{float(np.mean(beta_inhibit) * 100):.1f}" if beta_inhibit.size else "0.0",
        "avg_clarity_pct": f"{float(np.mean(clarity) * 100):.1f}" if clarity.size else "0.0",
        "warm_start_pct": f"{float(np.mean(warm) * 100):.1f}" if warm.size else "0.0",
        "base_track": settings.get("base_track", "-"),
        "clear_track": settings.get("clear_track", "-"),
        "device": meta.get("device_name", "?"),
    }


def html_page(summary, img_thresholds, img_clarity) -> str:
    q = float(summary["quality"])
    q_color = GOOD if q >= 70 else FAIR if q >= 55 else POOR
    stat_rows = [
        ("Duration", summary["duration"]),
        ("Quality", f'<span style="color:{q_color}">{summary["quality"]}</span>'),
        ("Reward target", f'{summary["reward_target_pct"]}%'),
        ("Theta inhibit target", f'{summary["theta_inhibit_pct"]}%'),
        ("Beta inhibit target", f'{summary["beta_inhibit_pct"]}%'),
        ("Rolling baseline", f'{summary["calibration_window_sec"]}s'),
        ("Clarity at threshold", f'{summary["clarity_at_threshold_pct"]}%'),
        ("Rewarded time", f'{summary["reward_time_pct"]}%'),
        ("Theta inhibited", f'{summary["theta_inhibit_time_pct"]}%'),
        ("Beta inhibited", f'{summary["beta_inhibit_time_pct"]}%'),
        ("Average clarity", f'{summary["avg_clarity_pct"]}%'),
        ("Warm start time", f'{summary["warm_start_pct"]}%'),
        ("Base track", summary["base_track"]),
        ("Clear track", summary["clear_track"]),
        ("Device", summary["device"]),
    ]
    stat_html = "".join(
        f'<tr><td style="color:{MUTED};padding:4px 12px 4px 0;white-space:nowrap">{k}</td>'
        f'<td style="padding:4px 0">{v}</td></tr>' for k, v in stat_rows
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Alpha Feedback Report</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: {BG}; color: {FG}; font-family: "SF Mono", "Fira Code", ui-monospace, monospace; font-size: 13px; padding: 20px; }}
  h1 {{ font-size: 16px; color: {FG}; margin-bottom: 16px; }}
  h2 {{ font-size: 12px; color: {MUTED}; text-transform: uppercase; letter-spacing: 0.1em; margin: 20px 0 8px; }}
  table {{ border-collapse: collapse; }}
  img {{ display: block; width: 100%; border-radius: 4px; }}
</style>
</head>
<body>
<h1>Alpha Feedback</h1>
<h2>Session Summary</h2>
<table>{stat_html}</table>
<h2>Features And Thresholds</h2>
<img src="data:image/png;base64,{img_thresholds}">
<h2>Clarity And Inhibits</h2>
<img src="data:image/png;base64,{img_clarity}">
</body>
</html>"""


def main():
    session_dir = Path(sys.argv[1])
    input_rows, output_rows, meta, events = load_session(session_dir)
    if not output_rows:
        (session_dir / "report.html").write_text("<html><body>No program_output_trace.csv found.</body></html>")
        return
    summary = compute_summary(input_rows, output_rows, meta, events)
    img_thresholds = fig_thresholds(output_rows)
    img_clarity = fig_clarity(output_rows)
    (session_dir / "report.html").write_text(html_page(summary, img_thresholds, img_clarity))
    print(f"Report written: {session_dir / 'report.html'}")


if __name__ == "__main__":
    main()
