#!/usr/bin/env python3
"""
Post-session analysis report.
Usage: python report.py <session_dir>
Outputs: <session_dir>/report.html  (self-contained, no external deps)
"""
from __future__ import annotations

import base64, csv, io, json, sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np
from scipy.signal import butter, sosfiltfilt

OUTPUT_NAME = "report.html"

BAND_COLORS = {
    "Delta": "#7777dd", "Theta": "#55bb88", "Alpha": "#f0cc44",
    "SMR": "#f08030", "Beta": "#e05050", "Hi-Beta": "#cc55dd",
}
BAND_NAMES = list(BAND_COLORS)
BG = "#0d0d14"; PANEL = "#13131e"; FG = "#c4c4d4"; MUTED = "#55556a"


def load_session(session_dir: Path):
    rows = []
    for name in ("program_input_trace.csv", "derived_metrics.csv"):
        p = session_dir / name
        if p.exists():
            rows = list(csv.DictReader(p.open()))
            break
    meta = json.loads((session_dir / "metadata.json").read_text())
    return rows, meta

def fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()

def smooth(arr, w=7):
    return np.convolve(arr, np.ones(w)/w, mode="same")

def shade_eyes(ax, rows, elapsed):
    # eye annotation removed from storage; no-op for new sessions
    pass

def style_ax(ax):
    ax.set_facecolor(PANEL)
    ax.tick_params(colors=MUTED, labelsize=8)
    for s in ax.spines.values(): s.set_edgecolor("#252535")
    ax.xaxis.label.set_color(MUTED); ax.yaxis.label.set_color(MUTED)


