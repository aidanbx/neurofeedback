# Next Development Push — Synthesized Plan

*Companion to `ARCHITECTURE_AUDIT.md` and the second audit. Synthesizes both with the conflicts between them resolved.*

---

## Push goal

After this push, **every setting change in `alpha_feedback` is typed, validated, logged with session-clock time, and replayable in principle**; and **adding a new program is one folder with no other-file edits**. The replayer itself isn't built yet, but the session on disk has everything a future replayer needs.

That's the whole push. Everything below is in service of that single sentence.

---

## Decisions that resolve the conflicts between the two audits

Three forks matter and need to be called now, before anyone writes code.

### 1. Program settings: schema-first, not runtime-first

The schema is the contract. `runtime.py` implements against the schema; it does not define it.

Per program:

```
backend/eeg_backend/programs/alpha_feedback/
  manifest.json           # references settings.schema.json
  settings.schema.json    # JSON Schema: keys, types, bounds, defaults, labels
  runtime.py              # consumes schema-validated dicts in set_params
  report.py               # optional
```

The backend API validates incoming settings against the schema before ever reaching `set_params`. `get_params` is implemented but derives its "which keys" answer from the schema, not from hand-maintained dicts in `runtime.py`.

**Why this fork matters most:** if we do runtime-first now and retrofit schema-first later, every program written in the interim is wrong and every agent-authored change reinforces the wrong pattern. This is the one reversal that's expensive, so we pick once.

### 2. Storage format: JSONL for structured streams, CSV for flat numeric

- `raw_eeg.csv` — **keep as CSV.** Flat, numeric, downstream tools (pandas, MNE) read it directly. Migration to Parquet is a future optimization, not this push.
- `program_input_trace.csv` — **keep as CSV** for now. Fields are already flattened per band; no structure is being lost.
- `program_output_trace.csv` → **`program_outputs.jsonl`**. This one must change this push. Structured payloads (`drives`, `thresholds`, nested dicts) are being `str()`-ified into CSV cells today, losing information.
- `session_events.jsonl` — **keep, but make it central.** Every control change flows through it via a single `SessionEventLog` service, not via scattered endpoint writes.

### 3. Don't touch the locks. Don't dissolve `SessionApp` yet.

The second audit's Phase 3 decomposition (six runtime services) is the right long-term shape, and the first audit's lock-refactor is wasted work once that decomposition lands. **Skip both in this push.** Extracting `SessionEventLog` and `ProgramSettingsService` from `SessionApp` is enough decomposition for now — it buys the audit surface we need without committing to the full Phase 3 structure.

`SessionApp` stays. Its critical sections don't change. Reassess after the full push is merged.

### 4. Clock abstraction — adopt it. This was the highest-value insight from Audit 2.

Introduce `SessionClock` now even though replay isn't being built this push. Every timestamped thing — events, program ticks, note elapsed — routes through the clock. Today `LiveSessionClock` is the only implementation. When replay lands, `ReplaySessionClock` slots in without touching the rest of the code.

Without this, ad hoc `time.monotonic()` + `sample_index / SRATE` math will spread further across modules and be expensive to unwind.

---

## The work, ordered by dependency

### Stage A — Backbone (no user-visible change)

These unblock everything else. Ship them together; none are useful alone.

**A1. `runtime/clock.py`**
- `SessionClock` protocol with one method: `elapsed_sec() -> float`.
- `LiveSessionClock(started_at, sample_counter)` implementation.
- `FakeClock` for tests.
- Replace the ad hoc `datetime.now() - recording_started_at` and `sample_index / 250` math in `recorder.py`, `sessions.py` routes, and `main.py::_log_input_trace`. All callers go through the clock.

**A2. `runtime/event_log.py` — `SessionEventLog` service**
- Owns `session_events.jsonl` for the active session.
- Single append-only API: `log(event_type: str, **fields)`.
- Uses `SessionClock.elapsed_sec()` — never wall time.
- Owned by `SessionApp`; passed to routes that currently open the events file directly.
- Routes in `sessions.py` that open the file by hand (`/session/note/append`, `/session/log`) become thin wrappers around `event_log.log(...)`.

**A3. Typed event vocabulary**
- Enum or literal type for event kinds: `SessionStarted, SessionStopped, ProgramSelected, ProgramStarted, ProgramStopped, SettingChanged, AudioTrackChanged, ArtifactRejectionChanged, BaselineReset, NoteAdded`. (Replay-specific variants added later.)
- Each event has a minimal typed payload in a single `events.py` module, both Python and TS (hand-mirrored for now; codegen is a later push).

