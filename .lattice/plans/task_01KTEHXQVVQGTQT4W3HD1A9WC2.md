# NF-11: Expose gating controls and plot gate states

Expose and visualize hidden gating behavior in Master Feedback.

Plan:
- Add configurable program params to `master_feedback`: quality gate, artifact gate, and booleans to enable/disable quality/artifact gating for reward/inhibit activation. Include current gate thresholds and pass/fail states in the payload.
- Use those program params instead of hard-coded `QUALITY_GATE=55` and `ARTIFACT_GATE=0.30` in Master Feedback reward/inhibit behavior.
- Keep threshold calibration history quality-gated by the same configurable thresholds for now, but ensure reward audio is never granted when reward quality/artifact gates are enabled and failing.
- Add artifact and low-quality rows to the middle activation timeline: artifact as red, low quality as maroon.
- Add a right-sidebar "Gates" section in Master Feedback showing live quality/artifact numbers, controls for gate thresholds/toggles, and the broadcast rate slider moved out of the global top bar.
- Audit other hidden or semi-hidden knobs; record findings in Lattice and avoid broader unrelated rewrites in this pass.
- Verify backend tests and frontend build.
