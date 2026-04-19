"""Training session routes."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

_app = None


def set_app(app) -> None:
    global _app
    _app = app


class ParamsBody(BaseModel):
    class Config:
        extra = "allow"


@router.get("/params")
async def get_params():
    return _app.metrics_engine.get_params()


@router.post("/params")
async def set_params(body: dict):
    _app.metrics_engine.set_params(body)
    return {"ok": True}


@router.post("/reset-baseline")
async def reset_baseline():
    _app.metrics_engine.reset_baseline()
    return {"ok": True}


@router.post("/start")
async def training_start(body: dict):
    if not _app.recorder.recording:
        _app.recorder.start_recording()
    program = body.get("program")
    if program:
        _app.recorder.set_training_program(program)
        # Load and reset the program runtime
        program_id = program.get("id")
        if program_id and program_id in _app.programs:
            _app.active_program_id = program_id
            _app.programs[program_id].reset()
    return {"ok": True}


@router.post("/stop")
async def training_stop():
    _app.active_program_id = None
    path = _app.recorder.stop_recording()
    if path:
        _app.recorder.start_analysis(path)
    return {"ok": True, "saved_to": str(path) if path else None}
