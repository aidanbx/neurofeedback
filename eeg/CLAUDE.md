# EEG Neurofeedback App

Use schema-first program settings. Do not add behavior-affecting local-only UI state. Program params must go through /api/programs/{id}/params. UI/audio-only state must log session events. For frontend changes, run npm run build. For backend changes, run the focused Python tests. Do not start Electron unless explicitly doing manual UI smoke testing.


Rebuilt from `web_session_app/`. All program logic runs in Python; frontend receives data via WebSocket.

## Environment

```bash
conda activate eeg
```

## Running

```bash
# Change frontend/backend ports in eeg/config/ports.json

# Backend only
cd eeg/backend
conda activate eeg
uvicorn eeg_backend.api.main:app --reload

# Frontend dev
cd eeg/frontend
npm install && npm run dev
```

## Structure

```
eeg/
├── backend/eeg_backend/
│   ├── contracts.py          # Shared dataclasses: RawFrame, MetricsSnapshot, ProgramOutput
│   ├── dsp/                  # DSP: constants.py + pipeline.py (pure functions)
│   ├── metrics/engine.py     # MetricsEngine (stateful baseline + smoothing)
│   ├── hardware/             # ble_client.py (BLE) + replay.py (CSV replay)
│   ├── sessions/             # recorder.py (recording) + store.py (listing)
│   ├── programs/             # base.py + templates.py + alpha_feedback/ + alpha_theta_beta/
│   └── api/                  # FastAPI app + routes + WebSocket broadcast
├── frontend/src/
│   ├── contracts.ts          # TypeScript mirrors of Python dataclasses
│   ├── api/                  # HTTP client + WebSocket + hooks
│   ├── state/                # Zustand stores
│   ├── audio/                # AudioScene (TypeScript port of engine.js)
│   ├── components/           # Shared graphs, controls, session widgets
│   └── programs/             # host.tsx + per-program views
└── electron/                 # Electron shell + pythonProcess.ts
```

## Adding a New Program

1. Create `backend/eeg_backend/programs/<id>/runtime.py` — subclass `ProgramRuntime` (or `RewardInhibitRuntime`)
2. Create `backend/eeg_backend/programs/<id>/manifest.json`
3. Create `frontend/src/programs/<id>/view.tsx`
4. Add to `VIEWS` map in `frontend/src/programs/host.tsx`

No other files need modification.

## Tests

```bash
cd eeg/backend
conda run -n eeg python tests/test_dsp.py
conda run -n eeg python tests/test_metrics.py
conda run -n eeg python tests/test_programs.py
```

## WebSocket Message

```typescript
{ type: "metrics", data: MetricsSnapshot, program_output: ProgramOutput | null }
```