def fig_band_timeline(rows, meta) -> str:
    elapsed = np.array([float(r["elapsed"]) for r in rows])
    quality = np.array([float(r["quality_score"]) for r in rows])
    fig = plt.figure(figsize=(12, 7), facecolor=BG)
    gs = gridspec.GridSpec(3, 1, figure=fig, height_ratios=[3, 2, 1], hspace=0.35)
    ax1 = fig.add_subplot(gs[0]); ax2 = fig.add_subplot(gs[1]); ax3 = fig.add_subplot(gs[2])

    shade_eyes(ax1, rows, elapsed)
    for name in BAND_NAMES:
        col = f"{name.lower()}_rel_pct"
        if col not in rows[0]: col = f"{'hi-beta' if name=='Hi-Beta' else name.lower()}_rel_pct"
        data = np.array([float(r.get(col, 0)) for r in rows])
        ax1.plot(elapsed, data, color=BAND_COLORS[name], alpha=0.18, lw=0.8)
        ax1.plot(elapsed, smooth(data), color=BAND_COLORS[name], lw=1.8, label=name)
    ax1.set_ylim(0, 100); ax1.set_ylabel("Relative Power (%)", color=FG, fontsize=9)
    ax1.legend(loc="upper right", fontsize=7.5, ncol=3, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
    ax1.set_title(f"Band Power — {meta.get('recording_started_at','')[:19]}", color=FG, fontsize=11, pad=8)
    style_ax(ax1); ax1.set_xticklabels([])

    shade_eyes(ax2, rows, elapsed)
    for name in ["Delta", "Alpha", "Theta"]:
        col = f"{name.lower()}_rel_pct"
        data = np.array([float(r.get(col, 0)) for r in rows])
        ax2.plot(elapsed, smooth(data), color=BAND_COLORS[name], lw=2, label=name)
    ax2.set_ylim(0, 100); ax2.set_ylabel("Rel. Power (%)", color=FG, fontsize=9)
    ax2.legend(loc="upper right", fontsize=8, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
    ax2.set_title("Delta / Theta / Alpha", color=MUTED, fontsize=9, pad=4)
    style_ax(ax2); ax2.set_xticklabels([])

    shade_eyes(ax3, rows, elapsed)
    ax3.plot(elapsed, quality, color="#88bbff", lw=1.2)
    ax3.axhline(55, color="#ddaa33", lw=0.8, ls="--", alpha=0.7)
    ax3.axhline(70, color="#44cc66", lw=0.8, ls="--", alpha=0.6)
    ax3.set_ylim(20, 100); ax3.set_ylabel("Quality", color=FG, fontsize=8)
    ax3.set_xlabel("Elapsed (s)", color=FG, fontsize=9)
    style_ax(ax3)
    return fig_to_b64(fig)


def fig_eyes_comparison(rows) -> str:
    # eye state annotation removed from storage; nothing to plot for new sessions
    if not rows or "eyes" not in rows[0]:
        return ""
    by_state = {"open": {n: [] for n in BAND_NAMES}, "closed": {n: [] for n in BAND_NAMES}}
    for row in rows:
        state = row.get("eyes", "open")
        if state not in by_state: continue
        for name in BAND_NAMES:
            col = f"{name.lower()}_rel_pct"
            if col not in row: col = f"{'hi-beta' if name=='Hi-Beta' else name.lower()}_rel_pct"
            by_state[state][name].append(float(row.get(col, 0)))
    if not any(by_state["closed"].values()):
        return ""
    fig, ax = plt.subplots(figsize=(9, 4), facecolor=BG)
    x = np.arange(len(BAND_NAMES)); w = 0.35
    means_open   = [np.mean(by_state["open"][n])   if by_state["open"][n]   else 0 for n in BAND_NAMES]
    means_closed = [np.mean(by_state["closed"][n]) if by_state["closed"][n] else 0 for n in BAND_NAMES]
    ax.bar(x-w/2, means_open,   w, label=f"Eyes Open (n={len(by_state['open']['Alpha'])})",
           color=[BAND_COLORS[n]+"88" for n in BAND_NAMES], edgecolor="none")
    ax.bar(x+w/2, means_closed, w, label=f"Eyes Closed (n={len(by_state['closed']['Alpha'])})",
           color=[BAND_COLORS[n] for n in BAND_NAMES], edgecolor="none")
    if means_open[BAND_NAMES.index("Alpha")] > 0:
        ao = means_open[BAND_NAMES.index("Alpha")]; ac = means_closed[BAND_NAMES.index("Alpha")]
        pct = (ac - ao) / ao * 100
        ax.annotate(f"Alpha\n{pct:+.0f}%",
                    xy=(x[BAND_NAMES.index("Alpha")]+w/2, ac),
                    xytext=(x[BAND_NAMES.index("Alpha")]+w/2+0.5, ac+5),
                    color=BAND_COLORS["Alpha"], fontsize=9,
                    arrowprops=dict(arrowstyle="->", color=BAND_COLORS["Alpha"], lw=0.8))
    ax.set_xticks(x); ax.set_xticklabels(BAND_NAMES, color=FG, fontsize=9)
    ax.set_ylabel("Mean Relative Power (%)", color=FG, fontsize=9)
    ax.set_title("Eyes Open vs Closed — Band Power", color=FG, fontsize=11, pad=8)
    ax.legend(fontsize=8, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
    style_ax(ax); fig.patch.set_facecolor(BG)
    return fig_to_b64(fig)


def fig_artifacts(rows):
    if not rows or "artifact_fraction" not in rows[0]: return None
    if "rms_uv" not in rows[0]: return None
    elapsed  = np.array([float(r["elapsed"]) for r in rows])
    artifact = np.array([float(r["artifact_fraction"]) for r in rows])
    rms      = np.array([float(r["rms_uv"]) for r in rows])
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 4), facecolor=BG, sharex=True)
    shade_eyes(ax1, rows, elapsed)
    ax1.fill_between(elapsed, artifact*100, color="#cc4444", alpha=0.5)
    ax1.plot(elapsed, artifact*100, color="#cc4444", lw=1)
    ax1.set_ylim(0, 100); ax1.set_ylabel("Artifact %", color=FG, fontsize=8)
    ax1.set_title("Artifact Fraction & RMS", color=FG, fontsize=10, pad=6); style_ax(ax1)
    shade_eyes(ax2, rows, elapsed)
    ax2.plot(elapsed, rms, color="#88bbff", lw=1)
    ax2.set_ylabel("RMS (µV)", color=FG, fontsize=8); ax2.set_xlabel("Elapsed (s)", color=FG, fontsize=8)
    style_ax(ax2); plt.tight_layout()
    return fig_to_b64(fig)


def fig_training_timeline(meta: dict):
    timeline = meta.get("training_timeline") or []
    if not timeline:
        return None

    elapsed = np.array([float(p.get("elapsedSec", 0)) for p in timeline])
    combined = np.array([float(p.get("combinedPct", 0)) for p in timeline])
    reward_pct = np.array([float(p.get("rewardPct", 0)) for p in timeline])
    quality_pct = np.array([float(p.get("qualityPct", 0)) for p in timeline])
    inhibit_pcts = list(zip(*[p.get("inhibitPcts", []) for p in timeline])) if timeline[0].get("inhibitPcts") else []
    gate = np.array([100.0 if p.get("gateActive") else 0.0 for p in timeline])

    fig = plt.figure(figsize=(12, 6), facecolor=BG)
    gs = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[2, 1], hspace=0.28)
    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1], sharex=ax1)

    ax1.plot(elapsed, combined, color="#44cc66", lw=2.1, label="Combined reward state")
    ax1.plot(elapsed, reward_pct, color=BAND_COLORS["SMR"], lw=1.6, alpha=0.95, label="SMR in-range")
    for idx, series in enumerate(inhibit_pcts):
        name = "Theta" if idx == 0 else "Hi-Beta"
        ax1.plot(elapsed, np.array(series), color=BAND_COLORS.get(name, "#999"), lw=1.3, alpha=0.85, label=f"{name} in-range")
    ax1.plot(elapsed, quality_pct, color="#88bbff", lw=1.0, alpha=0.7, label="Quality")
    ax1.set_ylim(0, 100)
    ax1.set_ylabel("Percent (%)", color=FG, fontsize=9)
    ax1.set_title("Adaptive Neurofeedback Timeline", color=FG, fontsize=11, pad=8)
    ax1.legend(loc="upper right", fontsize=7.5, ncol=3, facecolor="#1a1a28", edgecolor="#333", labelcolor="white")
    style_ax(ax1)
    ax1.set_xticklabels([])

    ax2.fill_between(elapsed, gate, color="#44cc66", alpha=0.28, step="mid")
    ax2.plot(elapsed, gate, color="#44cc66", lw=1.3, alpha=0.9)
    ax2.set_ylim(0, 105)
    ax2.set_yticks([0, 100])
    ax2.set_yticklabels(["Off", "On"], color=MUTED, fontsize=8)
    ax2.set_xlabel("Elapsed (s)", color=FG, fontsize=9)
    ax2.set_title("Reward Output State", color=MUTED, fontsize=9, pad=4)
    style_ax(ax2)

    return fig_to_b64(fig)


