# EEG Pattern Summary

- EDF: `exploratory EEG data/raw_edf/AidanBarbieux04292026edf.edf`
- Broad-band CSV: `exploratory EEG data/csv_exports/AidanBarbieux04292026edf_section_power_broad_bands.csv`
- Duration: `1168.0` sec
- Channels: `19`
- Sample rate: `256.0` Hz

## Standout Patterns

1. `T3-A1` is a clear raw-signal artifact during `EC_rest`: peak `50983.0 uV`, 95th percentile `20.8 uV`, and `1710` samples above `1000 uV`.
2. Posterior alpha behaves as expected: median alpha excluding `T3-A1` rises from `14.62` in `EO_rest` to `48.21` in `EC_rest`.
3. Frontal slow activity is strongest in eyes-open rest: mean frontal delta is `213.75` in `EO_rest` versus `32.44` in `EC_rest`.
4. Serial-7s periods show broader activation: median beta excluding `T3-A1` is `11.34` in `EO_serial7s` and `12.89` in `EC_serial7s`, both above eyes-open rest `7.78`.

## Alpha EO to EC

- `T3-A1` alpha `8.53 -> 21524.83` (`x2523.43`, `+21516.30`)
- `O1-A1` alpha `16.97 -> 160.35` (`x9.45`, `+143.38`)
- `O2-A1` alpha `26.60 -> 159.86` (`x6.01`, `+133.26`)
- `T5-A1` alpha `10.04 -> 54.55` (`x5.43`, `+44.51`)
- `P3-A1` alpha `20.17 -> 106.46` (`x5.28`, `+86.29`)
- `Pz-A1` alpha `22.74 -> 109.43` (`x4.81`, `+86.69`)
- `P4-A1` alpha `28.39 -> 102.58` (`x3.61`, `+74.19`)
- `Cz-A1` alpha `16.68 -> 58.48` (`x3.51`, `+41.80`)

## Clean-Section Medians

- `delta`: EO_rest=41.55, EO_serial7s=27.04, EC_rest=27.34, EC_serial7s=34.72
- `theta`: EO_rest=10.88, EO_serial7s=14.93, EC_rest=20.31, EC_serial7s=18.00
- `alpha`: EO_rest=14.62, EO_serial7s=24.39, EC_rest=48.21, EC_serial7s=31.69
- `beta`: EO_rest=7.78, EO_serial7s=11.34, EC_rest=14.82, EC_serial7s=12.89
- `gamma`: EO_rest=1.81, EO_serial7s=2.02, EC_rest=2.30, EC_serial7s=1.86

## Posterior Alpha Means

- `EO_rest` posterior alpha mean: `21.00`
- `EO_serial7s` posterior alpha mean: `42.93`
- `EC_rest` posterior alpha mean: `108.86`
- `EC_serial7s` posterior alpha mean: `61.78`

## Alpha Asymmetry

- `EO_rest`
  - `FP1-A1` vs `FP2-A1`: alpha `+0.13`, beta `+0.23`, theta `+2.26`
  - `F3-A1` vs `F4-A1`: alpha `+1.65`, beta `+0.61`, theta `+1.00`
  - `C3-A1` vs `C4-A1`: alpha `+14.02`, beta `+0.47`, theta `-0.32`
  - `P3-A1` vs `P4-A1`: alpha `-8.22`, beta `-0.96`, theta `-1.07`
  - `O1-A1` vs `O2-A1`: alpha `-9.63`, beta `-1.01`, theta `-0.83`
  - `F7-A1` vs `F8-A1`: alpha `+0.72`, beta `+0.76`, theta `-1.47`
  - `T3-A1` vs `T4-A1`: alpha `-0.37`, beta `+1.93`, theta `+0.15`
  - `T5-A1` vs `T6-A1`: alpha `-12.04`, beta `-1.14`, theta `-2.02`
- `EC_rest`
  - `FP1-A1` vs `FP2-A1`: alpha `+0.50`, beta `+1.80`, theta `-0.50`
  - `F3-A1` vs `F4-A1`: alpha `-0.28`, beta `-0.69`, theta `-0.47`
  - `C3-A1` vs `C4-A1`: alpha `+14.97`, beta `-0.74`, theta `-0.85`
  - `P3-A1` vs `P4-A1`: alpha `+3.88`, beta `-0.24`, theta `+0.12`
  - `O1-A1` vs `O2-A1`: alpha `+0.49`, beta `-2.33`, theta `-2.40`
  - `F7-A1` vs `F8-A1`: alpha `+0.81`, beta `-0.67`, theta `-1.92`
  - `T3-A1` vs `T4-A1`: alpha `+21502.09`, beta `+21778.69`, theta `+67677.55`
  - `T5-A1` vs `T6-A1`: alpha `-14.27`, beta `-1.90`, theta `-2.02`
