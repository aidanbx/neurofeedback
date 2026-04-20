# EEG Architecture Audit

Date: 2026-04-20

Scope reviewed:

- `EEG/backend/eeg_backend`
- `EEG/backend/tests`
- `EEG/frontend/src`
- `EEG/electron`

Generated/build/dependency directories such as `dist`, `electron-dist`, and `node_modules` were ignored except where their existence affected organization.

## Executive Summary

The current EEG app is a solid prototype with several good architectural instincts already present: Python owns the signal processing, React owns the interactive feedback UI, programs have backend runtimes plus frontend views, sessions record raw EEG and derived traces, replay mode exists, and there are focused unit tests for DSP, metrics, and program runtimes.

The main gap is not that the app lacks modularity. The gap is that the modularity is not yet expressed as strong enough contracts. The code has the beginnings of a plugin platform, but adding a program still requires updating both a backend program folder and the hardcoded frontend `VIEWS` registry. Program manifests are minimal. Program settings are not schema-driven. Program-specific UI state is mostly invisible to the backend. Session events exist, but they are ad hoc rather than a central event log. Replay currently replays raw EEG, not the complete experiment state timeline.

The highest-value change is to make the runtime event-sourced and schema-driven before adding many more programs. In practice, that means:

1. Introduce a first-class session event log for every control change and runtime transition.
2. Move program settings into schemas/manifests and route all changes through typed commands.
3. Add instrumented frontend controls that update program/session state and emit loggable events by default.
4. Split the current `SessionApp` orchestrator into explicit runtime services.
5. Treat replay as a runtime mode with a session clock, not only as CSV sample playback.

The app is not in bad shape. It is at the point where the next architectural layer matters a lot, because the current prototype patterns will become hard to unwind once there are many experiments.

## Architectural Fit Against The Target Model

### Stable Kernel, Experimental Edges

Current fit: partial.

What works:

- The backend has a recognizable stable kernel: DSP, metrics, hardware, sessions, programs, API.
- Programs live under `EEG/backend/eeg_backend/programs/<id>/`.
- Frontend program views live under `EEG/frontend/src/programs/<id>/`.
- Shared UI elements exist for graphs, session controls, track picking, sliders, and program layout.

Where it drifts:

- `EEG/backend/eeg_backend/api/main.py` is currently the real kernel. It owns device input, replay input, live buffers, metric updates, program ticking, recording, view generation, session state, and WebSocket broadcasting.
- A new backend program can be discovered from its manifest, but a new frontend program still requires editing `EEG/frontend/src/programs/host.tsx`.
- The framework does not yet define a strong "program package" contract that joins manifest, runtime, settings schema, frontend view, event types, capabilities, reports, and replay behavior.

Recommended direction:

- Keep the experimental edge as a vertical slice per program.
- Make the stable kernel smaller and more explicit:
  - `runtime/session_runtime.py`
  - `runtime/stream_engine.py`
  - `runtime/program_runner.py`
  - `runtime/event_log.py`
  - `runtime/replay_runtime.py`
  - `programs/registry.py`
  - `storage/session_store.py`

### Plugin Boundary

Current fit: promising but incomplete.

What works:

- `ProgramRuntime` gives each backend program a small interface: `tick`, `reset`, `set_params`, `get_params`, and `program_id`.
- Program runtimes return a `ProgramOutput` with a program-defined payload.
- Backend program discovery scans manifest folders.
- The two current programs share useful behavior through `RewardInhibitRuntime`.

Smells:

- The backend manifest only has `id`, `title`, `description`, and `version`.
- The frontend registry is hardcoded:
  - `EEG/frontend/src/programs/host.tsx` has a static `VIEWS` map.
- The runtime loader finds the first class ending in `Runtime`, which is convenient but implicit.
- There is no declared input contract, output schema, settings schema, UI schema, capability list, deterministic replay declaration, or report declaration.
- Program settings exist in backend `set_params`, but current frontend controls do not appear to call these setters.

Recommended direction:

Extend each program manifest into a real contract:

```json
{
  "id": "alpha_feedback",
  "title": "Alpha Feedback",
  "version": "2.0.0",
  "runtime": "runtime:AlphaFeedbackRuntime",
  "view": "alpha_feedback/view",
  "capabilities": {
    "live": true,
    "replay": true,
    "deterministic": true,
    "requiresAudio": true
  },
  "settingsSchema": "settings.schema.json",
  "outputSchema": "output.schema.json",
  "eventsSchema": "events.schema.json"
}
```

This would let the host validate programs and give AI agents a clear checklist when creating new ones.

### Data Plane vs. Control Plane

Current fit: partial.

What works:

- High-frequency samples are batched into `RawFrame`.
- UI receives lower-frequency metrics over WebSocket at 4 Hz.
- Raw EEG is recorded separately from program input/output traces.
- Program output is stored separately from program input metrics.

Smells:

- Runtime state changes, program settings, notes, device toggles, audio choices, and artifact toggle behavior are not modeled as one coherent control plane.
- The `/api/session/log` endpoint exists, but it is generic and appears to be manually called rather than being the default path for control changes.
- Artifact rejection is a mutable boolean on `SessionApp`, not a logged setting with a timestamped event.
- Program settings changes are not naturally tied to a session, a command, or an event.

Recommended direction:

Use separate paths:

- Data plane:
  - raw EEG chunks
  - derived metric frames
  - program output frames
  - optional high-volume derived streams
- Control plane:
  - `SessionStarted`
  - `ProgramSelected`
  - `ProgramStarted`
  - `ProgramStopped`
  - `SettingChanged`
  - `AudioTrackChanged`
  - `ArtifactRejectionChanged`
  - `BaselineReset`
  - `NoteAdded`
  - `ReplayStarted`
  - `ReplaySeeked`

The data plane should stay compact and fast. The control plane should be richly logged, typed, and human-readable.

### Event Sourcing And Replay

Current fit: early.

What works:

- Sessions write `raw_eeg.csv`.
- Sessions write `program_input_trace.csv`.
- Sessions write `program_output_trace.csv`.
- A `session_events.jsonl` file exists for notes and generic logged events.
- Replay mode can play `raw_eeg.csv` at sample rate.

Smells:

- The event log is not central. It is written from session routes, not from a runtime event service.
- Only notes are clearly transformed into human session notes at stop time.
- Program controls such as track selection, volume, response time, reward rate, inhibit percentages, and artifact rejection are not automatically captured.
- Replay replays raw samples, but does not restore the full sequence of settings and UI choices.
- Replay loops raw samples forever rather than representing a seekable historical session.
- Program calibration state is not snapshotted; replay can recompute it from raw data and settings only if the pipeline is deterministic and the settings timeline is complete.

Recommended direction:

Make `session_events.jsonl` the canonical audit log for control events. Every meaningful user or runtime change should flow through it.

Example events:

```json
{"elapsed":0.000,"type":"SessionStarted","session_id":"20260420_120000","app_version":"..."}
{"elapsed":0.120,"type":"ProgramSelected","program_id":"alpha_feedback","program_version":"2.0.0"}
{"elapsed":3.500,"type":"SettingChanged","scope":"program","key":"reward_target_pct","old":65,"value":70}
{"elapsed":4.100,"type":"AudioTrackChanged","key":"clear_track","value":"Alpha Waves.mp3"}
{"elapsed":12.000,"type":"ArtifactRejectionChanged","value":true}
{"elapsed":30.000,"type":"BaselineReset"}
```

Then replay should consume:

- `metadata.json`
- `raw_eeg.csv`
- `session_events.jsonl`
- optional snapshots
- plugin code version or plugin artifact id

### Instrumented Controls

Current fit: low.

What works:

- There are reusable controls such as `Slider` and `TrackPicker`.
- Program views consistently use those controls.

Smells:

- The controls are presentational only.
- `Slider` calls local `onChange`, but does not know about session logging, commands, setting keys, scope, or replay.
- `TrackPicker` fetches tracks and calls local `onChange`, but does not emit an audio-track event.
- In `alpha_feedback/view.tsx`, reward and inhibit sliders only update local React state.
- In `alpha_theta_beta/view.tsx`, reward sliders similarly only update local React state.
- Audio base/clear volumes are kept in React state, but `AudioScene.setTrackVolumes` is not called from the current program views, so those sliders may not actually affect playback.

