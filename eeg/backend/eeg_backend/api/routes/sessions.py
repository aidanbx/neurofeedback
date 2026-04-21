"""Session history and note routes."""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ...sessions.store import (
    SESSIONS, SESSIONS_ARCHIVE, find_session_dir, list_sessions, note_template,
)

router = APIRouter()

SESSION_SERVE_EXTS = {".html", ".png", ".json", ".csv", ".jsonl"}

_app = None


def set_app(app) -> None:
    global _app
    _app = app


@router.get("/sessions")
async def get_sessions():
    return list_sessions()


@router.get("/session/note")
async def get_note(id: str):
    d = find_session_dir(id)
    if not d:
        return {"ok": False, "error": "session not found", "exists": False}
    note_file = next(d.glob("*.md"), None)
    if note_file:
        return {"ok": True, "content": note_file.read_text("utf-8"), "filename": note_file.name, "exists": True}
    filename, template = note_template(id)
    return {"ok": True, "content": template, "filename": filename, "exists": False}


@router.post("/session/note")
async def save_note(body: dict):
    session_id = body.get("id", "")
    content    = body.get("content", "")
    d = find_session_dir(session_id)
    if not d:
        raise HTTPException(404, "session not found")
    filename, _ = note_template(session_id)
    for old in d.glob("*.md"):
        old.unlink()
    (d / filename).write_text(content, encoding="utf-8")
    return {"ok": True, "filename": filename}


@router.post("/session/note/append")
async def append_note(body: dict):
    elapsed_sec = float(body.get("elapsed_sec", 0))
    text = str(body.get("text", "")).strip()
    if not text:
        return {"ok": False, "error": "empty text"}
    with _app.lock:
        recording   = _app.recorder.recording
        session_id  = _app.recorder.recording_id or body.get("id", "")
    if not session_id:
        return {"ok": False, "error": "no active session"}
    if recording:
        _app.event_log.append(
            "NoteAdded",
            source="ui",
            data={"text": text},
            session_id=session_id,
        )
    else:
        d = find_session_dir(session_id)
        if not d:
            d = SESSIONS / session_id
            d.mkdir(parents=True, exist_ok=True)
        existing = list(d.glob("*.md"))
        if existing:
            note_path    = existing[0]
            note_content = note_path.read_text(encoding="utf-8")
        else:
            filename, note_content = note_template(session_id)
            note_path = d / filename
        m = int(elapsed_sec // 60)
        s = int(elapsed_sec % 60)
        note_path.write_text(note_content.rstrip() + f"\n[{m}:{s:02d}] {text}\n", encoding="utf-8")
    return {"ok": True}


@router.post("/session/note/delete")
async def delete_note(body: dict):
    session_id = body.get("id", "")
    d = find_session_dir(session_id)
    if d:
        for f in d.glob("*.md"):
            f.unlink()
    return {"ok": True}


@router.post("/session/log")
async def log_event(body: dict):
    event_type = str(body.get("type", "SessionEvent"))
    event = _app.event_log.append(
        event_type,
        source=str(body.get("source", "ui")),
        program_id=body.get("program_id"),
        data=body.get("data") if isinstance(body.get("data"), dict) else {},
    )
    if event is None:
        return {"ok": False, "error": "not recording"}
    return {"ok": True, "event": event}


@router.post("/session/favorite")
async def toggle_favorite(body: dict):
    sid      = body.get("id", "")
    want_fav = bool(body.get("favorite", True))
    if not re.match(r"^[\w]+$", sid):
        raise HTTPException(400, "invalid id")
    src = SESSIONS / sid
    if not src.is_dir():
        raise HTTPException(404, "session not found")
    base     = re.sub(r"Favorite$", "", sid)
    new_name = base + ("Favorite" if want_fav else "")
    if new_name != sid:
        (SESSIONS / sid).rename(SESSIONS / new_name)
    return {"ok": True, "new_id": new_name}


@router.post("/session/archive")
async def archive_sessions(body: dict):
    ids = body.get("ids", [])
    SESSIONS_ARCHIVE.mkdir(parents=True, exist_ok=True)
    moved, errors = [], []
    for sid in ids:
        if not re.match(r"^[\w]+$", sid):
            errors.append(f"invalid id: {sid}")
            continue
        src = SESSIONS / sid
        if not src.is_dir():
            errors.append(f"not found: {sid}")
            continue
        shutil.move(str(src), str(SESSIONS_ARCHIVE / sid))
        moved.append(sid)
    return {"ok": True, "moved": moved, "errors": errors}


@router.get("/session/{session_id}/{filename}")
async def serve_session_file(session_id: str, filename: str):
    safe_name = Path(filename).name
    ext = Path(safe_name).suffix.lower()
    if ext not in SESSION_SERVE_EXTS:
        raise HTTPException(403, "file type not allowed")
    d = find_session_dir(session_id)
    if not d:
        raise HTTPException(404, "session not found")
    target = d / safe_name
    if not target.exists():
        raise HTTPException(404, "file not found")
    return FileResponse(str(target))
