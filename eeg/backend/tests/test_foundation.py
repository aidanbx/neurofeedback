"""Foundation tests for manifests, params, events, and JSONL outputs."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from eeg_backend.contracts import ProgramOutput
from eeg_backend.programs.registry import (
    ProgramManifestError, load_program_definitions, resolve_settings,
)
from eeg_backend.reports.base import load_program_outputs
from eeg_backend.sessions import event_log as event_log_module
from eeg_backend.sessions import recorder as recorder_module
from eeg_backend.sessions.event_log import SessionEventLog
from eeg_backend.sessions.recorder import SessionRecorder, load_psd_baseline


def test_program_manifests_validate():
    programs_dir = Path(__file__).parent.parent / "eeg_backend" / "programs"
    defs = load_program_definitions(programs_dir)
    assert "alpha_feedback" in defs
    assert "alpha_theta_beta" in defs
    assert defs["alpha_feedback"].settings_schema["reward_target_pct"]["default"] == 65


def test_invalid_manifest_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "bad"
        d.mkdir()
        (d / "manifest.json").write_text(json.dumps({
            "id": "bad",
            "title": "Bad",
            "description": "Bad manifest",
            "version": "0",
            "runtime": "runtime:BadRuntime",
            "frontend_view": "bad/view",
            "settings_schema": {"x": {"type": "number"}},
        }))
        try:
            load_program_definitions(Path(tmp))
        except ProgramManifestError:
            return
        raise AssertionError("invalid manifest should fail validation")


def test_resolve_settings_defaults_and_clamps():
    schema = {
        "reward": {"type": "number", "default": 65, "min": 40, "max": 85, "step": 1},
        "mode": {"type": "enum", "default": "a", "options": ["a", "b"]},
    }
    assert resolve_settings(schema, {"reward": 120, "mode": "nope"}) == {
        "reward": 85,
        "mode": "a",
    }


def test_event_log_writes_canonical_jsonl():
    with tempfile.TemporaryDirectory() as tmp:
        event_log_module.SESSIONS = Path(tmp)
        rec = SessionRecorder()
        rec.start_recording()
        log = SessionEventLog(rec)
        event = log.append("ProgramParamsChanged", program_id="alpha_feedback", data={"x": 1})
        assert event is not None
        path = Path(tmp) / rec.recording_id / "session_events.jsonl"
        row = json.loads(path.read_text().splitlines()[0])
        assert row["type"] == "ProgramParamsChanged"
        assert row["program_id"] == "alpha_feedback"
        assert row["data"] == {"x": 1}
        assert isinstance(row["elapsed"], float)


def test_recorder_writes_program_outputs_jsonl_and_loader_reads_legacy_csv():
    with tempfile.TemporaryDirectory() as tmp:
        recorder_module.SESSIONS = Path(tmp)
        rec = SessionRecorder()
        rec.start_recording()
        rec.write_program_output(ProgramOutput(
            program_id="alpha_feedback",
            elapsed=1.25,
            status_text="ok",
            payload={"drives": {"clarity": 0.5}},
        ))
        out_dir = rec.stop_recording()
        assert out_dir is not None
        outputs_file = out_dir / "program_outputs.jsonl"
        assert outputs_file.exists()
        rows = load_program_outputs(out_dir)
        assert rows[0]["payload"]["drives"]["clarity"] == 0.5

        legacy_dir = Path(tmp) / "legacy"
        legacy_dir.mkdir()
        (legacy_dir / "program_output_trace.csv").write_text(
            "elapsed,program_id,status_text,clarity\n1.000,alpha_feedback,ok,0.5\n"
        )
        legacy_rows = load_program_outputs(legacy_dir)
        assert legacy_rows[0]["payload"]["clarity"] == "0.5"


def test_recorder_pending_save_and_discard():
    with tempfile.TemporaryDirectory() as tmp:
        recorder_module.SESSIONS = Path(tmp)
        rec = SessionRecorder()
        rec.start_recording()
        pending_id = rec.recording_id
        assert rec.stop_recording(save=False) is None
        assert pending_id is not None
        assert not (Path(tmp) / pending_id / "metadata.json").exists()

        saved = rec.save_stopped_recording(notes="felt calm")
        assert saved is not None
        assert (saved / "metadata.json").exists()
        note_files = list(saved.glob("*.md"))
        assert note_files
        assert "felt calm" in note_files[0].read_text()

        rec.start_recording()
        discard_id = rec.recording_id
        assert rec.stop_recording(save=False) is None
        assert rec.discard_stopped_recording() is True
        assert discard_id is not None
        assert not (Path(tmp) / discard_id).exists()


def test_recorder_writes_psd_history_and_opt_in_baseline():
    with tempfile.TemporaryDirectory() as tmp:
        recorder_module.SESSIONS = Path(tmp)
        rec = SessionRecorder()
        rec.start_recording()
        rec.write_psd_snapshot(
            elapsed=0.25,
            freqs=[0.0, 0.5, 1.0],
            values=[0.01, 0.1, 1.0],
        )
        saved = rec.stop_recording(save=True, include_psd_baseline=False)
        assert saved is not None
        psd_file = saved / "psd_history.jsonl"
        assert psd_file.exists()
        row = json.loads(psd_file.read_text().splitlines()[0])
        assert row["elapsed"] == 0.25
        assert row["freqs"] == [0.0, 0.5, 1.0]
        assert not (Path(tmp) / "psd_baseline_aggregate.json").exists()

        rec.start_recording()
        rec.write_psd_snapshot(
            elapsed=0.25,
            freqs=[0.0, 0.5, 1.0],
            values=[0.01, 0.1, 1.0],
        )
        saved = rec.stop_recording(save=True, include_psd_baseline=True)
        assert saved is not None
        baseline = load_psd_baseline(Path(tmp) / "psd_baseline_aggregate.json")
        assert len(baseline["counts"]) == len(baseline["freq_bins"])
        assert len(baseline["counts"][0]) == len(baseline["log_power_bins"])
        assert baseline["stats"]["n"][0] == 1
        assert baseline["stats"]["n"][1] == 1
        assert baseline["stats"]["n"][2] == 1


if __name__ == "__main__":
    test_program_manifests_validate()
    test_invalid_manifest_rejected()
    test_resolve_settings_defaults_and_clamps()
    test_event_log_writes_canonical_jsonl()
    test_recorder_writes_program_outputs_jsonl_and_loader_reads_legacy_csv()
    test_recorder_pending_save_and_discard()
    test_recorder_writes_psd_history_and_opt_in_baseline()
    print("All foundation tests passed")