Recommended direction:

Create controls that are instrumented by default:

- `InstrumentedSlider`
- `InstrumentedSelect`
- `InstrumentedToggle`
- `InstrumentedTrackPicker`
- `InstrumentedAudioSceneControls`

These should not directly write random log entries. They should send typed commands:

```ts
setProgramSetting({
  programId,
  key: "reward_target_pct",
  value: 70,
  source: "ui"
});
```

The runtime should then:

1. validate against schema
2. update program settings
3. emit a `SettingChanged` event
4. persist the event if recording
5. expose the current settings to UI and replay

### Schemas And Contracts

Current fit: partial.

What works:

- There are Python dataclasses in `EEG/backend/eeg_backend/contracts.py`.
- There are TypeScript mirrors in `EEG/frontend/src/contracts.ts`.
- Tests exercise several core contracts.

Smells:

- Python and TypeScript contracts are duplicated manually.
- `ProgramOutput.payload` is untyped beyond `dict[str, Any]` / `Record<string, unknown>`.
- Program settings are untyped dictionaries.
- No manifest schema exists.
- No event schema exists.
- No versioned storage schema exists.

Recommended direction:

Use schema generation or a single source of truth. Options:

- Pydantic models in Python and generate JSON Schema for TypeScript.
- TypeBox/Zod schemas in TypeScript and generate JSON Schema for Python validation.
- Plain JSON Schema files used by both sides.

For this project, JSON Schema per program may be the most AI-agent-friendly because it is explicit, portable, and easy to inspect.

### Session Storage And Provenance

Current fit: useful but not audit-grade yet.

What works:

- Sessions have a directory.
- Metadata, raw EEG, input traces, output traces, notes, and reports have recognizable file names.
- The session list UI already understands notes, reports, favorites, archives, and durations.
- Program reports can be discovered from program folders.

Smells:

- `SessionRecorder` buffers all raw rows, input traces, and output traces in memory before writing on stop. Long sessions can grow memory usage unnecessarily.
- Program output payloads are flattened to CSV using `str(v)`, which loses structure for nested values such as `drives` or `thresholds`.
- Metadata does not include enough provenance:
  - app version
  - git commit or build id
  - backend package version
  - frontend version
  - program version resolved from manifest
  - manifest hash
  - settings at start
  - hardware/source identity beyond static device metadata
  - replay/live mode
  - random seed
- Analysis status is stored in memory, so after restart the UI will report `not_run` even if a report exists or an analysis failed previously.

Recommended direction:

Use an explicit session layout:

```text
session/
  metadata.json
  events.jsonl
  raw_eeg.csv or raw_eeg.arrow
  metrics.jsonl or metrics.parquet
  program_outputs.jsonl
  snapshots/
    runtime_000030.json
  artifacts/
    report.html
    charts/
  notes.md
```

CSV is fine for raw EEG during prototyping, but JSONL is better for structured program outputs and control events.

### Real-Time Performance

Current fit: acceptable for prototype, risky for longer sessions.

What works:

- The BLE/replay input path batches samples.
- Analysis runs on a background thread.
- Metrics are computed at 4 Hz.
- WebSocket broadcast is 4 Hz rather than per sample.
- Raw sample replay attempts sample-rate timing using `time.monotonic()`.

Smells:

- `SessionRecorder` stores raw sample rows as dictionaries in memory until stop.
- Every raw sample is formatted as strings before persistence.
- `SessionApp._update_metrics` copies all live buffers into NumPy arrays every tick.
- Program output is written on every program tick while recording, independent of the metric trace interval.
- The architecture has no backpressure or drop policy.
- The same `SessionApp` lock protects many unrelated concerns.

Recommended direction:

- Stream raw data to disk incrementally through a writer queue.
- Use chunked binary or columnar storage for long sessions if CSV becomes too slow.
- Separate the analysis tick, logging tick, UI broadcast tick, and program tick explicitly.
- Define a policy for overload:
  - drop UI frames before data frames
  - never block acquisition on report generation or UI clients
  - never perform expensive file operations inside the acquisition callback

