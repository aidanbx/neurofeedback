"""Device control routes."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

_app = None  # set by main.py at startup


def set_app(app) -> None:
    global _app
    _app = app


class TestModeBody(BaseModel):
    session_id: str | None = None


@router.post("/connect-toggle")
async def connect_toggle():
    _app.ble.toggle_connection()
    return {"ok": True}


@router.post("/test-mode")
async def toggle_test_mode(body: TestModeBody):
    from ...sessions.store import find_session_dir, SESSIONS
    csv_path = None
    if body.session_id:
        d = find_session_dir(body.session_id)
        if d and (d / "raw_eeg.csv").exists():
            csv_path = d / "raw_eeg.csv"
    result = _app.replay.toggle(csv_path=csv_path, sessions_dir=SESSIONS)
    return {"ok": True, "result": result}


@router.get("/test-mode")
async def get_test_mode():
    snap = _app.replay.snapshot()
    return {"active": snap["test_mode"], "source": snap.get("replay_source")}


@router.post("/artifact-toggle")
async def artifact_toggle():
    with _app.lock:
        _app.artifact_rejection = not _app.artifact_rejection
        value = _app.artifact_rejection
    _app.event_log.append(
        "ArtifactRejectionChanged",
        source="ui",
        data={"value": value},
    )
    return {"ok": True, "value": value}


@router.get("/state")
async def get_state():
    return _app.snapshot()
