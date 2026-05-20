"""Unit tests for program runtimes with synthetic MetricsSnapshot input."""
import json
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from eeg_backend.contracts import BandFeature, MetricsSnapshot
from eeg_backend.programs.alpha_feedback.runtime import AlphaFeedbackRuntime
from eeg_backend.programs.alpha_theta_beta.runtime import AlphaThetaBetaRuntime
from eeg_backend.programs.alpha_theta_feedback.runtime import AlphaThetaFeedbackRuntime
from eeg_backend.programs.master_feedback.runtime import MasterFeedbackRuntime
from eeg_backend.programs.smr_feedback.runtime import SMRFeedbackRuntime


def make_band(smoothed: float, ready: bool = True, n: int = 50) -> BandFeature:
    return BandFeature(
        absolute=float(math.exp(smoothed)),
        relative_1_30=20.0,
        relative_4_30=20.0,
        log_absolute=smoothed,
        baseline_delta=smoothed,
        baseline_zscore=smoothed,
        smoothed=smoothed,
        baseline_ready=ready,
        baseline_n=n,
        baseline_n_needed=30,
    )


def make_snap(alpha=0.5, smr=-0.1, theta=-0.3, beta=-0.3, hi_beta=-0.5, delta=0.0, quality=85.0, artifact=0.05, psd_override=None) -> MetricsSnapshot:
    psd_pairs = psd_override or [(1.0, 0.1), (5.0, 0.5), (10.0, 1.0)]
    return MetricsSnapshot(
        elapsed_sec=10.0,
        quality_score=quality,
        quality_label="good",
        artifact_fraction=artifact,
        common_mode_corr=0.1,
        slow_wave_ratio=0.2,
        line_noise_ratio=0.05,
        psd_freqs=[freq for freq, _ in psd_pairs],
        psd_values=[value for _, value in psd_pairs],
        raw_psd_freqs=[freq for freq, _ in psd_pairs],
        raw_psd_values=[value for _, value in psd_pairs],
        live_trace_t=[0.0, 0.1, 0.2],
        live_trace_y=[1.0, 2.0, 3.0],
        bands={
            "Delta":   make_band(delta, ready=False),
            "Theta":   make_band(theta),
            "Alpha":   make_band(alpha),
            "SMR":     make_band(smr),
            "Beta":    make_band(beta),
            "Hi-Beta": make_band(hi_beta),
        },
        params={"metric_mode": "log_absolute"},
    )


def test_alpha_feedback_starts_immediately():
    rt = AlphaFeedbackRuntime()
    snap = make_snap()
    out = rt.tick(snap, 5.0)
    assert out.program_id == "alpha_feedback"
    assert "mode" in out.payload
    assert out.payload["mode"] == "starting"
    assert 0 <= out.payload["drives"]["clarity"] <= 1


def test_alpha_feedback_rolling_after_samples():
    rt = AlphaFeedbackRuntime()
    rt.set_params({"threshold_window_sec": 10})
    for i in range(65):
        snap = make_snap(alpha=0.5 + (i % 10) * 0.01)
        rt.tick(snap, float(i))
    out = rt.tick(make_snap(alpha=0.8), 65.0)
    assert out.payload["mode"] == "rolling"
    assert 0 <= out.payload["drives"]["clarity"] <= 1


def test_alpha_feedback_inhibit():
    rt = AlphaFeedbackRuntime()
    # High theta should trigger inhibit
    snap = make_snap(alpha=1.0, theta=2.0)
    out = rt.tick(snap, 1.0)
    assert "inhibit_active" in out.payload
    assert "clarity" in out.payload["drives"]


def test_alpha_theta_beta_produces_three_drives():
    rt = AlphaThetaBetaRuntime()
    snap = make_snap()
    out = rt.tick(snap, 5.0)
    assert out.program_id == "alpha_theta_beta"
    drives = out.payload["drives"]
    assert "alpha" in drives
    assert "theta" in drives
    assert "beta" in drives
    for v in drives.values():
        assert 0 <= v <= 1


def test_alpha_theta_feedback_produces_two_drives():
    rt = AlphaThetaFeedbackRuntime()
    out = rt.tick(make_snap(), 5.0)
    assert out.program_id == "alpha_theta_feedback"
    drives = out.payload["drives"]
    assert set(drives) == {"alpha", "theta"}
    for v in drives.values():
        assert 0 <= v <= 1


def test_alpha_theta_feedback_inhibits_on_beta_plus():
    rt = AlphaThetaFeedbackRuntime()
    rt.set_params({"threshold_window_sec": 1})
    for i in range(6):
        rt.tick(make_snap(alpha=0.8, theta=0.6, beta=-1.2, hi_beta=-1.4), i * 0.2)
    out = rt.tick(make_snap(alpha=0.8, theta=0.6, beta=0.8, hi_beta=0.9), 1.2)
    assert out.payload["beta_inhibit"] is True
    assert out.payload["inhibit_active"] is True