**A4. `programs/settings_schema.py`**
- Loads `settings.schema.json` per program at registration time.
- Validates settings dicts before they reach `runtime.set_params`.
- Surfaces defaults via `schema.defaults()` so `metadata.json` can include the resolved starting settings without the runtime having to reimplement them.
- Write `settings.schema.json` for `alpha_feedback` and `alpha_theta_beta` during this stage — they're the forcing function.

### Stage B — Wiring alpha_feedback end-to-end

Once the backbone exists, do one program fully. Don't parallelize across programs yet; prove the pattern on one.

**B1. Program settings API**
- `GET /api/programs/{id}/settings` → returns current settings (from runtime) + schema (from disk).
- `POST /api/programs/{id}/settings` → validates, calls `runtime.set_params`, logs `SettingChanged` event per changed key.
- Old `/api/training/params` → rename to `/api/dsp/params` with the existing `MetricsEngine` wiring. The misnomer stops. No deprecation alias — this is pre-production; just change the name and update the two call sites.

**B2. Instrumented frontend controls**
- `InstrumentedSlider`, `InstrumentedSelect`, `InstrumentedToggle`, `InstrumentedTrackPicker`.
- Each takes a `{scope, programId, key}` descriptor plus value/onChange. Debounced; emits a typed command to the backend; the backend returns the resolved value (post-clamp); component reflects that. No local `useState` for anything that affects a program.
- UI-only preferences that don't affect DSP (e.g. "which tab is open") stay as plain React state.
- Audio track changes route through the same mechanism, emitting `AudioTrackChanged`. `AudioScene` instance is *not* controlled by React `useState` for the track URLs — it's controlled by the backend round-trip, which means replay can restore it.

**B3. Convert `alpha_feedback/view.tsx`**
- Replace every useState that affects program behavior with instrumented controls.
- Specifically: `rewardTarget`, `thetaInhibit`, `betaInhibit` → program settings (backed by schema).
- `masterVol`, `baseVol`, `clearVol`, `baseUrl`, `clearUrl`, `responseTime` → audio events logged via `AudioTrackChanged` / `SettingChanged`.
- Fix the bug that `baseVol` and `clearVol` don't call `AudioScene.setTrackVolumes` (flagged in second audit — the sliders are literally wired nowhere today).
- `ProgramStarted` event at session start carries a full settings snapshot.
- `ProgramStopped` event at session stop.

**B4. `program_output_trace.csv` → `program_outputs.jsonl`**
- One JSON object per tick: `{"elapsed": ..., "program_id": ..., "status_text": ..., "payload": {...}}`.
- Nested payload structure preserved. Downstream report scripts that read this need updating — there's only `default_report.py` (which doesn't exist yet) and optional per-program reports. See B5.
- Keep `program_input_trace.csv` unchanged.