def load_eeg_data(session_dir: Path, meta: dict):
    """Load, HP-filter, and return EEG waveform data as lists for JSON embedding."""
    raw_file = session_dir / "raw_eeg.csv"
    if not raw_file.exists():
        return None

    ch_col = f"ch{meta.get('channel_visualized', 1)}_raw_uv"
    DECIMATE = 5  # 250Hz -> 50Hz
    SRATE_D = 50.0

    elapsed_raw, signal_raw = [], []
    with raw_file.open() as f:
        for i, row in enumerate(csv.DictReader(f)):
            if i % DECIMATE != 0: continue
            elapsed_raw.append(float(row["elapsed"]))
            signal_raw.append(float(row.get(ch_col, 0)))

    elapsed = np.array(elapsed_raw)
    signal  = np.array(signal_raw, dtype=float)

    # HP filter 0.5Hz to remove DC drift — always applied for display
    sos = butter(2, 0.5, btype="high", fs=SRATE_D, output="sos")
    signal = sosfiltfilt(sos, signal)

    # Soft clip
    iqr = float(np.percentile(np.abs(signal), 75))
    clip = max(200.0, iqr * 6)
    signal = np.clip(signal, -clip, clip)

    return {
        "elapsed":      [round(float(v), 3) for v in elapsed],
        "signal":       [round(float(v), 2) for v in signal],
        "eye_spans":    [],
        "clench_spans": [],
        "blink_times":  [],
        "reward_spans": [],
        "track_events": [],
        "duration":     float(elapsed[-1]),
    }


def load_band_data(rows, meta=None):
    """Return band timeline data as lists for JSON embedding."""
    elapsed = [float(r["elapsed"]) for r in rows]
    bands = {}
    for name in BAND_NAMES:
        col = f"{name.lower()}_rel_pct"
        if col not in rows[0]: col = f"{'hi-beta' if name=='Hi-Beta' else name.lower()}_rel_pct"
        bands[name] = [round(float(r.get(col, 0)), 2) for r in rows]
    quality = [round(float(r["quality_score"]), 1) for r in rows]
    # Absolute band power (µV²)
    abs_bands = {}
    for name in BAND_NAMES:
        col = f"{name.lower().replace('-', '-')}_abs_uv2"
        abs_bands[name] = [round(float(r.get(col, 0)), 4) for r in rows]
    return {"elapsed": elapsed, "bands": bands, "abs_bands": abs_bands,
            "quality": quality, "eye_spans": [],
            "clench_spans": [], "reward_spans": []}


def compute_summary(rows, meta) -> dict:
    elapsed = [float(r["elapsed"]) for r in rows]
    quality = [float(r["quality_score"]) for r in rows]
    duration = elapsed[-1] if elapsed else 0
    alpha_all = [float(r.get("alpha_rel_pct", 0)) for r in rows]
    alpha_mean = float(np.mean(alpha_all)) if alpha_all else 0
    return {
        "duration": f"{int(duration//60)}:{int(duration%60):02d}",
        "samples": len(rows),
        "quality_mean": f"{np.mean(quality):.1f}",
        "quality_label": "good" if np.mean(quality) >= 70 else "fair" if np.mean(quality) >= 55 else "poor",
        "alpha_mean": f"{alpha_mean:.1f}%",
        "device": meta.get("device_name", "?"),
        "channel": meta.get("channel_visualized", "?"),
    }


# ── HTML ──────────────────────────────────────────────────────────────────

