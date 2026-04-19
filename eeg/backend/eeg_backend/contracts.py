"""Shared data contracts between all backend layers and frontend."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RawFrame:
    samples: list[list[float]]  # [sample_idx][channel_idx], microvolts
    source: str                 # "ble" | "replay"


@dataclass
class BandPowers:
    delta:   float = 0.0
    theta:   float = 0.0
    alpha:   float = 0.0
    smr:     float = 0.0
    beta:    float = 0.0
    hi_beta: float = 0.0


@dataclass
class ProcessedFrame:
    psd_freqs:              list[float]
    psd_values:             list[float]
    absolute:               BandPowers
    relative:               BandPowers
    absolute_training:      BandPowers
    relative_4_30_training: BandPowers
    quality_score:          float
    quality_label:          str           # "good" | "fair" | "poor"
    artifact_fraction:      float
    live_trace_t:           list[float]
    live_trace_y:           list[float]


@dataclass
class BandFeature:
    absolute:          float
    log_absolute:      float
    baseline_delta:    float
    baseline_zscore:   float
    smoothed:          float
    baseline_ready:    bool
    baseline_n:        int
    baseline_n_needed: int


@dataclass
class MetricsSnapshot:
    elapsed_sec:       float
    quality_score:     float
    quality_label:     str
    artifact_fraction: float
    psd_freqs:         list[float]
    psd_values:        list[float]
    live_trace_t:      list[float]
    live_trace_y:      list[float]
    bands: dict[str, BandFeature]   # "Delta","Theta","Alpha","SMR","Beta","Hi-Beta"
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProgramOutput:
    program_id:  str
    elapsed:     float
    status_text: str
    payload:     dict[str, Any]     # program-defined; flattened to program_output_trace.csv
