# `eeg/` Architecture Audit

Compared against the goals we discussed: microkernel/plugin architecture, auditable replay, hot/cold-path separation, and agent-friendliness.

---

## TL;DR

The bones are good. The project already commits to the right shapes: a `ProgramRuntime` narrow waist, filesystem-discovered plugins, pure DSP functions split from stateful metrics, shared contracts mirrored across languages, per-session directories with `raw_eeg.csv` / `program_input_trace.csv` / `program_output_trace.csv` / `session_events.jsonl`, and a React UI that doesn't do DSP. You did the hard structural work.

What's missing is the **closing of the loop**:

1. **Program parameters have two sources of truth and no API to bridge them.** The sliders in `alpha_feedback/view.tsx` (lines 42–45) that claim to control reward/inhibit percentages only update local React state — they never reach Python, so the Python runtime's `_reward_target_pct` (`runtime.py:45`) is authoritative but unreachable. Any session recorded today has an unknown threshold from the program's perspective.
2. **Almost nothing is instrumented for replay.** Audio track selection, volumes, response time, and master volume — the exact settings you named in conversation as what you'd want replayed — are ephemeral React state. They never hit `session_events.jsonl`. The `POST /api/session/log` endpoint exists (`sessions.py:107`) but is never called from the frontend (no `logEvent` method in `client.ts`).
3. **The "settings replay" you described isn't built yet.** `hardware/replay.py` replays raw EEG, but not the event log. `SessionDetail` shows static reports only.
4. **Program manifests are too thin to carry schema.** Four keys (`id`, `title`, `description`, `version`) — no declared bands, params schema, UI slots, or audio capabilities. Without schema in the manifest, the framework can't auto-wire, auto-validate, or auto-instrument programs.
5. **The debug program is front-end-only** — `frontend/src/programs/debug/view.tsx` exists but `backend/eeg_backend/programs/debug/` does not. The VIEWS map (`host.tsx:8`) and backend's `/api/programs` list are out of sync, which is exactly what the plugin architecture is supposed to prevent.

These are not architectural rewrites. They're small, concrete follow-throughs on the architecture you've already chosen.

---

## What's working well

**Pure DSP, stateful metrics.** `dsp/pipeline.py` is pure functions and `metrics/engine.py` owns the stateful baseline/smoothing. This is the right split. The pure functions are testable (and tested, `tests/test_dsp.py`) without standing up an app.

**Plugin discovery by convention.** `main.py::_load_programs` (lines 50–68) scans `programs/*/manifest.json` and auto-loads `<X>Runtime` classes. Adding a program is, in principle, "drop a folder." This is the right instinct.

**Template subclassing.** `RewardInhibitRuntime` (`templates.py`) factors out calibration, percentile thresholds, and clarity mapping — so `alpha_feedback` and `alpha_theta_beta` share logic without duplication. This is exactly the "hot spot for future programs" you want.

**Per-session directory with multiple artifact streams.** `raw_eeg.csv`, `program_input_trace.csv`, `program_output_trace.csv`, `session_events.jsonl`, `metadata.json` — different concerns in different files, each a flat schema, easy to re-load for analysis. The shape of a session on disk is already good.

**Typed contracts in both languages.** `backend/contracts.py` and `frontend/src/contracts.ts` both define `MetricsSnapshot`, `ProgramOutput`, etc. The TS side is hand-mirrored (a smell — see below) but having a single named waist is worth a lot.

**Pure-function view layer.** React components (`Waveform.tsx`, `PSDPlot.tsx`, `BandBars.tsx`, `TimelineChart.tsx`) accept typed data and draw it. No DSP, no fetching. They're cheap to test and cheap to swap.

**Electron shell is minimal.** `electron/main.ts` (53 lines), `pythonProcess.ts` (29 lines), `preload.ts` (6 lines). The Python process is managed as a subprocess, the renderer talks to it over HTTP/WS only. This is the right posture for keeping the shell out of the way.

**Per-program report dispatch.** `recorder.py::start_analysis` looks for `programs/<id>/report.py` and falls back to a default (`recorder.py:177–185`). Reports-as-plugins is exactly right for a research platform.

---

## Problems, ordered roughly by impact

### 1. Program parameters don't round-trip

**What's wrong**