INTERACTIVE_SECTION = """\
<div class="panel" id="wavePanel">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
    <span class="panel-title">EEG Waveform (full session, HP-filtered)</span>
    <button id="recenterBtn" onclick="toggleRecenter()" style="font-size:10px;padding:2px 8px;background:#1a1a28;border:1px solid #3a3a55;border-radius:3px;color:#c4c4d4;cursor:pointer">Recenter: On</button>
    <span style="font-size:10px;color:#55556a;margin-left:auto">drag sliders to zoom</span>
  </div>
  <canvas id="waveCanvas" style="width:100%;height:160px;display:block;background:#13131e;border-radius:3px"></canvas>
  <div style="position:relative;height:22px;margin-top:4px">
    <input type="range" id="sliderA" min="0" max="1000" value="0"
      style="position:absolute;width:100%;pointer-events:none;appearance:none;-webkit-appearance:none;height:4px;background:transparent;outline:none">
    <input type="range" id="sliderB" min="0" max="1000" value="1000"
      style="position:absolute;width:100%;pointer-events:none;appearance:none;-webkit-appearance:none;height:4px;background:transparent;outline:none">
    <div id="sliderTrack" style="position:absolute;top:9px;left:0;right:0;height:4px;background:#1e1e2e;border-radius:2px;pointer-events:none"></div>
    <div id="sliderRange" style="position:absolute;top:9px;height:4px;background:#5577ee;border-radius:2px;pointer-events:none"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:10px;color:#55556a;margin-top:2px">
    <span id="tStart">0.0s</span><span id="tEnd">0.0s</span>
  </div>
</div>

<div class="panel" id="bandPanel">
  <span class="panel-title">Relative Band Power (1-30 Hz)</span>
  <canvas id="bandCanvas" style="width:100%;height:180px;display:block;background:#13131e;border-radius:3px;margin-top:6px"></canvas>
</div>

<div class="panel" id="absBandPanel">
  <span class="panel-title">Absolute Band Power (µV²)</span>
  <canvas id="absCanvas" style="width:100%;height:180px;display:block;background:#13131e;border-radius:3px;margin-top:6px"></canvas>
</div>

<style>
  input[type=range]::-webkit-slider-thumb {{
    -webkit-appearance:none; appearance:none;
    width:14px; height:14px; border-radius:50%;
    background:#5577ee; cursor:pointer; pointer-events:all;
    border:2px solid #0d0d14;
  }}
  input[type=range]::-moz-range-thumb {{
    width:14px; height:14px; border-radius:50%;
    background:#5577ee; cursor:pointer; pointer-events:all;
    border:2px solid #0d0d14;
  }}
</style>

<script>
(function(){{
  const EEG  = {eeg_json};
  const BAND = {band_json};
  const BAND_COLORS = {{"Delta":"#7777dd","Theta":"#55bb88","Alpha":"#f0cc44","SMR":"#f08030","Beta":"#e05050","Hi-Beta":"#cc55dd"}};
  const BAND_NAMES  = ["Delta","Theta","Alpha","SMR","Beta","Hi-Beta"];

  // ── Shared helpers for reward/track overlays ──────────────────────────
  function drawRewardSpans(ctx, spans, timeToX, H, tMin, tMax) {{
    ctx.save();
    ctx.fillStyle = "rgba(68,204,102,0.10)";
    for (const [s, e] of spans) {{
      if (e < tMin || s > tMax) continue;
      const xs = timeToX(Math.max(s, tMin));
      const xe = timeToX(Math.min(e, tMax));
      ctx.fillRect(xs, 0, Math.max(2, xe - xs), H);
    }}
    ctx.restore();
  }}

  function drawTrackMarkers(ctx, events, timeToX, H, tMin, tMax) {{
    for (const te of events) {{
      if (te.elapsed < tMin || te.elapsed > tMax) continue;
      const tx = timeToX(te.elapsed);
      ctx.save();
      ctx.strokeStyle = "#cc55dd"; ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, H); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "#cc55dd"; ctx.font = "9px monospace"; ctx.globalAlpha = 0.9;
      ctx.fillText("♪ " + te.name, tx + 3, 11);
      ctx.restore();
    }}
  }}

  function drawClenchSpans(ctx, spans, timeToX, H, tMin, tMax) {{
    ctx.save();
    ctx.fillStyle = "rgba(220,80,80,0.14)";
    for (const [s, e] of (spans || [])) {{
      if (e < tMin || s > tMax) continue;
      const xs = timeToX(Math.max(s, tMin));
      const xe = timeToX(Math.min(e, tMax));
      ctx.fillRect(xs, 0, Math.max(2, xe - xs), H);
    }}
    ctx.restore();
  }}

  let vStart = 0, vEnd = EEG.duration, doRecenter = true;

  const slA = document.getElementById("sliderA");
  const slB = document.getElementById("sliderB");
  const rng = document.getElementById("sliderRange");

  function updateSliderUI() {{
    const a = Math.min(slA.valueAsNumber, slB.valueAsNumber);
    const b = Math.max(slA.valueAsNumber, slB.valueAsNumber);
    const pA = a / 1000 * 100, pB = b / 1000 * 100;
    rng.style.left  = pA + "%";
    rng.style.width = (pB - pA) + "%";
    vStart = a / 1000 * EEG.duration;
    vEnd   = b / 1000 * EEG.duration;
    document.getElementById("tStart").textContent = vStart.toFixed(1) + "s";
    document.getElementById("tEnd").textContent   = vEnd.toFixed(1) + "s";
    drawWave(); drawBands(); drawBandsAbs();
  }}

  slA.addEventListener("input", updateSliderUI);
  slB.addEventListener("input", updateSliderUI);

  function toggleRecenter() {{
    doRecenter = !doRecenter;
    document.getElementById("recenterBtn").textContent = "Recenter: " + (doRecenter ? "On" : "Off");
    drawWave();
  }}
  window.toggleRecenter = toggleRecenter;

  // ── EEG canvas ───────────────────────────────────────────────────────
  function drawWave() {{
    const canvas = document.getElementById("waveCanvas");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#13131e"; ctx.fillRect(0, 0, W, H);

    const el = EEG.elapsed, sig = EEG.signal;
    const i0 = el.findIndex(t => t >= vStart);
    const i1 = (() => {{ for (let i=el.length-1;i>=0;i--) if (el[i]<=vEnd) return i; return el.length-1; }})();
    if (i1 <= i0) return;

    const slice = sig.slice(i0, i1+1);
    let offset = 0;
    if (doRecenter) {{
      const sorted = [...slice].sort((a,b)=>a-b);
      offset = sorted[Math.floor(sorted.length/2)];
    }}
    const centered = slice.map(v => v - offset);
    const absMax = Math.max(...centered.map(Math.abs), 1);
    const pad = 12;
    const tMin = el[i0], tMax = el[i1], tSpan = Math.max(1e-9, tMax - tMin);

    function toX(i) {{ return pad + (i / (slice.length-1)) * (W - 2*pad); }}
    function timeToX(t) {{ return pad + ((t - tMin) / tSpan) * (W - 2*pad); }}
    function toY(v) {{ return H/2 - (v / absMax) * (H/2 - pad); }}

    // Eye-close spans — use time-based x so positions are correct at any zoom level
    ctx.save();
    for (const [s, e] of EEG.eye_spans) {{
      if (e < tMin || s > tMax) continue;
      const xs = timeToX(Math.max(s, tMin));
      const xe = timeToX(Math.min(e, tMax));
      ctx.fillStyle = "rgba(70,130,180,0.13)";
      ctx.fillRect(xs, 0, Math.max(2, xe - xs), H);
    }}
    ctx.restore();

    // Reward gate spans (green) and track change markers
    drawRewardSpans(ctx, EEG.reward_spans || [], timeToX, H, tMin, tMax);
    drawTrackMarkers(ctx, EEG.track_events || [], timeToX, H, tMin, tMax);
    drawClenchSpans(ctx, EEG.clench_spans || [], timeToX, H, tMin, tMax);

    // Blink markers
    for (const bt of EEG.blink_times) {{
      if (bt < tMin || bt > tMax) continue;
      const bx = timeToX(bt);
      ctx.save();
      ctx.strokeStyle = "#f0cc44"; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, H); ctx.stroke();
      ctx.restore();
    }}

    // Zero line
    ctx.save(); ctx.strokeStyle = "#55556a"; ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 4]); ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(pad, H/2); ctx.lineTo(W-pad, H/2); ctx.stroke();
    ctx.restore();

    // Signal
    ctx.beginPath(); ctx.strokeStyle = "#4488ff"; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
    for (let i = 0; i < slice.length; i++) {{
      const x = toX(i), y = toY(centered[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }}
    ctx.stroke();

    // Y labels
    ctx.save(); ctx.fillStyle = "#55556a"; ctx.font = "9px monospace"; ctx.globalAlpha = 1;
    ctx.fillText("+" + Math.round(absMax) + "µV", 2, pad + 8);
    ctx.fillText("-" + Math.round(absMax) + "µV", 2, H - 4);
    ctx.restore();
  }}

  // ── Band canvas ───────────────────────────────────────────────────────
  function drawBands() {{
    const canvas = document.getElementById("bandCanvas");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#13131e"; ctx.fillRect(0, 0, W, H);

    const el = BAND.elapsed;
    const i0 = el.findIndex(t => t >= vStart);
    const i1 = (() => {{ for (let i=el.length-1;i>=0;i--) if (el[i]<=vEnd) return i; return el.length-1; }})();
    if (i1 <= i0) return;
    const pad = 12, n = i1 - i0 + 1;
    const tMin = el[i0], tMax = el[i1], tSpan = Math.max(1e-9, tMax - tMin);

    function toX(i) {{ return pad + (i/(n-1))*(W-2*pad); }}
    function timeToX(t) {{ return pad + ((t - tMin) / tSpan) * (W - 2*pad); }}
    function toY(v) {{ return H - pad - (v/100)*(H-2*pad); }}

    // Eye spans — time-based x so they track correctly at any zoom
    for (const [s, e] of BAND.eye_spans) {{
      if (e < tMin || s > tMax) continue;
      const xs = timeToX(Math.max(s, tMin));
      const xe = timeToX(Math.min(e, tMax));
      ctx.fillStyle = "rgba(70,130,180,0.10)";
      ctx.fillRect(xs, 0, Math.max(2, xe - xs), H);
    }}

    // Reward gate spans, track change markers, clench spans
    drawRewardSpans(ctx, BAND.reward_spans || [], timeToX, H, tMin, tMax);
    drawTrackMarkers(ctx, EEG.track_events || [], timeToX, H, tMin, tMax);
    drawClenchSpans(ctx, BAND.clench_spans || [], timeToX, H, tMin, tMax);

    // Gridline at 50%
    ctx.save(); ctx.strokeStyle = "#252535"; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(pad, toY(50)); ctx.lineTo(W-pad, toY(50)); ctx.stroke();
    ctx.restore();

    // Bands
    for (const name of BAND_NAMES) {{
      const slice = BAND.bands[name].slice(i0, i1+1);
      ctx.beginPath(); ctx.strokeStyle = BAND_COLORS[name]; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
      for (let i=0; i<slice.length; i++) {{
        const x = toX(i), y = toY(slice[i]);
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }}
      ctx.stroke();
    }}
    ctx.globalAlpha = 1;

    // Legend
    let lx = pad;
    for (const name of BAND_NAMES) {{
      ctx.fillStyle = BAND_COLORS[name]; ctx.font = "9px monospace";
      ctx.fillRect(lx, 3, 8, 8); lx += 10;
      ctx.fillText(name, lx, 11); lx += ctx.measureText(name).width + 10;
    }}
  }}

  // ── Absolute band power canvas ────────────────────────────────────────
  function drawBandsAbs() {{
    const canvas = document.getElementById("absCanvas");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#13131e"; ctx.fillRect(0, 0, W, H);

    const el = BAND.elapsed;
    const i0 = el.findIndex(t => t >= vStart);
    const i1 = (() => {{ for (let i=el.length-1;i>=0;i--) if (el[i]<=vEnd) return i; return el.length-1; }})();
    if (i1 <= i0) return;
    const pad = 12, n = i1 - i0 + 1;
    const tMin = el[i0], tMax = el[i1], tSpan = Math.max(1e-9, tMax - tMin);

    // Auto-scale y: find max abs value in view
    let yMax = 1e-9;
    for (const name of BAND_NAMES) {{
      const sl = (BAND.abs_bands || {{}})[name];
      if (!sl) continue;
      for (let i = i0; i <= i1; i++) yMax = Math.max(yMax, sl[i] || 0);
    }}
    yMax *= 1.1;

    function toX(i) {{ return pad + (i/(n-1))*(W-2*pad); }}
    function timeToX(t) {{ return pad + ((t - tMin) / tSpan) * (W - 2*pad); }}
    function toY(v) {{ return H - pad - (v/yMax)*(H-2*pad); }}

    // Spans
    for (const [s, e] of BAND.eye_spans) {{
      if (e < tMin || s > tMax) continue;
      ctx.fillStyle = "rgba(70,130,180,0.10)";
      ctx.fillRect(timeToX(Math.max(s,tMin)), 0, Math.max(2, timeToX(Math.min(e,tMax))-timeToX(Math.max(s,tMin))), H);
    }}
    drawRewardSpans(ctx, BAND.reward_spans || [], timeToX, H, tMin, tMax);
    drawClenchSpans(ctx, BAND.clench_spans || [], timeToX, H, tMin, tMax);

    // Gridline at halfway
    ctx.save(); ctx.strokeStyle = "#252535"; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(pad, toY(yMax/2)); ctx.lineTo(W-pad, toY(yMax/2)); ctx.stroke();
    ctx.restore();

    // Bands
    for (const name of BAND_NAMES) {{
      const sl = (BAND.abs_bands || {{}})[name];
      if (!sl) continue;
      const slice = sl.slice(i0, i1+1);
      ctx.beginPath(); ctx.strokeStyle = BAND_COLORS[name]; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
      for (let i=0; i<slice.length; i++) {{
        const x = toX(i), y = toY(slice[i] || 0);
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }}
      ctx.stroke();
    }}
    ctx.globalAlpha = 1;

    // Y-axis label
    ctx.save(); ctx.fillStyle = "#55556a"; ctx.font = "9px monospace";
    ctx.fillText(yMax.toFixed(1) + " µV²", 2, pad + 8);
    ctx.restore();

    // Legend
    let lx = pad;
    for (const name of BAND_NAMES) {{
      ctx.fillStyle = BAND_COLORS[name]; ctx.font = "9px monospace";
      ctx.fillRect(lx, 3, 8, 8); lx += 10;
      ctx.fillText(name, lx, 11); lx += ctx.measureText(name).width + 10;
    }}
  }}

  // Initial draw + resize
  updateSliderUI();
  const ro = new ResizeObserver(() => {{ drawWave(); drawBands(); drawBandsAbs(); }});
  ro.observe(document.getElementById("waveCanvas"));
  ro.observe(document.getElementById("bandCanvas"));
  ro.observe(document.getElementById("absCanvas"));
}})();
</script>
"""

