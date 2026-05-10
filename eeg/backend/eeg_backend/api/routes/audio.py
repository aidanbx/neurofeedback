"""Audio track routes."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter()

STATIC = Path(__file__).resolve().parent.parent.parent.parent.parent / "frontend" / "public"
AUDIO_TRACKS = STATIC / "audio" / "tracks"
AUDIO_EFFECTS = STATIC / "audio" / "effects"


@router.get("/audio-tracks")
async def list_audio_tracks():
    return _list_audio_files(AUDIO_TRACKS, "/audio/tracks")


@router.get("/audio-effects")
async def list_audio_effects():
    return _list_audio_files(AUDIO_EFFECTS, "/audio/effects")


def _list_audio_files(directory: Path, url_prefix: str):
    tracks = []
    if directory.is_dir():
        for f in sorted(directory.iterdir()):
            if f.suffix.lower() in {".mp3", ".ogg", ".wav"}:
                tracks.append({
                    "name":     f.stem,
                    "filename": f.name,
                    "url":      f"{url_prefix}/{quote(f.name)}",
                })
    return tracks


@router.get("/audio/tracks/{filename}")
async def serve_audio(filename: str):
    target = AUDIO_TRACKS / filename
    if not target.exists():
        from fastapi import HTTPException
        raise HTTPException(404, "track not found")
    return FileResponse(str(target))


@router.get("/audio/effects/{filename}")
async def serve_audio_effect(filename: str):
    target = AUDIO_EFFECTS / filename
    if not target.exists():
        from fastapi import HTTPException
        raise HTTPException(404, "effect not found")
    return FileResponse(str(target))