In `alpha_feedback/view.tsx:42–45`:
```tsx
const [rewardTarget, setRewardTarget] = useState(65);
const [thetaInhibit, setThetaInhibit] = useState(15);
const [betaInhibit,  setBetaInhibit]  = useState(15);
```
These three sliders are rendered (lines 136–138). Their `onChange` handlers only call `setRewardTarget` etc. — **no API call anywhere**.

Meanwhile in `backend/programs/alpha_feedback/runtime.py:45–47`:
```python
self._reward_target_pct = DEFAULT_REWARD_PCT   # 65.0
self._theta_inhibit_pct = DEFAULT_THETA_INHIB  # 15.0
self._beta_inhibit_pct  = DEFAULT_BETA_INHIB   # 15.0
```
And a `set_params()` method exists (lines 147–154) that knows how to apply them. But **no route calls this method.** `api/routes/training.py::set_params` (line 27) only forwards to `metrics_engine.set_params`, which is the shared baseline/smoothing engine — not the per-program runtime.

**Why it matters**
- Two sources of truth; they're in sync today only because the defaults match by coincidence.
- You cannot actually change the reward target from the UI. Every session uses the hardcoded backend default.
- Same problem for `alpha_theta_beta`'s three reward-pct sliders and for the entire audio stack (`masterVol`, `responseTime`, `baseUrl`, `clearUrl`, `baseVol`, `clearVol`, × 3 scenes for ATB).
- None of these changes make it into `session_events.jsonl`, so sessions are unreplayable.

**Fix sketch**

Add `POST /api/programs/{id}/params` that forwards to `app.programs[id].set_params(body)`. Standardize on a `params` dict contract between program runtime and UI. Have the UI call the API on slider change (debounced), and for audio/UI-only settings that don't affect DSP, still log them via an event-log API (see #2).

Even better: make `set_params` return the resolved params so the UI can reflect clamping/validation. Think of it as a CQRS "command" that emits a new "param applied" event.

### 2. Event-log instrumentation isn't wired from the frontend

**What's wrong**

`api/routes/sessions.py:107–119` defines `POST /api/session/log` which appends a JSON line to `session_events.jsonl`. But in `frontend/src/api/client.ts` there is no `logEvent` method — the endpoint is never called. Only `appendNote` writes to the event log (and only for note events).

**Why it matters**
- You can't replay sessions because the event log has notes and almost nothing else.
- This is the single biggest gap between the current code and the vision you described ("by default instrumenting any of the settings").

**Fix sketch**

- Add `api.logEvent(type: string, data: Record<string, unknown>)` in `client.ts`.
- Add a tiny `useInstrumented` hook or `InstrumentedSlider` / `InstrumentedTrackPicker` wrapper that auto-logs `{type: "param", program: ..., name: ..., value: ...}` on change (debounced).
- Convert the ad-hoc `useState`s in each program view to go through these instrumented primitives.
- Long-term: carry a `paramSchema` in the program manifest, and have the framework render the controls automatically from schema — at which point instrumentation is built in at the framework layer, not per-program.

This is the single change that most advances the "research platform" aim.

### 3. Replay replays the wrong thing

**What's wrong**

`hardware/replay.py` loads `raw_eeg.csv` and feeds it back through `on_frame` at the true sample rate. That's a raw-signal re-stream, not a session replay.

There is no code that reads `session_events.jsonl`, `program_input_trace.csv`, or `program_output_trace.csv` back during replay. Which means: during "test mode," the live DSP/program pipeline runs against the replayed signal with *current* settings, not the settings that were in effect when the session was recorded.

**Why it matters**

The user-level goal is "press play on an old session and watch exactly what happened re-happen, including all the settings changes." Today's replay gives a new run over old data, not a re-run of the old session.

**Fix sketch**

Once #1 and #2 land, a real session replayer is:
1. Stream `raw_eeg.csv` as the BLE source (already works).
2. Parallel-stream `session_events.jsonl` at matching `elapsed` timestamps, applying each event to the app state exactly as the user did live.
3. Mark the session as "replaying session X" so newly emitted events are discarded (or routed to a temporary buffer) rather than overwriting.

This is a real feature, not a trivial change, but it falls out naturally from a well-instrumented event log.

### 4. Manifests are too thin

**What's wrong**

`backend/programs/alpha_feedback/manifest.json`:
```json
{
  "id": "alpha_feedback",
  "title": "Alpha Feedback",
  "description": "Single-scene alpha clarity feedback with rolling theta and beta inhibits.",
  "version": "2.0"
}
```

**Why it matters**

