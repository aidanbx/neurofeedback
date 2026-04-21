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
    """Deprecated compatibility alias for /api/metrics/params."""
    return _app.metrics_engine.get_params()


@router.post("/params")
async def set_params(body: dict):
    """Deprecated compatibility alias for /api/metrics/params."""
    _app.metrics_engine.set_params(body)
    return {"ok": True}


@router.post("/reset-baseline")
async def reset_baseline():
    _app.metrics_engine.reset_baseline()
    _app.event_log.append("BaselineReset", source="ui")
    return {"ok": True}


@router.post("/start")
async def training_start(body: dict):
    _app.start_training(body.get("program"))
    return {"ok": True}


@router.post("/stop")
async def training_stop():
    path = _app.stop_training()
    if path:
        _app.recorder.start_analysis(path)
    return {"ok": True, "saved_to": str(path) if path else None}
