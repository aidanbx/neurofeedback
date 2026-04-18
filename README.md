# IronBCI EEG — Home Neurofeedback System

Real-time EEG recording, visualization, and neurofeedback training for the EAREEG (IronBCI) 8-channel EEG headset.

## Quick Start

```bash
conda activate eeg
cd web_session_app
python server.py
# → opens http://127.0.0.1:8765 in your browser
```

Connect the headset via the Connect button. Recording, training, and analysis run from the browser UI.

---

## Architecture

```
EAREEG (BLE)
    ↓ 250 Hz, 8-ch, 24-bit
server.py          ← Python HTTP + BLE server
    │  /api/state  ← polled every 200ms by browser
    │  /api/view   ← waveform + PSD window
    │  /api/*      ← controls, training, recording
    ↓
static/app.js      ← live display (waveform, PSD, band bars, spectrogram)
static/training/   ← neurofeedback training subsystem
sessions/          ← saved session data (CSV + JSON)
analysis/          ← report generator (runs automatically on stop)
```

### Signal processing (server-side)

- **Highpass filter**: 0.3 Hz (analysis), 0.5 Hz (display)
- **60 Hz notch**: `iirnotch` (togglable in UI)
- **Band power**: Welch PSD every 250 ms over a 2s window
- **Relative 1-30 Hz**: used in display and CSV
- **Relative 4-30 Hz** (`relative_training`): delta excluded — used by training engine to prevent artifact contamination

---

## Live View Controls

| Button | Effect |
|--------|--------|
| Notch 60Hz | Apply/remove 60 Hz notch filter from display |
| Bands: 1-30Hz / 4-30Hz | Toggle delta exclusion in the live band bars |
| Recenter | Subtract median offset from displayed waveform |
| Artifact Reject | Interpolate over large transient artifacts before PSD |
| Eyes / Posture / Muscle Clench | Tag state events; shown as colored shading on waveform and in session reports |
| Blink | Mark a single blink event |

---

---

## Adding Audio Tracks

Drop MP3/OGG/WAV files into `web_session_app/static/audio/tracks/`. The UI's track selector refreshes on each Training panel open.

---

## Session Data

Sessions are saved in `sessions/<YYYYMMDD_HHMMSS>/`:

| File | Contents |
|------|----------|
| `metadata.json` | Device config, event lists (eyes, posture, clench, blink, training, track changes) |
| `derived_metrics.csv` | Band power (relative + absolute), quality, signal diagnostics — one row per 500ms |
| `raw_eeg.csv` | Raw ADC samples for the visualized channel |
| `spectrogram.csv` | Per-frequency PSD snapshots |
| `report.html` | Auto-generated interactive report |

### Columns in `derived_metrics.csv`

- `elapsed`: seconds since recording start
- `eyes`: `open` / `closed`
- `clench`: `relaxed` / `clenching`
- `{band}_rel_pct`: relative band power 1-30 Hz (Delta, Theta, Alpha, SMR, Beta, Hi-Beta)
- `{band}_abs_uv2`: absolute band power in µV²
- `quality_score`, `quality_label`: 0-100 signal quality

---

## Environment

```bash
conda activate eeg
# Dependencies: bleak numpy scipy
```

Device: **EAREEG** (IronBCI) — BLE, 250 Hz, 8 channels, 24-bit ADC.
Default channel: Ch1 (index 0). Change `CHANNEL` constant in `server.py`.