**B5. Default report stub**
- Create `programs/default_report.py`. Minimum viable: read `metadata.json`, summarize duration, plot raw EEG spectrogram + band power trace, emit `report.html` via the existing `reports/base.py::html_shell`.
- Kills the silent "analysis never completes" bug flagged in Audit 1 (#12).

**B6. Session metadata enrichment**
- Add to `metadata.json`: `program_id`, `program_version`, `manifest_hash`, `starting_settings` (resolved from schema), `app_version` (from package.json), `session_clock_mode: "live"`. Git commit is optional but cheap — add it if the repo is available.
- Gives replay and analysis enough provenance to know what code produced a session.

### Stage C — Template-ize to prevent agent drift

Apply the pattern to the second program so it's clear what a "new program" looks like, then remove the ways an agent can drop a file in the wrong place.

**C1. Repeat Stage B for `alpha_theta_beta`**
- Same schema + API + instrumented controls pattern.
- Confirms the template. If B was done right, C is ~half a day.

**C2. Dynamic frontend view registry**
- Replace the `VIEWS` map in `host.tsx` with `import.meta.glob('./*/view.tsx', {eager: false})`.
- `ProgramHost` looks up the view by id from what backend `/api/programs` returned; no hardcoded list.
- Adding the missing `backend/programs/debug/` runtime + manifest stub (no-op runtime, empty schema) now makes `debug` appear in the sidebar correctly — the three-places-a-program-lives bug goes away. (This isn't zero-edit yet because `host.tsx` still reads from a glob, but the glob + the manifest now fully drive registration.)

**C3. `programs/README.md` (backend) and `src/programs/README.md` (frontend)**
- Short (~30 lines each). The checklist for adding a program: manifest, schema, runtime, view. What files live where. What contracts each file satisfies.
- This is the one-file-an-agent-can-point-at that the second audit asked for.

**C4. Delete the dead weight flagged in Audit 2**
- Unused imports: `parse_notify_bytes` in `api/main.py`, `asdict` in `recorder.py`, `ParamsBody` in `training.py`, `seen` in `audio.py`.
- No-op `self._clients.discard if hasattr(...)` in `websocket.py`.
- Small, but removing them in the same push as the structural changes means agents aren't tempted to cargo-cult them.

---

## What's explicitly *not* in this push

These are the right calls long-term but not this push. Calling them out so they don't accrete to the scope.

- **Full `SessionApp` decomposition** into six runtime services (Audit 2 Phase 3). The event log + settings service extractions we're doing are enough for now.
- **Building the actual replayer** (Audit 2 Phase 4). We're building the data it will consume, not the consumer.
- **Pydantic + `pydantic2ts` codegen for contracts** (Audit 1 #6). We'll hand-mirror the new event types for now. Migration is its own push.
- **Moving raw EEG off CSV** (Parquet / Arrow). CSV is fine until sessions are longer or disk becomes a bottleneck.
- **Schema-driven UI rendering.** Sliders are still hand-written this push. They're *instrumented*, not generated. Auto-render-from-schema is a later move once we have 3+ programs to inform the UI abstraction.
- **Lock refactor in `_on_frame` / `_update_metrics`** (Audit 1 #7). Skip. Profile if it becomes a real problem.
- **Polling `/api/state` replacement with pushed app-state events** (Audit 1 #8). Nice cleanup, not load-bearing.
- **`MetricsEngine` → `MetricsRunner` extraction, `StreamEngine` extraction, `ReplayRuntime` class.** All Phase 3. Later.

---

## Rough sequencing and effort

If one person is doing this:

- Stage A: 2–3 days. All four items stack; merge as one change.
- Stage B: 2–3 days. One program, wall-to-wall.
- Stage C: 1 day. Mostly mechanical once B is done.

Roughly a week of focused work. Less if an agent does the boilerplate stages (the schema files and instrumented controls are highly patternable).

If this is parallelized:
- A1 (clock) can be done in an afternoon by anyone.
- A2 + A3 (event log + event types) are coupled but small.
- A4 (schema loader) is independent once the events are typed.
- B2 (instrumented controls) only needs the API shape (B1 interface) — not the backend implementation — to start.

---

## The one-liner for `CLAUDE.md` after this lands

> Programs are declared by four files in one folder: `manifest.json`, `settings.schema.json`, `runtime.py`, `view.tsx`. The schema is the contract — not the runtime code and not the view. Any setting that affects program behavior must go through `POST /api/programs/{id}/settings`, which logs a `SettingChanged` event. Local `useState` for program-affecting UI is a bug.

That rule, enforced, is what turns the current mostly-right-architecture into an agent-proof research platform.

---

## What the push after *this* push looks like

Sketched so decisions here don't paint us into a corner — not a commitment.

- **Push 2 — Replay runtime.** Build `ReplaySessionClock` and `SessionReplayRuntime` that consumes `raw_eeg.csv` + `events.jsonl` and drives the live UI into the recorded state. This is the research-platform deliverable.
- **Push 3 — Decompose `SessionApp`.** Extract `StreamEngine`, `MetricsRunner`, `ProgramRunner` as Audit 2's Phase 3 proposes. At that point the services are already loosely coupled via `SessionEventLog` and `ProgramSettingsService`, so the decomposition is mechanical.
- **Push 4 — Schema-driven controls.** Generate the sidebar slider panel from `settings.schema.json`. Programs stop owning UI for standard parameter types.
- **Push 5 — Pydantic codegen.** Migrate `contracts.py` to Pydantic, generate `contracts.ts` via `pydantic2ts`, drop the hand-mirror.

Each is a self-contained push that builds on the previous. The order is forced: you can't decompose cleanly without the event log, can't replay without the clock, can't schema-render without the schema being canonical first.
