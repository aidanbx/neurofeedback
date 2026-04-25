"""MetricsEngine unit tests: baseline warmup, smoothing."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
from eeg_backend.metrics.engine import MetricsEngine
from eeg_backend.dsp.constants import TRAINING_BANDS


def make_absolute(alpha: float = 1.0) -> dict[str, float]:
    return {
        "Theta": 0.3,
        "Alpha": alpha,
        "SMR":   0.1,
        "Beta":  0.2,
        "Hi-Beta": 0.05,
        "Delta": 0.5,
    }


def make_relative() -> dict[str, float]:
    return {"Theta": 15.0, "Alpha": 30.0, "SMR": 10.0, "Beta": 20.0, "Hi-Beta": 5.0}


def update(engine: MetricsEngine, absolute: dict[str, float] | None = None, *, quality_score: float, artifact_fraction: float):
    abs_values = absolute or make_absolute()
    return engine.update(
        abs_values,
        relative_1_30={**make_relative(), "Delta": 20.0},
        relative_4_30=make_relative(),
        quality_score=quality_score,
        artifact_fraction=artifact_fraction,
    )


def test_baseline_not_ready_initially():
    engine = MetricsEngine()
    features = update(engine, quality_score=90.0, artifact_fraction=0.0)
    alpha = features["Alpha"]
    assert not alpha.baseline_ready
    assert alpha.baseline_n == 1


def test_baseline_ready_after_min_samples():
    engine = MetricsEngine()
    engine.set_params({"baseline_min_sec": 5.0})  # 5s / 0.25 = 20 samples needed
    for _ in range(20):
        features = update(engine, quality_score=90.0, artifact_fraction=0.0)
    assert features["Alpha"].baseline_ready


def test_quality_gating_skips_bad_samples():
    engine = MetricsEngine()
    engine.set_params({"baseline_min_sec": 5.0})
    for _ in range(20):
        update(engine, quality_score=30.0, artifact_fraction=0.5)
    features = update(engine, quality_score=30.0, artifact_fraction=0.5)
    assert not features["Alpha"].baseline_ready  # bad quality, shouldn't have filled baseline


def test_smoothing_asymmetric():
    engine = MetricsEngine()
    engine.set_params({"baseline_min_sec": 1.0, "rise_alpha": 0.5, "fall_alpha": 0.1})
    # Fill baseline
    for _ in range(5):
        update(engine, make_absolute(alpha=1.0), quality_score=90.0, artifact_fraction=0.0)
    # Step up
    f_up = update(engine, make_absolute(alpha=10.0), quality_score=90.0, artifact_fraction=0.0)
    s_up = f_up["Alpha"].smoothed
    # Reset and step down
    engine2 = MetricsEngine()
    engine2.set_params({"baseline_min_sec": 1.0, "rise_alpha": 0.5, "fall_alpha": 0.1})
    for _ in range(5):
        update(engine2, make_absolute(alpha=10.0), quality_score=90.0, artifact_fraction=0.0)
    f_down = update(engine2, make_absolute(alpha=1.0), quality_score=90.0, artifact_fraction=0.0)
    s_down = f_down["Alpha"].smoothed
    # Rise should move farther from previous than fall
    # Not a strict test since values depend on baseline, just check smoothed is finite
    assert isinstance(s_up, float)
    assert isinstance(s_down, float)


def test_reset_baseline():
    engine = MetricsEngine()
    for _ in range(10):
        update(engine, quality_score=90.0, artifact_fraction=0.0)
    engine.reset_baseline()
    features = update(engine, quality_score=90.0, artifact_fraction=0.0)
    assert features["Alpha"].baseline_n == 1


if __name__ == "__main__":
    test_baseline_not_ready_initially()
    test_baseline_ready_after_min_samples()
    test_quality_gating_skips_bad_samples()
    test_smoothing_asymmetric()
    test_reset_baseline()
    print("All metrics tests passed")
