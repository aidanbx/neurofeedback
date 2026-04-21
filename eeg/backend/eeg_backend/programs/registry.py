"""Program manifest loading and schema-backed settings validation."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SUPPORTED_SETTING_TYPES = {"number", "boolean", "string", "enum"}


class ProgramManifestError(ValueError):
    pass


@dataclass(frozen=True)
class ProgramDefinition:
    id: str
    title: str
    description: str
    version: str
    runtime: str
    frontend_view: str
    settings_schema: dict[str, dict[str, Any]]
    required_bands: list[str]
    audio_scenes: list[str]
    manifest_path: Path

    def public_manifest(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "version": self.version,
            "runtime": self.runtime,
            "frontend_view": self.frontend_view,
            "settings_schema": self.settings_schema,
            "required_bands": self.required_bands,
            "audio_scenes": self.audio_scenes,
        }


def _require_str(raw: dict[str, Any], key: str, manifest_path: Path) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ProgramManifestError(f"{manifest_path}: missing string field {key}")
    return value


def _validate_setting_schema(raw: Any, manifest_path: Path) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, dict):
        raise ProgramManifestError(f"{manifest_path}: settings_schema must be an object")
    schema: dict[str, dict[str, Any]] = {}
    for key, spec_raw in raw.items():
        if not isinstance(key, str) or not key:
            raise ProgramManifestError(f"{manifest_path}: setting keys must be non-empty strings")
        if not isinstance(spec_raw, dict):
            raise ProgramManifestError(f"{manifest_path}: setting {key} must be an object")
        typ = spec_raw.get("type")
        if typ not in SUPPORTED_SETTING_TYPES:
            raise ProgramManifestError(f"{manifest_path}: setting {key} has unsupported type {typ!r}")
        if "default" not in spec_raw:
            raise ProgramManifestError(f"{manifest_path}: setting {key} missing default")
        spec = dict(spec_raw)
        if typ == "enum":
            options = spec.get("options")
            if not isinstance(options, list) or not options:
                raise ProgramManifestError(f"{manifest_path}: enum setting {key} needs options")
            if spec["default"] not in options:
                raise ProgramManifestError(f"{manifest_path}: enum setting {key} default not in options")
        schema[key] = spec
    return schema


def _validate_string_list(raw: Any, key: str, manifest_path: Path) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(isinstance(v, str) for v in raw):
        raise ProgramManifestError(f"{manifest_path}: {key} must be a string list")
    return list(raw)


def load_program_definitions(programs_dir: Path) -> dict[str, ProgramDefinition]:
    definitions: dict[str, ProgramDefinition] = {}
    if not programs_dir.is_dir():
        return definitions
    for program_dir in sorted(programs_dir.iterdir()):
        manifest_path = program_dir / "manifest.json"
        if not program_dir.is_dir() or not manifest_path.exists():
            continue
        raw = json.loads(manifest_path.read_text())
        prog_id = _require_str(raw, "id", manifest_path)
        if prog_id != program_dir.name:
            raise ProgramManifestError(f"{manifest_path}: id must match folder name")
        definitions[prog_id] = ProgramDefinition(
            id=prog_id,
            title=_require_str(raw, "title", manifest_path),
            description=_require_str(raw, "description", manifest_path),
            version=_require_str(raw, "version", manifest_path),
            runtime=_require_str(raw, "runtime", manifest_path),
            frontend_view=_require_str(raw, "frontend_view", manifest_path),
            settings_schema=_validate_setting_schema(raw.get("settings_schema", {}), manifest_path),
            required_bands=_validate_string_list(raw.get("required_bands"), "required_bands", manifest_path),
            audio_scenes=_validate_string_list(raw.get("audio_scenes"), "audio_scenes", manifest_path),
            manifest_path=manifest_path,
        )
    return definitions


def defaults_from_schema(schema: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {key: spec["default"] for key, spec in schema.items()}


def _coerce_value(value: Any, spec: dict[str, Any]) -> Any:
    typ = spec["type"]
    if typ == "number":
        coerced = float(value)
        if "min" in spec:
            coerced = max(float(spec["min"]), coerced)
        if "max" in spec:
            coerced = min(float(spec["max"]), coerced)
        step = spec.get("step")
        if step and float(step) >= 1 and coerced.is_integer():
            return int(coerced)
        return coerced
    if typ == "boolean":
        return bool(value)
    if typ == "string":
        return str(value)
    if typ == "enum":
        options = spec["options"]
        return value if value in options else spec["default"]
    raise ProgramManifestError(f"unsupported setting type {typ!r}")


def resolve_settings(
    schema: dict[str, dict[str, Any]],
    incoming: dict[str, Any] | None = None,
    current: dict[str, Any] | None = None,
) -> dict[str, Any]:
    values = defaults_from_schema(schema)
    if current:
        for key, value in current.items():
            if key in schema:
                values[key] = _coerce_value(value, schema[key])
    if incoming:
        for key, value in incoming.items():
            if key in schema:
                values[key] = _coerce_value(value, schema[key])
    return values


def setting_changes(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    changes: dict[str, dict[str, Any]] = {}
    for key, value in after.items():
        old = before.get(key)
        if old != value:
            changes[key] = {"old": old, "value": value}
    return changes
