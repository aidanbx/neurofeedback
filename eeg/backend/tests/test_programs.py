"""Unit tests for program runtimes with synthetic MetricsSnapshot input."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from eeg_backend.contracts import BandFeature, MetricsSnapshot
from eeg_backend.programs.alpha_feedback.runtime import AlphaFeedbackRuntime
from eeg_backend.programs.alpha_theta_beta.runtime import AlphaThetaBetaRuntime
from eeg_backend.programs.alpha_theta_feedback.runtime import AlphaThetaFeedbackRuntime
from eeg_backend.programs.smr_feedback.runtime import SMRFeedbackRuntime


def make_band(smoothed: float, ready: bool = True, n: int = 50) -> BandFeature:
    return BandFeature(
        absolute=0.5,
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


def make_snap(alpha=0.5, smr=-0.1, theta=-0.3, beta=-0.3, hi_beta=-0.5, delta=0.0, quality=85.0, artifact=0.05) -> MetricsSnapshot:
    return MetricsSnapshot(
        elapsed_sec=10.0,
        quality_score=quality,
        quality_label="good",
        artifact_fraction=artifact,
        common_mode_corr=0.1,
        slow_wave_ratio=0.2,
        line_noise_ratio=0.05,
        psd_freqs=[1.0, 5.0, 10.0],
        psd_values=[0.1, 0.5, 1.0],
        raw_psd_freqs=[1.0, 5.0, 10.0],
        raw_psd_values=[0.1, 0.5, 1.0],
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
    print("All tests passed")