The manifest is the obvious place for:
- **Required bands** — e.g. `["Alpha", "Theta", "Beta", "Hi-Beta"]`. Framework can refuse to load if the DSP pipeline doesn't provide them.
- **Param schema with defaults** — e.g. `{"reward_target_pct": {"type": "float", "min": 1, "max": 99, "default": 65, "label": "Reward rate"}}`. Framework can auto-render sliders, auto-validate, auto-persist, auto-log.
- **Audio capabilities** — e.g. `{"scenes": ["alpha", "theta", "beta"]}`. Framework can render a shared audio UI.
- **Declared UI slots** — "this program fills `main` with the standard metric panels plus a clarity timeline." Lets the framework own layout; the program just declares.

With the manifest doing this work, most of each program's view file disappears — programs become *data* plus a small `tick()` function and an optional render override. That's the design that actually lets you "drop in a program."

**Fix sketch**

Define a `ProgramManifest` dataclass (Python) and `ProgramManifest` interface (TS). Validate at load time (`_load_programs`). Start small: move the param definitions out of Python runtime code and into the manifest. Then progressively take over the sidebar controls.

### 5. Debug program is asymmetric

**What's wrong**

- `frontend/src/programs/debug/view.tsx` exists and is in the `VIEWS` map (`host.tsx:8`).
- `backend/eeg_backend/programs/debug/` does **not** exist. `/api/programs` returns only `alpha_feedback` and `alpha_theta_beta`.
- Therefore "Debug" never appears in the sidebar program list (`App.tsx:169`).
- Therefore the debug view is reachable only if `programStore.activeProgramId` is manually set to `"debug"` — which no UI path currently does.

**Why it matters**

It's a dead feature as of today, and more importantly, it illustrates the narrow waist isn't actually narrow. There are three places a program lives:
- `backend/programs/<id>/` (runtime + manifest)
- `frontend/src/programs/<id>/` (view module)
- `frontend/src/programs/host.tsx` `VIEWS` map

When a program forgets one, nothing fails — it just partially exists. This is the exact kind of thing agents will do.

**Fix sketch**

Two options:
- **Dynamic registration.** Have the manifest declare the frontend view module path; `host.tsx` loads views by id from a convention (`./${id}/view`) using `import.meta.glob` so the static map goes away. Then one missing file = one error, not two places out of sync.
- **Add a `debug` backend stub.** A no-op `ProgramRuntime` that just echoes `{}`. Simpler, but doesn't solve the general problem.

Do the first. It also nukes `VIEWS` as a hand-maintained hotspot.

### 6. Contracts are hand-mirrored

**What's wrong**

`backend/contracts.py` and `frontend/src/contracts.ts` define the same shapes in two languages. They're kept in sync by hand. TypeScript interfaces have no runtime check — a backend change that drops a field silently becomes `undefined` in TS.

**Why it matters**

Every time the data shape evolves, the probability of one-sided edits goes up. An agent given "add X to MetricsSnapshot" will update one side in about half of cases.

**Fix sketch**

A few workable options, in increasing order of investment:
- **Pydantic + pydantic-to-typescript codegen.** Replace the dataclasses with Pydantic BaseModels, add a one-line `npm run gen-contracts` that runs `pydantic2ts`. Single source of truth, auto-generated TS. This is the usual answer.
- **Zod schemas shared via a tiny tool** — possible but overkill here.
- **Just the JSON Schema.** Emit JSON Schema from Pydantic and consume from both sides.

### 7. Hot-path locking on BLE frames

**What's wrong**

`main.py::_on_frame` (lines 98–112) acquires `SessionApp.lock` and performs a double loop (`frame.samples` × channels) inside. The analysis loop (lines 114–120, running at 4 Hz) acquires the same lock and does heavy NumPy inside a short critical section (lines 124–131) but any long read/write contends. BLE notifications arrive at ~50 Hz (5 samples / 0.1s); lock contention can stall them.

Separately, `_on_frame` mutates `self.recorder.record_sample_index` directly instead of going through `recorder`'s own lock. Encapsulation is broken; future concurrency changes will break subtly.

**Why it matters**

Probably not biting yet, but the user explicitly listed "fast and efficient real-time" as a must-have. Worth fixing before it's an emergency.

**Fix sketch**