### Clock And Determinism

Current fit: incomplete.

What works:

- Recording elapsed time is based on sample index in several places.
- Replay uses `time.monotonic()` for pacing.

Smells:

- There is no first-class session clock.
- Notes use `datetime.now() - recording_started_at`.
- Metrics logging uses `time.monotonic()` plus sample-derived elapsed.
- Replay mode does not expose a replay clock, pause/seek model, or finite session timeline.
- React-side UI history is local and not derived from a replayable timeline.

Recommended direction:

Introduce a clock abstraction:

- `LiveSessionClock`
- `ReplaySessionClock`
- `SimulatedClock`

Every timestamped event should use the session clock. Wall time can be stored in metadata, but experimental time should be sample/replay time.

### AI-Agent Friendliness

Current fit: better than average, but needs stronger local contracts.

What works:

- `EEG/CLAUDE.md` is useful and concise.
- The codebase is small enough to navigate.
- There are obvious subsystem folders.
- Program examples exist.
- Tests are simple and readable.

Smells:

- Adding a program still requires remembering the frontend registry edit.
- Program manifests do not tell an agent what files are required.
- There is no `README.md` or `AGENTS.md` inside `programs/`, `runtime/`, `sessions/`, or `frontend/src/programs/`.
- There are no example minimal/full program templates.
- The orchestrator makes it tempting for agents to keep adding behavior to `api/main.py`.

Recommended direction:

Add small local docs:

- `EEG/backend/eeg_backend/programs/README.md`
- `EEG/backend/eeg_backend/runtime/README.md`
- `EEG/frontend/src/programs/README.md`
- `EEG/backend/eeg_backend/sessions/README.md`

Add canonical examples:

- `programs/example_minimal`
- `programs/example_instrumented_audio`
- `programs/example_pipeline`

Each example should show manifest, settings schema, runtime, output schema, view, tests, and replay expectations.

## What Works Well

### Python Owns DSP

The DSP functions are centralized in `EEG/backend/eeg_backend/dsp/pipeline.py`, with constants in `constants.py`. This is a good fit for EEG work because Python has the right scientific stack and can be tested independently from the UI.

### Metrics Are Isolated

`MetricsEngine` is a stateful but focused module. It handles baseline history, quality gates, smoothing, and mode selection without depending on FastAPI or React.

### Program Runtime Interface Exists

`ProgramRuntime` is small and easy to implement. The current two programs share rolling calibration behavior through `RewardInhibitRuntime`, which is a good sign that useful program primitives are emerging.

### Session Outputs Are Human-Inspectable

The app writes CSV, JSON, JSONL, Markdown notes, and HTML reports. That is very useful for research workflows because the data is not trapped inside an opaque store.

### Replay Already Exists

Even though replay is limited, having `ReplayClient` this early is excellent. It means replay can be promoted into a real runtime mode instead of added later as an afterthought.

### Tests Exist At The Right Places

There are tests for:

- DSP behavior
- metrics behavior
- program runtime behavior

That matches the system's risk profile better than only testing React components.

## Highest-Priority Smells

### 1. UI Controls Are Not Instrumented

This is the biggest mismatch with the desired architecture.

Examples:

- `alpha_feedback` has local state for `rewardTarget`, `thetaInhibit`, `betaInhibit`.
- `alpha_theta_beta` has local state for `alphaReward`, `thetaReward`, `betaReward`.
- Track choices and audio settings are local React state.
- The current `Slider` and `TrackPicker` are presentational.

Impact:

- Replay cannot reconstruct what the operator changed.
- Reports cannot prove which settings produced outputs.
- Backend runtime parameters may not match UI controls.
- AI agents may keep creating one-off controls that are invisible to sessions.

Fix:

Create instrumented controls and a generic program-settings command path before adding more programs.

### 2. `SessionApp` Is Becoming A Monolith

`SessionApp` currently handles too many responsibilities:

- acquisition buffers
- BLE and replay clients
- DSP
- metrics
- program runtime ticking
- recording
- view extraction
- session snapshot
- broadcast state
- active program state

Impact:

