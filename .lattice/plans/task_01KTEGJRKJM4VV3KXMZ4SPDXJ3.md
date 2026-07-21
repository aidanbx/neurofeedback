# NF-8: Investigate waveform right-side section jumps

Investigate why the right side of the live waveform appears to move up/down in whole sections after switching the canvas to fixed +/-25µV bounds. Trace `live_trace_y` generation from backend DSP through WebSocket into the React component, verify whether the signal is raw DC drift or processing/rendering behavior, and record findings. No code change unless the root cause is trivial and clearly safe.