HTML_TEMPLATE = """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Session Report — {session_id}</title>
<style>
  :root{{--bg:#0d0d14;--panel:#13131e;--border:#252535;--text:#c4c4d4;--muted:#55556a;
         --good:#44cc66;--fair:#ddaa33;--poor:#cc4444;}}
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:var(--bg);color:var(--text);font-family:ui-monospace,monospace;font-size:13px;padding:16px}}
  h1{{font-size:16px;letter-spacing:.1em;color:#8888ff;margin-bottom:12px}}
  .panel{{background:var(--panel);border:1px solid var(--border);border-radius:5px;padding:12px;margin-bottom:10px}}
  .panel-title{{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}}
  .summary{{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:8px}}
  .stat{{background:#1a1a28;border-radius:4px;padding:8px 10px}}
  .stat-k{{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}}
  .stat-v{{font-size:16px;font-weight:700;margin-top:2px}}
  .good{{color:var(--good)}}.fair{{color:var(--fair)}}.poor{{color:var(--poor)}}
  img{{width:100%;height:auto;display:block;border-radius:3px;margin-top:6px}}
</style>
</head>
<body>
<h1>Session Report &mdash; {session_id}</h1>

{training_section}
{training_timeline_section}

<div class="panel">
  <span class="panel-title">Summary</span>
  <div class="summary">
    <div class="stat"><div class="stat-k">Duration</div><div class="stat-v">{duration}</div></div>
    <div class="stat"><div class="stat-k">Quality</div>
      <div class="stat-v {quality_label}">{quality_mean} <small>{quality_label}</small></div></div>
    <div class="stat"><div class="stat-k">Alpha (mean rel)</div><div class="stat-v">{alpha_mean}</div></div>
    <div class="stat"><div class="stat-k">Device / Ch</div><div class="stat-v">{device} / {channel}</div></div>
  </div>
</div>

{interactive_section}

<div class="panel">
  <span class="panel-title">Eyes Open vs Closed</span>
  <img src="data:image/png;base64,{b64_eyes}" alt="eyes comparison">
</div>

{artifact_section}

</body>
</html>
"""

