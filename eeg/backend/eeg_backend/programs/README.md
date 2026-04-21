# Program Plugins

Programs are schema-first plugins. A program folder must include:

- `manifest.json`
- `runtime.py`
- optional `report.py`

The manifest is the public contract. Put behavior-affecting settings in
`settings_schema`; do not invent UI-only copies of those settings in React or
runtime defaults that are not represented in the schema.

At startup, the backend validates manifests, initializes each runtime from
schema defaults, and exposes settings through `/api/programs/{id}/params`.
Runtime classes still implement the experiment logic through `ProgramRuntime`,
but `settings_schema` is the source of truth for labels, ranges, defaults, and
agent-facing configuration.

When adding a program:

1. Add the backend folder and manifest.
2. Add `runtime.py` with a `ProgramRuntime` subclass.
3. Add `frontend/src/programs/<id>/view.tsx`.
4. Use instrumented controls for every behavior-affecting setting.
