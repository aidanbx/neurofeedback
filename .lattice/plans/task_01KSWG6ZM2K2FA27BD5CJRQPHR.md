# NF-2: Show compact signal quality metrics in master feedback
# Plan

Set the frontend default active program from `debug` to `master_feedback` in `eeg/frontend/src/state/programStore.ts`.

Extract the signal quality metric formatting/history chart from the debug `SignalPanel` into a compact reusable component under `eeg/frontend/src/components/signal/`, then use it in `eeg/frontend/src/programs/master_feedback/view.tsx` directly under the band buttons and above the waveform. Keep the master view compact: left-to-right metric cards for quality score, common correlation, slow waves, and 60Hz noise, plus the small rolling quality chart beneath those cards.

Verify with the frontend build/typecheck script if available.
