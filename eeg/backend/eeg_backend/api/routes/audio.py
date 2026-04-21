"""Audio track routes."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import FileResponse

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


@router.get("/audio/tracks/{filename}")
async def serve_audio(filename: str):
    target = AUDIO_TRACKS / filename
    if not target.exists():
        from fastapi import HTTPException
        raise HTTPException(404, "track not found")
    return FileResponse(str(target))