def test_alpha_theta_feedback_zero_slow_inhibit_disables_slow_gate():
    rt = AlphaThetaFeedbackRuntime()
    rt.set_params({"threshold_window_sec": 1, "slow_inhibit_pct": 0, "beta_inhibit_pct": 0})
    for i in range(6):
        rt.tick(make_snap(alpha=0.8, theta=0.6, delta=-1.4, beta=-1.2, hi_beta=-1.4), i * 0.2)
    out = rt.tick(make_snap(alpha=0.8, theta=0.6, delta=2.0, beta=-1.2, hi_beta=-1.4), 1.2)
    assert out.payload["slow_inhibit"] is False
    assert out.payload["inhibit_active"] is False


def test_program_reset_clears_calibration():
    rt = AlphaFeedbackRuntime()
    for i in range(25):
        rt.tick(make_snap(), float(i))
    rt.reset()
    out = rt.tick(make_snap(), 0.0)
    assert out.payload["mode"] == "starting"


def test_smr_feedback_starts_and_produces_clarity():
    rt = SMRFeedbackRuntime()
    out = rt.tick(make_snap(), 5.0)
    assert out.program_id == "smr_feedback"
    assert out.payload["mode"] == "starting"
    assert 0 <= out.payload["drives"]["clarity"] <= 1


def test_smr_feedback_rewards_immediately_when_conditions_match():
    rt = SMRFeedbackRuntime()
    rt.set_params({"threshold_window_sec": 1})
    for i in range(6):
        rt.tick(make_snap(smr=0.2, theta=-0.8, hi_beta=-1.0), i * 0.2)
    out_reward = rt.tick(make_snap(smr=0.9, theta=-1.2, hi_beta=-1.4), 1.1)
    assert out_reward.payload["reward_active"] is True


def test_smr_feedback_inhibits_on_hi_beta():
    rt = SMRFeedbackRuntime()
    rt.set_params({"threshold_window_sec": 1})
    for i in range(6):
        rt.tick(make_snap(theta=-1.2, hi_beta=-1.4), i * 0.2)
    out = rt.tick(make_snap(theta=-1.2, hi_beta=0.8), 1.2)
    assert out.payload["hibeta_inhibit"] is True
    assert out.payload["inhibit_active"] is True


def test_master_feedback_loads_existing_program_presets():
    rt = MasterFeedbackRuntime()
    for preset in ("alpha_feedback", "alpha_theta_beta", "alpha_theta_feedback", "smr_feedback", "debug"):
        rt.set_params({"preset": preset, "threshold_window_sec": 1})
        out = rt.tick(make_snap(), 1.2)
        assert out.program_id == "master_feedback"
        assert out.payload["preset"] == preset
        assert len(out.payload["bands"]) > 0
        assert set(out.payload["drives"]) == {band["id"] for band in out.payload["bands"]}


def test_master_feedback_defaults_to_alpha_theta():
    rt = MasterFeedbackRuntime()
    params = rt.get_params()
    bands = {band["id"]: band for band in out_bands(params["bands_json"])}
    assert params["preset"] == "alpha_theta_feedback"
    assert list(bands) == ["alpha", "theta", "slow", "beta"]
    assert bands["alpha"]["target_pct"] == 65.0
    assert bands["theta"]["target_pct"] == 65.0
    assert bands["alpha"]["feature"] == "log_power"
    assert bands["theta"]["feature"] == "log_power"
    assert bands["slow"]["role"] == "inhibit"
    assert bands["slow"]["target_pct"] == 15.0
    assert bands["slow"]["dwell_sec"] == 0.5
    assert bands["slow"]["feature"] == "log_power"
    assert bands["beta"]["role"] == "inhibit"
    assert bands["beta"]["target_pct"] == 15.0
    assert bands["beta"]["dwell_sec"] == 0.5
    assert bands["beta"]["feature"] == "log_power"


def out_bands(bands_json: str):
    return json.loads(bands_json)


def test_master_feedback_accepts_custom_band_json():
    rt = MasterFeedbackRuntime()
    rt.set_params({
        "preset": "custom",
        "bands_json": '[{"id":"custom_alpha","label":"10-13 Hz","lo_hz":10,"hi_hz":13,"role":"reward","direction":"above","target_pct":50,"feature":"log_power"}]',
    })
    out = rt.tick(make_snap(), 5.0)
    assert out.payload["preset"] == "custom"
    assert out.payload["bands"][0]["id"] == "custom_alpha"
    assert out.payload["bands"][0]["lo_hz"] == 10.0
    assert out.payload["bands"][0]["feature"] == "log_power"