- Changes in one area risk breaking real-time behavior elsewhere.
- Agents will keep adding features to the one file that already knows everything.
- It is harder to test runtime behavior without FastAPI.

Fix:

Split it into explicit runtime services. Keep `api/main.py` mostly as composition and route registration.

### 3. Replay Is Raw-Signal Replay, Not Session Replay

Replay currently sends raw samples from `raw_eeg.csv`. That is useful, but it does not replay the full session.

Missing:

- settings timeline
- audio choices
- track load/play events
- artifact toggle events
- baseline resets
- program parameter changes
- UI/control state
- snapshots
- finite session seek/play/pause

Fix:

Build replay around a `SessionReplayRuntime` that combines raw samples with `events.jsonl` and session clock state.

### 4. Program Manifests Are Too Thin

The manifest should become the main map for humans, agents, and the host runtime. Right now it is only display metadata.

Missing:

- runtime class path
- frontend view path
- settings schema
- output schema
- event schema
- capabilities
- replay support
- deterministic/nondeterministic declaration
- report script declaration

Fix:

Define a manifest schema and validate manifests at startup.

### 5. Python And TypeScript Contracts Can Drift

The Python dataclasses and TypeScript interfaces are manually mirrored.

Impact:

- A backend contract change can silently break the frontend.
- Program payloads have no type safety.
- Agents may update one side and forget the other.

Fix:

Adopt one schema source. For this project, JSON Schema generated from Pydantic or maintained per program is likely the most pragmatic.

## Recommended Refactor Plan

### Phase 1: Make Control Changes Auditable

Goal: capture the full experimental state timeline without a large rewrite.

Changes:

1. Add `SessionEvent` models.
2. Add `SessionEventLog` service.
3. Rename or replace `/api/session/log` with typed event append APIs.
4. Route notes, artifact toggles, baseline reset, training start/stop through the event log.
5. Add `InstrumentedSlider`, `InstrumentedSelect`, and `InstrumentedTrackPicker`.
6. Update current program views to use instrumented controls.
7. Persist initial program settings at `ProgramStarted`.

Acceptance criteria:

- Changing any program slider during recording writes a `SettingChanged` event.
- Changing an audio track during recording writes an `AudioTrackChanged` event.
- Toggling artifact rejection writes an event.
- Starting/stopping sessions writes events.
- Events use session elapsed time, not arbitrary wall time.

### Phase 2: Make Program Settings Real

Goal: settings have one source of truth and are validated.

Changes:

1. Add `settings.schema.json` for each program.
2. Add backend program setting API:
   - `GET /api/programs/{id}/settings`
   - `POST /api/programs/{id}/settings`
3. Make setting updates call `ProgramRuntime.set_params`.
4. Include current program settings in `metadata.json`.
5. Include setting events in `events.jsonl`.

Acceptance criteria:

- Current program sliders actually change backend runtime behavior.
- Invalid settings are rejected.
- Program settings can be restored from metadata plus events.

### Phase 3: Split Runtime Services

Goal: make the stable kernel boring and testable.

Proposed modules:

```text
EEG/backend/eeg_backend/runtime/
  app.py
  clock.py
  event_log.py
  stream_engine.py
  metrics_runner.py
  program_runner.py
  replay_runtime.py
```

Move out of `SessionApp`:

- program discovery to `programs/registry.py`
- program ticking to `ProgramRunner`
- event persistence to `SessionEventLog`
- sample buffer management to `StreamEngine`
- replay mode to `ReplayRuntime`
- metric loop to `MetricsRunner`

Acceptance criteria:

- `api/main.py` mostly wires services into FastAPI.
- Program runner can be unit-tested without starting FastAPI.
- Replay runtime can be unit-tested against a tiny session directory.

### Phase 4: Promote Replay To First-Class Session Playback

Goal: press play on an old session and reproduce state changes.

Changes:

1. Introduce `ReplaySession` that reads metadata, raw EEG, and events.
2. Add replay clock with play/pause/seek.
3. During replay, emit control events back into current frontend state.
4. Make program runtime reset and reapply settings before replay.
5. Add optional runtime snapshots for faster seeking.

Acceptance criteria:

