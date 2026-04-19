"""Audio tracks and program discovery routes."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import FileResponse

from ...sessions.store import PROGRAMS_DIR

router = APIRouter()

STATIC = Path(__file__).resolve().parent.parent.parent.parent.parent / "frontend" / "public"
AUDIO_TRACKS = STATIC / "audio" / "tracks"


@router.get("/audio-tracks")
async def list_audio_tracks():
    tracks = []
    if AUDIO_TRACKS.is_dir():
        for f in sorted(AUDIO_TRACKS.iterdir()):
            if f.suffix.lower() in {".mp3", ".ogg", ".wav"}:
                tracks.append({
                    "name":     f.stem,
                    "filename": f.name,
                    "url":      f"/audio/tracks/{quote(f.name)}",
                })
    return tracks


@router.get("/programs")
async def list_programs():
    programs = []
    seen: set[str] = set()
    if PROGRAMS_DIR.is_dir():
        for d in sorted(PROGRAMS_DIR.iterdir()):
            if d.is_dir() and (d / "manifest.json").exists():
                try:
                    m = json.loads((d / "manifest.json").read_text())
                    programs.append(m)
                    seen.add(d.name)
                except Exception:
                    pass
    return programs


@router.get("/audio/tracks/{filename}")
async def serve_audio(filename: str):
    target = AUDIO_TRACKS / filename
    if not target.exists():
        from fastapi import HTTPException
        raise HTTPException(404, "track not found")
    return FileResponse(str(target))
