"""Shared metrics parameter routes."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()

_app = None


def set_app(app) -> None:
    global _app
    _app = app


@router.get("/metrics/params")
async def get_metrics_params():
    return _app.metrics_engine.get_params()


@router.post("/metrics/params")
async def set_metrics_params(body: dict):
    before = _app.metrics_engine.get_params()
    _app.metrics_engine.set_params(body)
    after = _app.metrics_engine.get_params()
    changes = {
        key: {"old": before.get(key), "value": value}
        for key, value in after.items()
        if before.get(key) != value
    }
    if changes:
        _app.event_log.append(
            "ProgramParamsChanged",
            source="ui",
            data={"scope": "metrics", "changes": changes, "params": after},
        )
    return {"ok": True, "params": after, "changes": changes}
