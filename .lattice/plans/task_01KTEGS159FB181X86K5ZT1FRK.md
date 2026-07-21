# NF-9: Use streaming filter for live waveform display

Replace the live waveform display signal with a causal/stateful streaming filter so the newest samples are shown in real time and are not recomputed by `sosfiltfilt` over a moving 8-second window.

Approach:
- Add a `StreamingDisplayFilter` helper in `eeg/backend/eeg_backend/dsp/pipeline.py` that maintains high-pass and low-pass SOS filter state, plus optional notch filter state, and returns causally filtered chunks.
- Instantiate one display filter and one filtered rolling buffer per channel in `SessionApp`.
- In `_on_frame`, append raw samples as before and append streaming-filtered samples to the new display buffers.
- In `_update_metrics`, keep `compute_frame_metrics` unchanged for analysis/PSD/quality, but replace only `frame.live_trace_y`/`live_trace_t` in the outgoing `MetricsSnapshot` with the last `LIVE_TRACE_SEC` of the streaming display buffer.
- Reset display filter state if the notch toggle changes so stale notch state cannot leak across modes.
- Verify with backend tests and frontend build.