- `EC_serial7s`
  - `FP1-A1` vs `FP2-A1`: alpha `-0.11`, beta `+0.84`, theta `-0.14`
  - `F3-A1` vs `F4-A1`: alpha `-0.05`, beta `-0.87`, theta `-1.37`
  - `C3-A1` vs `C4-A1`: alpha `+21.68`, beta `+0.26`, theta `-1.95`
  - `P3-A1` vs `P4-A1`: alpha `-4.90`, beta `-1.26`, theta `-0.56`
  - `O1-A1` vs `O2-A1`: alpha `-1.52`, beta `-1.38`, theta `-2.73`
  - `F7-A1` vs `F8-A1`: alpha `+1.09`, beta `-0.67`, theta `-2.33`
  - `T3-A1` vs `T4-A1`: alpha `-0.72`, beta `+0.46`, theta `-0.59`
  - `T5-A1` vs `T6-A1`: alpha `-15.71`, beta `-2.02`, theta `-2.02`

## Raw Artifact Watch

- `EO_rest`
  - `FP2-A1` peak `240.6 uV`, p95 `54.9 uV`, >100 `1431`, >200 `20`, >500 `0`, >1000 `0`
  - `FP1-A1` peak `238.5 uV`, p95 `58.0 uV`, >100 `1727`, >200 `44`, >500 `0`, >1000 `0`
  - `O1-A1` peak `196.1 uV`, p95 `15.4 uV`, >100 `11`, >200 `0`, >500 `0`, >1000 `0`
  - `F7-A1` peak `129.3 uV`, p95 `26.7 uV`, >100 `81`, >200 `0`, >500 `0`, >1000 `0`
  - `Fz-A1` peak `112.5 uV`, p95 `25.7 uV`, >100 `12`, >200 `0`, >500 `0`, >1000 `0`
- `EO_serial7s`
  - `FP1-A1` peak `111.4 uV`, p95 `37.0 uV`, >100 `6`, >200 `0`, >500 `0`, >1000 `0`
  - `FP2-A1` peak `98.0 uV`, p95 `33.9 uV`, >100 `0`, >200 `0`, >500 `0`, >1000 `0`
  - `Pz-A1` peak `55.6 uV`, p95 `19.8 uV`, >100 `0`, >200 `0`, >500 `0`, >1000 `0`
  - `O2-A1` peak `50.5 uV`, p95 `20.8 uV`, >100 `0`, >200 `0`, >500 `0`, >1000 `0`
  - `F3-A1` peak `49.7 uV`, p95 `20.8 uV`, >100 `0`, >200 `0`, >500 `0`, >1000 `0`
- `EC_rest`
  - `T3-A1` peak `50983.0 uV`, p95 `20.8 uV`, >100 `2525`, >200 `2287`, >500 `1955`, >1000 `1710`
  - `P4-A1` peak `358.3 uV`, p95 `25.7 uV`, >100 `5`, >200 `4`, >500 `0`, >1000 `0`
  - `T6-A1` peak `354.2 uV`, p95 `21.5 uV`, >100 `5`, >200 `4`, >500 `0`, >1000 `0`
  - `Pz-A1` peak `354.2 uV`, p95 `26.7 uV`, >100 `5`, >200 `4`, >500 `0`, >1000 `0`
  - `C4-A1` peak `350.1 uV`, p95 `18.7 uV`, >100 `5`, >200 `4`, >500 `0`, >1000 `0`
- `EC_serial7s`
  - `F8-A1` peak `132.1 uV`, p95 `16.4 uV`, >100 `3`, >200 `0`, >500 `0`, >1000 `0`
  - `F7-A1` peak `129.0 uV`, p95 `16.4 uV`, >100 `9`, >200 `0`, >500 `0`, >1000 `0`
  - `T3-A1` peak `117.6 uV`, p95 `16.7 uV`, >100 `6`, >200 `0`, >500 `0`, >1000 `0`
  - `F4-A1` peak `110.4 uV`, p95 `19.5 uV`, >100 `4`, >200 `0`, >500 `0`, >1000 `0`
  - `C4-A1` peak `107.3 uV`, p95 `18.7 uV`, >100 `4`, >200 `0`, >500 `0`, >1000 `0`
