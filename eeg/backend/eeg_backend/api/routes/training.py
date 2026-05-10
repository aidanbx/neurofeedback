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
async def training_stop(body: dict | None = None):
    body = body or {}
    path = _app.stop_training(
        save=bool(body.get("save", False)),
        notes=body.get("notes"),
        include_psd_baseline=bool(body.get("include_psd_baseline", False)),
    )
    if path and body.get("analyze", True):
        _app.recorder.start_analysis(path)
    return {"ok": True, "saved_to": str(path) if path else None, "pending": path is None}


@router.post("/save")
async def training_save(body: dict | None = None):
    body = body or {}
    path = _app.save_stopped_training(
        notes=body.get("notes"),
        include_psd_baseline=bool(body.get("include_psd_baseline", False)),
    )
    if path and body.get("analyze", True):
        _app.recorder.start_analysis(path)
    return {"ok": bool(path), "saved_to": str(path) if path else None}


@router.post("/discard")
async def training_discard():
    return {"ok": _app.discard_stopped_training()}