TRAINING_SECTION = """\
<div class="panel" style="border-color:#5577ee44">
  <span class="panel-title" style="color:#8888ff">Neurofeedback Protocol — {prog_title}</span>
  <div class="summary" style="margin-top:8px">
    <div class="stat"><div class="stat-k">Reward Band</div><div class="stat-v" style="color:#f08030;font-size:13px">{reward_band}</div></div>
    <div class="stat"><div class="stat-k">Reward Threshold</div><div class="stat-v" style="color:#f08030">{reward_threshold}</div></div>
    <div class="stat"><div class="stat-k">Inhibit Bands</div><div class="stat-v" style="font-size:12px">{inhibit_bands}</div></div>
    <div class="stat"><div class="stat-k">Inhibit Thresholds</div><div class="stat-v" style="font-size:12px">{inhibit_thresholds}</div></div>
    <div class="stat"><div class="stat-k">Calibrated At</div><div class="stat-v" style="font-size:11px;color:var(--muted)">{calibrated_at}</div></div>
    <div class="stat"><div class="stat-k">Reward Events</div><div class="stat-v" style="color:#44cc66">{reward_count}</div></div>
    <div class="stat"><div class="stat-k">Reward Rate</div><div class="stat-v" style="color:#44cc66">{reward_rate}</div></div>
    <div class="stat"><div class="stat-k">Gate Hold</div><div class="stat-v" style="color:var(--muted)">{gate_hold}</div></div>
    <div class="stat"><div class="stat-k">Window / Retune</div><div class="stat-v" style="font-size:12px">{window_and_retune}</div></div>
    <div class="stat"><div class="stat-k">Bias</div><div class="stat-v" style="font-size:12px">{bias_summary}</div></div>
    <div class="stat"><div class="stat-k">Final Window</div><div class="stat-v" style="font-size:12px">{window_summary}</div></div>
    <div class="stat"><div class="stat-k">Threshold Moves</div><div class="stat-v" style="color:#f0cc44">{threshold_moves}</div></div>
  </div>
</div>
"""

