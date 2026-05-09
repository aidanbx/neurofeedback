## Commands to Run
```bash
# Shared port config lives in eeg/config/ports.json

# Production-ish Electron app
npm run build
node_modules/.bin/electron .
# Dev mode with Vite hot reload + Electron
npm run dev
# Backend only
cd backend
conda run -n eeg uvicorn eeg_backend.api.main:app --host 127.0.0.1 --port 8766 --reload
# Frontend only
cd frontend
npm run dev
# Frontend build check
cd frontend
npm run build
# Backend tests
cd backend
conda run -n eeg python tests/test_foundation.py
conda run -n eeg python tests/test_programs.py
conda run -n eeg python tests/test_dsp.py
conda run -n eeg python tests/test_metrics.py
```

## Dev split workflow:
```bash
# terminal 1
cd eeg/backend
conda run -n eeg uvicorn eeg_backend.api.main:app --host 127.0.0.1 --port 8766 --reload

# terminal 2
cd eeg/frontend
npm run dev

# terminal 3
cd eeg
ELECTRON_DEV=1 node_modules/.bin/electron .
```