- Separate the "ingest" path (ring buffers, append-only) from the "analyze" path (read snapshot of ring buffer, compute). Ring buffer pushes don't need the same lock as analysis.
- Have the recorder own its own index and expose a single `recorder.ingest(frame, now)` method. `_on_frame` calls that plus appends to live buffers. `SessionApp.lock` protects only `latest_snap` / `latest_program_output` / `active_program_id`.
- Broadcast loop is an async coroutine — the shared state it reads should be guarded by an asyncio lock (or immutable snapshots), not the same threading lock as the ingest thread.

### 8. Polling + pushing for app state

**What's wrong**

`App.tsx:60–64` polls `GET /api/state` every 2 seconds. But the app also has a WebSocket (`useEEGStream`). The poll exists because the WebSocket only broadcasts `{type: "metrics", ...}` — `connection_state`, `recording`, `active_program`, `test_mode` aren't pushed.

**Why it matters**

- Two mechanisms, two code paths. Agents will pick randomly between them.
- 2s latency on state changes (disconnect events, recording starts) is visible.
- Adds an endpoint that just duplicates a subset of the WebSocket.

**Fix sketch**

Add a second WS message type: `{type: "app_state", data: AppStatePatch}`. Broadcast on actual changes (debounced) instead of continuously. Remove the poll. The `StreamMessage` type becomes a discriminated union on `type`.

### 9. Program param flow conflates `MetricsEngine` with programs

**What's wrong**

`/api/training/params` ([training.py:22–30](eeg/backend/eeg_backend/api/routes/training.py)) is called "training params" but it operates on `MetricsEngine`, which is a **shared** baseline/smoothing engine used by all programs. Meanwhile each `ProgramRuntime` has its *own* `get_params`/`set_params` that's never exposed.

**Why it matters**

"Training params" is a misnomer that will confuse future readers (and agents). The boundary between "shared DSP parameters" and "per-program parameters" is real and should be named in the API and the UI. Today all the per-program controls are silently stateless on the backend.

**Fix sketch**

- Rename `/api/training/params` → `/api/metrics/params` (or `/api/dsp/params`).
- Add `/api/programs/{id}/params` (GET + POST) backed by `app.programs[id].get_params/set_params`.
- Have each program view declare which it uses. Wire the sliders to the right ones.

### 10. View-vs-program split leaks

**What's wrong**

`frontend/src/views/SessionsView.tsx` and `frontend/src/programs/<id>/view.tsx` use two conceptually similar but physically different trees. `App.tsx:93–95` picks one or the other:
```tsx
{selectedSession
  ? <SessionDetail session={selectedSession} onBack={...} />
  : <ProgramHost />}
```

**Why it matters**

Not urgent. But the session browser is structurally a "view mode" — it belongs in the same abstraction as programs. If you had a general `View` registry with `{id, title, component}`, live programs and session-review modes would be peers. Session replay (when you build it) is naturally a view. Adding data-analysis tools later (e.g. "compare sessions", "band trend over weeks") is natural when views are a concept.

**Fix sketch**

Later. Once programs have a real manifest, lift the registry to "views" and let programs be one type of view.

### 11. `ProgramLayout` boilerplate

**What's wrong**

`alpha_feedback/view.tsx` and `alpha_theta_beta/view.tsx` have near-identical `main` sections (Waveform, BandBars, clarity timeline, PSD, second waveform). Each program repeats the same 25-line block.

**Why it matters**

Every new program starts with a copy-paste. This is the opposite of "focus on the idea, not the UI."

**Fix sketch**

A `<StandardMainPanels />` component that takes the `metrics` and the program's primary timeline series list. Programs collapse to:
```tsx
<ProgramLayout
  title="Alpha Feedback"
  main={<StandardMainPanels timeline={[{label: "Clarity", points: history, threshold: 0.5}]}/>}
  sidebar={<ThresholdControls .../>}
/>
```
Even more schema-driven: the manifest declares "show the standard main panels + a timeline of clarity" and `ProgramHost` renders it, with the program just providing `tick()` output.

### 12. Report generation plumbing has a missing file

**What's wrong**

`sessions/recorder.py:17`:
```python
DEFAULT_REPORT = PROGRAMS_DIR / "default_report.py"
```
But `find backend/eeg_backend/programs -name "default_report*"` returns no results. If a program has no `report.py`, the analysis silently fails to find anything (`start_analysis` just returns at line 184).

**Why it matters**

The first time you finish a training session, there will be no report. The analysis status stays at `"not_run"` forever.

**Fix sketch**

