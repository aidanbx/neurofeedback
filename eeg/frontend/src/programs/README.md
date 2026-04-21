# Frontend Program Views

Frontend program views are loaded dynamically by program id with
`import.meta.glob('./*/view.tsx')`. The backend `/api/programs` manifest list is
the source of truth for which programs are user-visible.

Rules for program UI:

- Program settings that affect DSP or reward behavior must use
  `ProgramParamSlider` or another API-backed program-param control.
- Audio choices, volumes, response times, and other replay-relevant UI settings
  must use logged controls such as `LoggedSlider` and `LoggedTrackPicker`.
- Plain local `useState` is fine for transient presentation state only.
- Do not add DSP to React components; DSP belongs in the Python backend.

If a backend manifest exists but `frontend/src/programs/<id>/view.tsx` is
missing, the host shows a clear missing-view error instead of silently failing.