- Replaying a session reproduces slider changes at the correct elapsed times.
- Audio selections are restored.
- Artifact rejection changes happen at the recorded times.
- Program outputs match recorded outputs within defined tolerances.

### Phase 5: Make Program Creation Agent-Proof

Goal: agents can add programs without touching framework internals.

Changes:

1. Manifest schema with validation.
2. Program templates.
3. Program-local README.
4. Program-local tests.
5. Generated or convention-based frontend registry.
6. A check command that validates all programs.

Acceptance criteria:

- A new program can be added as a new folder plus manifest.
- No edits to `api/main.py`.
- No edits to a hardcoded frontend map, or the only required edit is generated.
- CI/test command validates manifest, settings schema, runtime import, and frontend view existence.

## Suggested Target Structure

```text
EEG/
  backend/eeg_backend/
    contracts/
      common.py
      events.py
      generated/
    runtime/
      app.py
      clock.py
      stream_engine.py
      metrics_runner.py
      program_runner.py
      replay_runtime.py
      event_log.py
    programs/
      registry.py
      base.py
      templates.py
      alpha_feedback/
        manifest.json
        settings.schema.json
        output.schema.json
        runtime.py
        report.py
        README.md
      alpha_theta_beta/
        manifest.json
        settings.schema.json
        output.schema.json
        runtime.py
        report.py
        README.md
    sessions/
      recorder.py
      store.py
      layout.py
      writers.py
    api/
      main.py
      routes/
  frontend/src/
    contracts/
      generated.ts
      events.ts
    runtime/
      programCommands.ts
      sessionEvents.ts
    controls/
      InstrumentedSlider.tsx
      InstrumentedSelect.tsx
      InstrumentedTrackPicker.tsx
    programs/
      host.tsx
      registry.generated.ts
      alpha_feedback/
        view.tsx
      alpha_theta_beta/
        view.tsx
```

## Concrete Code-Level Observations

### Backend

- `api/main.py` imports `parse_notify_bytes` but does not use it.
- `api/websocket.py` has a no-op `self._clients.discard if hasattr(...) else None`, then removes manually. This is harmless but odd.
- `ParamsBody` in `api/routes/training.py` is defined but unused.
- Route modules use global `_app` injection. This is simple, but dependency injection would be cleaner once runtime services split out.
- `api/routes/audio.py` defines a `seen` set that is not used.
- `SessionRecorder` imports `asdict` but does not use it.
- `SessionRecorder` stores raw rows and traces in memory until stop.
- `write_program_output` stringifies nested payloads into CSV cells, which weakens downstream analysis.
- Analysis status is process memory only.
- `ReplayClient` loops sessions indefinitely, which is useful for test mode but not accurate for historical replay.

### Frontend

- `ProgramHost` hardcodes known views.
- `Slider` and `TrackPicker` are not instrumented.
- Program reward/inhibit controls do not appear to update backend runtime params.
- Audio base/clear volume state is not applied via `AudioScene.setTrackVolumes`.
- `alpha_theta_beta` has a `useEffect` dependency list that omits several referenced values and scene objects.
- Session state is split between local `App` state and `sessionStore`; `sessionStore` is currently underused.
- Session detail can view notes and reports, but does not yet offer a replay/playback workflow.

## A Good North-Star Rule

The framework should own lifecycle, time, data, event logging, replay, storage, and validation. Programs should own experimental ideas: signal interpretation, feedback mappings, views, and settings.

Whenever a new feature is added, ask:

- Is this a runtime/kernel concern?
- Is this a program/plugin concern?
- Is this a data-plane stream?
- Is this a control-plane event?
- Does this setting affect outputs?
- If it affects outputs, where is it logged?
- Can replay restore it?
- Can an AI agent change this one folder without understanding the whole app?

## Bottom Line

The current EEG subproject is a good foundation. It already has the right broad separation: Electron shell, React UI, Python backend, DSP module, session recorder, replay client, and program runtimes.

The next step is to make the implicit architecture explicit. The two most urgent moves are instrumented controls and a real event log. Those two changes will unlock the audit/replay goal and will also make future program development much safer for AI-assisted coding.