def test_master_feedback_coerces_custom_features_to_log_power():
    rt = MasterFeedbackRuntime()
    rt.set_params({
        "preset": "custom",
        "bands_json": '[{"id":"alpha","label":"Alpha","lo_hz":8,"hi_hz":12,"role":"reward","direction":"above","target_pct":65,"feature":"smoothed"},{"id":"theta","label":"Theta","lo_hz":4,"hi_hz":8,"role":"reward","direction":"above","target_pct":65,"feature":"absolute_power"}]',
    })
    out = rt.tick(make_snap(), 5.0)
    assert [band["feature"] for band in out.payload["bands"]] == ["log_power", "log_power"]


def test_master_feedback_starting_threshold_uses_all_available_history():
    rt = MasterFeedbackRuntime()
    rt.set_params({
        "preset": "custom",
        "threshold_window_sec": 60,
        "bands_json": '[{"id":"alpha","label":"Alpha","lo_hz":8,"hi_hz":12,"role":"reward","direction":"above","target_pct":25,"feature":"log_power"}]',
    })
    for elapsed in (0.0, 1.0, 2.0):
        rt.tick(make_snap(alpha=0.0), elapsed)
    out = rt.tick(make_snap(alpha=10.0), 10.0)
    band = out.payload["bands"][0]
    assert out.payload["mode"] == "starting"
    assert band["threshold"] > 0.0
    assert band["threshold"] < band["value"]
    assert band["drive"] > 0.0


def test_master_feedback_preset_change_overrides_stale_bands_json():
    rt = MasterFeedbackRuntime()
    stale = rt.get_params()["bands_json"]
    rt.set_params({"preset": "alpha_theta_beta", "bands_json": stale})
    out = rt.tick(make_snap(), 5.0)
    assert out.payload["preset"] == "alpha_theta_beta"
    assert [band["id"] for band in out.payload["bands"]] == ["alpha", "theta", "beta"]
    assert all(band["role"] == "reward" for band in out.payload["bands"])


def test_master_feedback_hold_requires_full_window():
    rt = MasterFeedbackRuntime()
    rt.set_params({
        "preset": "custom",
        "threshold_window_sec": 1,
        "bands_json": '[{"id":"slow","label":"Slow","lo_hz":0.5,"hi_hz":4,"role":"inhibit_sfx","direction":"above","target_pct":50,"dwell_sec":2,"feature":"log_power"}]',
    })
    for i in range(6):
        rt.tick(make_snap(delta=0.0, psd_override=[(1.0, 1.0)]), i * 0.2)
    early = rt.tick(make_snap(delta=2.0, psd_override=[(1.0, 10.0)]), 1.2)
    assert early.payload["bands"][0]["active"] is False
    for elapsed in (1.6, 2.0, 2.4, 2.8, 3.2):
        late = rt.tick(make_snap(delta=2.0, psd_override=[(1.0, 10.0)]), elapsed)
    assert late.payload["bands"][0]["active"] is True


def test_master_feedback_alpha_theta_beta_inhibit_uses_dwell_timer():
    rt = MasterFeedbackRuntime()
    rt.set_params({"preset": "alpha_theta_feedback", "threshold_window_sec": 1})
    for i in range(6):
        rt.tick(make_snap(alpha=0.8, theta=0.6, beta=1.0, hi_beta=0.9), i * 0.2)
    reset = rt.tick(make_snap(alpha=0.8, theta=0.6, beta=-2.0, hi_beta=-2.1), 1.2)
    assert reset.payload["gates"]["beta"] is False
    early = rt.tick(make_snap(alpha=0.8, theta=0.6, beta=1.0, hi_beta=0.9), 1.4)
    assert early.payload["gates"]["beta"] is False
    late = early
    for elapsed in (1.6, 1.8, 2.0):
        late = rt.tick(make_snap(alpha=0.8, theta=0.6, beta=1.0, hi_beta=0.9), elapsed)
    assert late.payload["gates"]["beta"] is True
    assert late.payload["inhibit_active"] is True


if __name__ == "__main__":
    test_alpha_feedback_starts_immediately()
    test_alpha_feedback_rolling_after_samples()
    test_alpha_feedback_inhibit()
    test_alpha_theta_beta_produces_three_drives()
    test_alpha_theta_feedback_produces_two_drives()
    test_alpha_theta_feedback_inhibits_on_beta_plus()
    test_alpha_theta_feedback_zero_slow_inhibit_disables_slow_gate()
    test_program_reset_clears_calibration()
    test_smr_feedback_starts_and_produces_clarity()
    test_smr_feedback_rewards_immediately_when_conditions_match()
    test_smr_feedback_inhibits_on_hi_beta()
    test_master_feedback_loads_existing_program_presets()
    test_master_feedback_defaults_to_alpha_theta()
    test_master_feedback_accepts_custom_band_json()
    test_master_feedback_coerces_custom_features_to_log_power()
    test_master_feedback_starting_threshold_uses_all_available_history()
    test_master_feedback_preset_change_overrides_stale_bands_json()
    test_master_feedback_hold_requires_full_window()
    test_master_feedback_alpha_theta_beta_inhibit_uses_dwell_timer()
    print("All tests passed")