TRAINING_TIMELINE_SECTION = """\
<div class="panel">
  <span class="panel-title">Neurofeedback Timeline</span>
  <img src="data:image/png;base64,{b64_training_timeline}" alt="neurofeedback timeline">
</div>
"""

ARTIFACT_SECTION = """\
<div class="panel">
  <span class="panel-title">Artifact Timeline</span>
  <img src="data:image/png;base64,{b64_artifacts}" alt="artifact timeline">
</div>
"""


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: report.py <session_dir>", file=sys.stderr); sys.exit(1)
    session_dir = Path(sys.argv[1])
    if not session_dir.is_dir():
        print(f"Not a directory: {session_dir}", file=sys.stderr); sys.exit(1)

    print(f"[report.py] Analysing {session_dir.name}...")
    rows, meta = load_session(session_dir)
    if not rows:
        print("[report.py] No metric rows, skipping.", file=sys.stderr); sys.exit(1)

    summary      = compute_summary(rows, meta)
    b64_eyes     = fig_eyes_comparison(rows)
    b64_artifacts = fig_artifacts(rows)
    b64_training_timeline = fig_training_timeline(meta)

    eeg_data  = load_eeg_data(session_dir, meta)
    band_data = load_band_data(rows, meta)

    interactive_section = ""
    if eeg_data:
        interactive_section = INTERACTIVE_SECTION.format(
            eeg_json=json.dumps(eeg_data),
            band_json=json.dumps(band_data),
        )

    artifact_section = ""
    if b64_artifacts:
        artifact_section = ARTIFACT_SECTION.format(b64_artifacts=b64_artifacts)

    training_timeline_section = ""
    if b64_training_timeline:
        training_timeline_section = TRAINING_TIMELINE_SECTION.format(
            b64_training_timeline=b64_training_timeline,
        )

    training_section = ""
    prog = meta.get("program") or meta.get("training_program")
    if prog:
        tevents = meta.get("training_events", [])
        reward_on_count = sum(1 for e in tevents if e.get("type") == "reward_on")
        duration_sec = float(rows[-1]["elapsed"]) if rows else 0.0
        tick_rate = 5.0  # ticks/sec (200ms poll)
        total_ticks = max(1, duration_sec * tick_rate)
        # Estimate reward rate from spans
        spans_sec = 0.0
        last_on = None
        for ev in tevents:
            if ev.get("type") == "reward_on":
                last_on = ev["elapsed"]
            elif ev.get("type") == "reward_off" and last_on is not None:
                spans_sec += ev["elapsed"] - last_on
                last_on = None
        if last_on is not None:
            spans_sec += duration_sec - last_on
        reward_rate_pct = spans_sec / max(1.0, duration_sec) * 100
        inhibit_bands = prog.get("inhibit_bands", [])
        inhibit_names = ", ".join(b["name"] for b in inhibit_bands)
        thresh = meta.get("training_thresholds") or {}
        reward_thresh_val = thresh.get("reward")
        inhibit_thresh_vals = thresh.get("inhibit", [])
        reward_threshold_str = f"{reward_thresh_val:.2f}%" if reward_thresh_val is not None else "—"
        if inhibit_thresh_vals and inhibit_bands:
            inhibit_threshold_str = ", ".join(
                f"{b['name']} ≤{v:.2f}%"
                for b, v in zip(inhibit_bands, inhibit_thresh_vals)
            )
        else:
            inhibit_threshold_str = "—"
        calibrated_at = thresh.get("calibratedAt", "")
        settings = meta.get("training_settings") or thresh.get("settingsSnapshot") or {}
        summary_meta = meta.get("training_summary") or {}
        if calibrated_at:
            try:
                from datetime import datetime as _dt
                calibrated_at = _dt.fromisoformat(calibrated_at.replace("Z","")).strftime("%Y-%m-%d %H:%M")
            except Exception:
                pass
        window_sec = settings.get("windowSec")
        adapt_sec = settings.get("adaptSec")
        reward_bias = settings.get("rewardBiasPct", 0)
        inhibit_bias = settings.get("inhibitBiasPct", 0)
        combined_pct = summary_meta.get("combinedWindowPct")
        reward_window_pct = summary_meta.get("rewardWindowPct")
        inhibit_window_pct = summary_meta.get("inhibitWindowPct", [])
        threshold_moves = len(summary_meta.get("thresholdAdjustments", []))
        inhibit_window_str = ", ".join(
            f"{b['name']} {v:.0f}%"
            for b, v in zip(inhibit_bands, inhibit_window_pct)
        ) if inhibit_window_pct and inhibit_bands else "—"
        training_section = TRAINING_SECTION.format(
            prog_title=prog.get("title", "?"),
            reward_band=prog.get("reward_band", {}).get("name", "?"),
            reward_threshold=reward_threshold_str,
            inhibit_bands=inhibit_names or "—",
            inhibit_thresholds=inhibit_threshold_str,
            calibrated_at=calibrated_at or "—",
            reward_count=str(reward_on_count),
            reward_rate=f"{reward_rate_pct:.1f}%",
            gate_hold=f"{prog.get('gate_hold_ms', 500)} ms",
            window_and_retune=f"{window_sec:.0f}s / {adapt_sec:.0f}s" if window_sec and adapt_sec else "—",
            bias_summary=f"Reward {reward_bias:+.0f}% | Inhibit {inhibit_bias:+.0f}%",
            window_summary=(
                f"Combined {combined_pct:.0f}% | SMR {reward_window_pct:.0f}% | {inhibit_window_str}"
                if combined_pct is not None and reward_window_pct is not None else "—"
            ),
            threshold_moves=str(threshold_moves),
        )

    html = HTML_TEMPLATE.format(
        session_id=session_dir.name,
        b64_eyes=b64_eyes,
        interactive_section=interactive_section,
        artifact_section=artifact_section,
        training_section=training_section,
        training_timeline_section=training_timeline_section,
        **summary,
    )

    out = session_dir / OUTPUT_NAME
    out.write_text(html)
    print(f"[report.py] Wrote {out}")


if __name__ == "__main__":
    main()