Either ship a minimal default report (just metadata + CSVs embedded in an HTML shell — there's already a `reports/base.py::html_shell`) or remove the branch. I'd ship a minimal default.

### 13. `ConnectionManager.disconnect` no-op line

In `api/websocket.py:27`:
```python
self._clients.discard if hasattr(self._clients, "discard") else None
```
This evaluates a method reference and discards it. It doesn't call anything. The intent is unclear — possibly leftover from refactoring a `set` to a `list`. Lines 28–29 do the actual removal, so it works, but the line should be deleted.

### 14. `sessions/store.py` and `api/routes/audio.py` path gymnastics

```python
ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # eeg/
```

Five `.parent` calls. Fragile if any file moves. Centralize in a `paths.py`:
```python
EEG_ROOT = Path(__file__).resolve().parents[3]
```
or better, compute once at import time in a single module.

### 15. Silent exception swallowing

Grep for `except Exception` across the backend and you'll find ~10 spots that catch and do nothing (or only log). This makes field debugging hard. At minimum, log with the session id or operation so you can tell what failed when.

---

## Agent-friendliness specific notes

**Things that will trip up AI agents today:**

- **Three places a program lives.** See #5. Agents will fix one and report done.
- **Two Python-side params APIs (`metrics_engine` vs per-program) and only one wired to the UI.** Agents asked to "add a new slider" will put it in the React component only — as has already happened with `rewardTarget` et al.
- **Hand-mirrored contracts.** Agents *love* updating one side and forgetting the other.
- **No manifest schema.** Agents asked to "add a new program like alpha_feedback" will copy-paste everything, including the dead `asdict(AlphaFeedbackPayload)` pattern and the un-wired sliders. Schema-driven programs would stop this.
- **`VIEWS` in `host.tsx`** is a per-program line that must be added by hand. Dynamic import eliminates it.

**Things that *will* work well for agents:**

- `dsp/pipeline.py` is pure — an agent can be given this one file and asked to add a new artifact-rejection mode, and the blast radius is contained.
- `components/graphs/*` are similarly pure.
- Individual route files in `api/routes/` are small and focused.
- `templates.py::RewardInhibitRuntime` is a perfect unit of attention — an agent can add a new subclass in one folder.

---

## Recommended first-pass changes, in order

1. **Wire `POST /api/programs/{id}/params` end-to-end.** New route, forwards to `app.programs[id].set_params`. Make the `alpha_feedback` sliders actually work. (Couple hours; highest leverage single change.)
2. **Add `api.logEvent` and an `InstrumentedSlider`/`InstrumentedTrackPicker`.** Every param change (both DSP-affecting and UI-only) writes to `session_events.jsonl`. (Half a day.)
3. **Ship a `default_report.py`.** At minimum: embed metadata + basic CSV-derived plots. Kills the silent-no-report bug.
4. **Delete the `VIEWS` map in `host.tsx`**; use `import.meta.glob('./*/view.tsx')`. Use the backend manifest to drive which ids to render. (Small.)
5. **Split `/api/training/params` into `/api/metrics/params` + `/api/programs/{id}/params`.** Clear naming, right boundary.
6. **Pydantic-ify `contracts.py` + generate `contracts.ts`.** One source of truth, plus runtime validation in FastAPI for free.
7. **Expand the program manifest.** Start with `required_bands` and `params` schema with defaults; render the slider panel from schema. The alpha_feedback sidebar can then shrink to ~20 lines.
8. **Separate ingest lock from analysis lock** in `SessionApp`. Profile first if you're not sure it's needed, but the change is defensive.
9. **Build the real session replayer.** Requires #1 + #2 first. The payoff is the research-platform use case you described.

Roughly the first half of that list is about 1–2 days of work and turns the current "mostly right architecture" into "right architecture, fully wired." The second half is the research-platform features.

---

## One-liners I'd add to CLAUDE.md once the above lands

- "Programs live in three places today — see *Debug program is asymmetric*. When you add a program, add all three."
- "All UI state changes that affect program behavior must go through `api.logEvent` or `api.setProgramParams`. Local `useState` is fine only for purely transient UI (e.g. modal open/close)."
- "The manifest is the source of truth for declared bands, params, and audio capabilities. Never hardcode these in runtime.py or view.tsx."
- "Never add DSP to a React component. DSP lives in `backend/dsp/`."
- "Never hand-edit both `backend/contracts.py` and `frontend/src/contracts.ts` in the same PR — regenerate."

These are the kinds of rules that are invisible today and will matter a lot the first time an agent tries to extend the system without reading every file.
