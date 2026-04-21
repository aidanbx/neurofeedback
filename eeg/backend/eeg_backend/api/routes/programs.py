"""Program discovery and schema-backed parameter routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ...programs.registry import resolve_settings, setting_changes

router = APIRouter()

_app = None


def set_app(app) -> None:
    global _app
    _app = app


@router.get("/programs")
async def list_programs():
    return [definition.public_manifest() for definition in _app.program_defs.values()]


@router.get("/programs/{program_id}/params")
async def get_program_params(program_id: str):
    if program_id not in _app.programs or program_id not in _app.program_defs:
        raise HTTPException(404, "program not found")
    definition = _app.program_defs[program_id]
    return {
        "ok": True,
        "program_id": program_id,
        "params": _app.programs[program_id].get_params(),
        "settings_schema": definition.settings_schema,
    }


@router.post("/programs/{program_id}/params")
async def set_program_params(program_id: str, body: dict):
    if program_id not in _app.programs or program_id not in _app.program_defs:
        raise HTTPException(404, "program not found")
    runtime = _app.programs[program_id]
    definition = _app.program_defs[program_id]
    before = runtime.get_params()
    resolved = resolve_settings(definition.settings_schema, body, current=before)
    runtime.set_params(resolved)
    after = runtime.get_params()
    changes = setting_changes(before, after)
    if changes:
        _app.event_log.append(
            "ProgramParamsChanged",
            source="ui",
            program_id=program_id,
            data={"changes": changes, "params": after},
        )
    return {"ok": True, "program_id": program_id, "params": after, "changes": changes}
