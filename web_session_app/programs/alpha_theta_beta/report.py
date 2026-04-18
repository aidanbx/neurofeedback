#!/usr/bin/env python3
"""
Alpha-Theta Feedback session report.
Usage:  python report.py <session_dir>
Output: <session_dir>/report.html
"""
from __future__ import annotations

import base64, csv, io, json, sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np

# ── Colors ────────────────────────────────────────────────────────────────────

BG    = "#0d0d14"
PANEL = "#13131e"
FG    = "#c4c4d4"
MUTED = "#55556a"
GOOD  = "#44cc66"
FAIR  = "#ddaa33"
POOR  = "#cc4444"

BAND_COLORS = {
    "Alpha":   "#f0cc44",
    "Theta":   "#55bb88",
    "Beta":    "#e05050",
    "Hi-Beta": "#cc55dd",
}
ALPHA_DRIVE_COLOR = "#f0cc44"
THETA_DRIVE_COLOR = "#55bb88"

MODE_LABELS = {
    "relative_4_30": ("Relative Power", "Relative Power (%)", "{:.1f}%"),
    "log_absolute": ("Log Absolute Power", "Log Power", "{:.2f}"),
    "baseline_delta": ("Baseline-Adjusted Power", "Baseline delta", "{:.2f}"),
    "baseline_zscore": ("Baseline-Adjusted Power", "Baseline z-score", "{:.2f}"),
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()

def smooth(arr, w=5):
    if len(arr) < w:
        return arr
    return np.convolve(arr, np.ones(w) / w, mode="same")

def style_ax(ax):
    ax.set_facecolor(PANEL)
    ax.tick_params(colors=MUTED, labelsize=8)
    for s in ax.spines.values():
        s.set_edgecolor("#252535")
    ax.xaxis.label.set_color(MUTED)
    ax.yaxis.label.set_color(MUTED)

def shade_eyes(ax, rows, elapsed):
    # eye annotation removed from storage; no-op for new sessions
    pass

def metric_mode_for_session(rows, output_trace) -> str:
    if output_trace and output_trace[0].get("metric_mode"):
        return output_trace[0]["metric_mode"]
    if rows and rows[0].get("metric_mode"):
        return rows[0]["metric_mode"]
    return "relative_4_30"

def band_key(name: str) -> str:
    return name.lower().replace("-", "_")

def band_series(rows, name: str, mode: str) -> np.ndarray:
    key = band_key(name)
    if mode == "log_absolute":
        col = f"{key}_log_absolute"
    elif mode == "baseline_zscore":
        col = f"{key}_baseline_zscore"
    elif mode == "baseline_delta":
        col = f"{key}_baseline_delta"
    else:
        col = f"{name.lower()}_rel_pct"
        if col not in rows[0]:
            col = f"{key}_rel_pct"
    return np.array([float(r.get(col, 0) or 0) for r in rows], dtype=float)

def feature_col_for_mode(mode: str) -> str:
    if mode == "log_absolute":
        return "feature"
    if mode in ("baseline_delta", "baseline_zscore"):
        return "smoothed"
    return "rel"

# ── Load ──────────────────────────────────────────────────────────────────────

def load_session(session_dir: Path):
    rows = []
    for name in ("program_input_trace.csv", "derived_metrics.csv"):
        p = session_dir / name
        if p.exists():
            rows = list(csv.DictReader(p.open()))
            break
    meta_path = session_dir / "metadata.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    def _load_jsonl(path):
        events = []
        if path.exists():
            for line in path.read_text().splitlines():
                line = line.strip()
                if line:
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        return events

    events = _load_jsonl(session_dir / "session_events.jsonl")
    # backward compat: fall back to old name
    if not events:
        events = _load_jsonl(session_dir / "program_metrics.jsonl")

    output_trace = []
    ot_path = session_dir / "program_output_trace.csv"
    if ot_path.exists():
        output_trace = list(csv.DictReader(ot_path.open()))

    return rows, meta, events, output_trace

# ── Figures ───────────────────────────────────────────────────────────────────

def fig_band_timeline(rows, mode: str) -> str:
    elapsed = np.array([float(r["elapsed"]) for r in rows])
    quality = np.array([float(r["quality_score"]) for r in rows])
    _, y_label, _ = MODE_LABELS.get(mode, MODE_LABELS["baseline_delta"])

    fig = plt.figure(figsize=(12, 6), facecolor=BG)
    gs  = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[3, 1], hspace=0.32)
    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1])

    shade_eyes(ax1, rows, elapsed)
    for name, color in BAND_COLORS.items():
        data = band_series(rows, name, mode)
        ax1.plot(elapsed, data, color=color, alpha=0.15, lw=0.8)
        ax1.plot(elapsed, smooth(data), color=color, lw=1.8, label=name)

    if mode == "relative_4_30":
        ax1.set_ylim(0, 100)
    ax1.set_ylabel(y_label, color=FG, fontsize=9)
    ax1.legend(loc="upper right", fontsize=8, ncol=4,
               facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
    ax1.set_title(f"Band Power — {MODE_LABELS.get(mode, MODE_LABELS['baseline_delta'])[0]}", color=FG, fontsize=11, pad=8)
    style_ax(ax1)
    ax1.set_xticklabels([])

    shade_eyes(ax2, rows, elapsed)
    ax2.plot(elapsed, quality, color="#88bbff", lw=1.2)
    ax2.axhline(55, color=FAIR, lw=0.8, ls="--", alpha=0.6)
    ax2.axhline(70, color=GOOD, lw=0.8, ls="--", alpha=0.6)
    ax2.set_ylim(20, 100)
    ax2.set_ylabel("Quality", color=FG, fontsize=8)
    ax2.set_xlabel("Elapsed (s)", color=FG, fontsize=9)
    style_ax(ax2)
    return fig_to_b64(fig)


def fig_drive_timeline(output_trace, events, session_duration: float, mode: str) -> str:
    # output_trace rows come from program_output_trace.csv
    # fall back to old tick events in session_events.jsonl for backward compat
    if output_trace:
        ticks = output_trace
        get = lambda row, key, default=0: float(row.get(key, default) or default)
        t_arr    = np.array([get(r, "elapsed") for r in ticks])
        a_drive  = np.array([get(r, "alpha_drive") for r in ticks])
        th_drive = np.array([get(r, "theta_drive") for r in ticks])
        suffix = feature_col_for_mode(mode)
        if suffix == "smoothed":
          a_rel  = np.array([get(r, "alpha_smoothed") for r in ticks])
          th_rel = np.array([get(r, "theta_smoothed") for r in ticks])
        elif suffix == "feature":
          a_rel  = np.array([get(r, "alpha_feature") for r in ticks])
          th_rel = np.array([get(r, "theta_feature") for r in ticks])
        else:
          a_rel  = np.array([get(r, "alpha_rel") for r in ticks])
          th_rel = np.array([get(r, "theta_rel") for r in ticks])
    else:
        ticks = [e for e in events if e.get("type") == "tick"]
        if not ticks:
            return ""
        t_arr    = np.array([e["elapsed"] for e in ticks])
        a_drive  = np.array([e.get("alpha_drive", 0) for e in ticks])
        th_drive = np.array([e.get("theta_drive", 0) for e in ticks])
        a_rel    = np.array([e.get("alpha_rel", 0) for e in ticks])
        th_rel   = np.array([e.get("theta_rel", 0) for e in ticks])

    if not len(t_arr):
        return ""

    settings = [e for e in events if e.get("type") in ("setting", "setting_change")]

    fig, axes = plt.subplots(3, 1, figsize=(12, 7), facecolor=BG,
                             sharex=True, gridspec_kw={"hspace": 0.3, "height_ratios": [2, 2, 1]})
    ax_drive, ax_bands, ax_combined = axes

    # Alpha + Theta drives
    ax_drive.plot(t_arr, a_drive,  color=ALPHA_DRIVE_COLOR, lw=2.0, label="Alpha drive")
    ax_drive.fill_between(t_arr, a_drive, alpha=0.12, color=ALPHA_DRIVE_COLOR)
    ax_drive.plot(t_arr, th_drive, color=THETA_DRIVE_COLOR, lw=2.0, label="Theta drive")
    ax_drive.fill_between(t_arr, th_drive, alpha=0.10, color=THETA_DRIVE_COLOR)
    ax_drive.set_ylim(0, 1)
    ax_drive.set_ylabel("Drive (0=base → 1=clear)", color=FG, fontsize=9)
    ax_drive.set_title("Alpha + Theta Drive Timeline", color=FG, fontsize=11, pad=8)
    ax_drive.legend(loc="upper right", fontsize=8, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")

    # Annotate setting changes
    for ev in settings:
        ax_drive.axvline(ev["elapsed"], color=MUTED, lw=0.8, ls=":", alpha=0.7)
        label = f"{ev.get('key','?')}={ev.get('value','?')}"
        ax_drive.text(ev["elapsed"] + session_duration * 0.005, 0.92, label,
                      color=MUTED, fontsize=5.5, va="top", rotation=45)
    style_ax(ax_drive)

    # Alpha + Theta relative power
    ax_bands.plot(t_arr, a_rel,  color=ALPHA_DRIVE_COLOR, lw=1.6, label="Alpha rel %")
    ax_bands.plot(t_arr, th_rel, color=THETA_DRIVE_COLOR, lw=1.6, label="Theta rel %")
    ax_bands.fill_between(t_arr, a_rel,  alpha=0.10, color=ALPHA_DRIVE_COLOR)
    ax_bands.fill_between(t_arr, th_rel, alpha=0.08, color=THETA_DRIVE_COLOR)
    _, y_label, _ = MODE_LABELS.get(mode, MODE_LABELS["baseline_delta"])
    if mode == "relative_4_30":
        ax_bands.set_ylim(0, 100)
    ax_bands.set_ylabel(y_label, color=FG, fontsize=9)
    ax_bands.legend(loc="upper right", fontsize=8, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
    style_ax(ax_bands)

    # Combined drive (geometric mean)
    combined = np.sqrt(a_drive * th_drive)
    ax_combined.plot(t_arr, combined, color="#aaaaff", lw=1.5, label="Combined √(α·θ)")
    ax_combined.fill_between(t_arr, combined, alpha=0.15, color="#aaaaff")
    ax_combined.set_ylim(0, 1)
    ax_combined.set_ylabel("Combined", color=FG, fontsize=8)
    ax_combined.set_xlabel("Elapsed (s)", color=FG, fontsize=9)
    style_ax(ax_combined)

    return fig_to_b64(fig)


# ── Summary ───────────────────────────────────────────────────────────────────

def compute_summary(rows, meta, events, output_trace) -> dict:
    elapsed  = [float(r["elapsed"]) for r in rows]
    quality  = [float(r["quality_score"]) for r in rows]
    duration = elapsed[-1] if elapsed else 0

    # Use output_trace (program_output_trace.csv) if available; else fall back to tick events
    def _f(row, key):
        v = row.get(key, 0)
        return float(v) if v not in (None, "") else 0.0

    mode = metric_mode_for_session(rows, output_trace)
    _, _, value_fmt = MODE_LABELS.get(mode, MODE_LABELS["baseline_delta"])
    if output_trace:
        ticks = output_trace
        if mode == "relative_4_30":
            alpha_mean = float(np.mean([_f(r, "alpha_rel") for r in ticks])) if ticks else 0
            theta_mean = float(np.mean([_f(r, "theta_rel") for r in ticks])) if ticks else 0
        elif mode == "log_absolute":
            alpha_mean = float(np.mean([_f(r, "alpha_feature") for r in ticks])) if ticks else 0
            theta_mean = float(np.mean([_f(r, "theta_feature") for r in ticks])) if ticks else 0
        else:
            alpha_mean = float(np.mean([_f(r, "alpha_smoothed") for r in ticks])) if ticks else 0
            theta_mean = float(np.mean([_f(r, "theta_smoothed") for r in ticks])) if ticks else 0
        a_drv_mean  = float(np.mean([_f(r, "alpha_drive") for r in ticks])) if ticks else 0
        t_drv_mean  = float(np.mean([_f(r, "theta_drive") for r in ticks])) if ticks else 0
    else:
        ticks = [e for e in events if e.get("type") == "tick"]
        alpha_mean  = float(np.mean([e.get("alpha_rel",   0) for e in ticks])) if ticks else 0
        theta_mean  = float(np.mean([e.get("theta_rel",   0) for e in ticks])) if ticks else 0
        a_drv_mean  = float(np.mean([e.get("alpha_drive", 0) for e in ticks])) if ticks else 0
        t_drv_mean  = float(np.mean([e.get("theta_drive", 0) for e in ticks])) if ticks else 0

    q_mean = float(np.mean(quality)) if quality else 0

    # Settings from session_start event
    init = next((e for e in events if e.get("type") in ("session_start", "init")), {})
    settings = init.get("settings", {})

    session_id = meta.get("recording_id") or next(
        iter(meta.get("recording_started_at", "")[:16].replace(":", "").replace("-", "").replace("T", "_")), "?")

    return {
        "duration":         f"{int(duration // 60)}:{int(duration % 60):02d}",
        "n_windows":        len(ticks),
        "metric_mode":      mode,
        "quality":          f"{q_mean:.1f}",
        "alpha_mean":       value_fmt.format(alpha_mean),
        "theta_mean":       value_fmt.format(theta_mean),
        "alpha_drive_mean": f"{a_drv_mean * 100:.1f}%",
        "theta_drive_mean": f"{t_drv_mean * 100:.1f}%",
        "alpha_base_track": settings.get("alpha_base_track", "—"),
        "alpha_clear_track": settings.get("alpha_clear_track", "—"),
        "theta_base_track": settings.get("theta_base_track", "—"),
        "theta_clear_track": settings.get("theta_clear_track", "—"),
        "device":    meta.get("device_name", "?"),
        "session_id": session_id,
    }


# ── HTML ──────────────────────────────────────────────────────────────────────

def html_page(summary: dict, img_bands: str, img_drive: str) -> str:
    q_color = GOOD if float(summary["quality"]) >= 70 else FAIR if float(summary["quality"]) >= 55 else POOR

    stat_rows = [
        ("Duration",          summary["duration"]),
        ("Windows",           str(summary["n_windows"])),
        ("Quality",           f'<span style="color:{q_color}">{summary["quality"]}</span>'),
        ("Metric mode",       summary["metric_mode"]),
        ("Alpha (mean)",      summary["alpha_mean"]),
        ("Alpha drive (mean)", summary["alpha_drive_mean"]),
        ("Theta (mean)",      summary["theta_mean"]),
        ("Theta drive (mean)", summary["theta_drive_mean"]),
        ("Alpha base",        summary["alpha_base_track"]),
        ("Alpha clear",       summary["alpha_clear_track"]),
        ("Theta base",        summary["theta_base_track"]),
        ("Theta clear",       summary["theta_clear_track"]),
        ("Device",            summary["device"]),
    ]
    stat_html = "".join(
        f'<tr><td style="color:{MUTED};padding:4px 12px 4px 0;white-space:nowrap">{k}</td>'
        f'<td style="padding:4px 0">{v}</td></tr>'
        for k, v in stat_rows
    )

    drive_section = (
        f'<img src="data:image/png;base64,{img_drive}" style="width:100%;border-radius:4px;margin-top:16px">'
        if img_drive else ""
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Alpha-Theta Report — {summary["session_id"]}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: {BG}; color: {FG}; font-family: "SF Mono", "Fira Code", ui-monospace, monospace; font-size: 13px; padding: 20px; }}
  h1   {{ font-size: 16px; color: {FG}; margin-bottom: 16px; }}
  h2   {{ font-size: 12px; color: {MUTED}; text-transform: uppercase; letter-spacing: 0.1em; margin: 20px 0 8px; }}
  img  {{ display: block; }}
  table {{ border-collapse: collapse; }}
</style>
</head>
<body>
<h1>Alpha-Theta Feedback — {summary["session_id"]}</h1>
<h2>Session Summary</h2>
<table>{stat_html}</table>
<h2>Band Power</h2>
<img src="data:image/png;base64,{img_bands}" style="width:100%;border-radius:4px">
<h2>Drive Timeline</h2>
{drive_section}
</body>
</html>"""


# ── Entry point ───────────────────────────────────────────────────────────────

def default_report_sections(rows, meta) -> str:
    """Import and run key figures from default_report.py, return HTML fragment."""
    try:
        import importlib.util, types
        dr_path = Path(__file__).parent.parent / "default_report.py"
        spec = importlib.util.spec_from_file_location("default_report", dr_path)
        dr = types.ModuleType("default_report")
        spec.loader.exec_module(dr)

        imgs = []
        imgs.append(("Full Band Timeline", dr.fig_band_timeline(rows, meta)))
        imgs.append(("Eyes Open vs Closed", dr.fig_eyes_comparison(rows)))
        art = dr.fig_artifacts(rows)
        if art:
            imgs.append(("Artifacts & RMS", art))

        parts = []
        for title, img in imgs:
            parts.append(
                f'<h2 style="font-size:12px;color:{MUTED};text-transform:uppercase;'
                f'letter-spacing:0.1em;margin:20px 0 8px">{title}</h2>'
                f'<img src="data:image/png;base64,{img}" style="width:100%;border-radius:4px">'
            )
        return "\n".join(parts)
    except Exception as e:
        return f'<p style="color:{MUTED};font-size:11px">Default report unavailable: {e}</p>'


def _note_template(session_dir: Path, meta: dict) -> tuple[str, str]:
    """Return (filename, initial_content) for a new session note."""
    import re
    sid = session_dir.name
    base_id = re.sub(r"Favorite$", "", sid)
    m = re.match(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})", base_id)
    if m:
        from datetime import datetime as _dt
        year, mon, day, hour, minute = (int(x) for x in m.groups())
        ddd = _dt(year, mon, day).strftime("%a")
        yy = str(year)[2:]
        date_str = f"{yy}-{mon:02d}-{day:02d} {ddd}"
        time_str = f"{hour:02d}.{minute:02d}"
    else:
        date_str, time_str = sid, ""
    prog = meta.get("program") or meta.get("training_program")
    protocol = prog.get("title", "Session") if prog else "Session"
    safe_proto = re.sub(r'[/\\:*?"<>|]', "", protocol).strip()
    filename = f"{date_str} {time_str} {safe_proto}.md".strip()
    daily_link = f"[[{date_str}]]" if date_str else ""
    title = f"{protocol} — {date_str} {time_str}".strip(" —")
    content = f"{daily_link}\n\n# {title}\n\n## Notes\n\n"
    return filename, content


def main():
    session_dir = Path(sys.argv[1])
    rows, meta, events, output_trace = load_session(session_dir)

    if not rows:
        (session_dir / "report.html").write_text("<html><body>No derived_metrics.csv found.</body></html>")
        return

    summary   = compute_summary(rows, meta, events, output_trace)
    mode      = metric_mode_for_session(rows, output_trace)
    img_bands = fig_band_timeline(rows, mode)
    duration  = float(rows[-1]["elapsed"]) if rows else 0
    img_drive = fig_drive_timeline(output_trace, events, duration, mode)
    default_sections = default_report_sections(rows, meta)

    html = html_page(summary, img_bands, img_drive)
    html = html.replace("</body>\n</html>", default_sections + "\n</body>\n</html>")
    (session_dir / "report.html").write_text(html)
    print(f"Report written: {session_dir / 'report.html'}")

    # Compile note events into .md file if not already present
    note_events = [e for e in events if e.get("type") == "note"]
    if note_events and not list(session_dir.glob("*.md")):
        filename, content = _note_template(session_dir, meta)
        for note in note_events:
            elapsed = float(note.get("elapsed", 0))
            text = str(note.get("text", "")).strip()
            if text:
                m2, s = int(elapsed // 60), int(elapsed % 60)
                content += f"\n[{m2}:{s:02d}] {text}"
        (session_dir / filename).write_text(content.rstrip() + "\n", encoding="utf-8")
        print(f"Note compiled: {session_dir / filename}")


if __name__ == "__main__":
    main()
