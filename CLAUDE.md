# Biofeedback Experiments

IronBCI EEG experiments and test scripts.

## Environment

```bash
conda activate eeg
```

Dependencies: `bleak numpy matplotlib scipy`

## Running

```bash
conda activate eeg
python experiments/test_connection.py
```

## Structure

- `test_connection.py` — scan, connect, stream 5s, print per-channel stats and GATT service table
- SDK reference code lives in `ironbci/SDK/BLE_General/`
- Firmware source lives in `ironbci firmware/`

## Key BLE Details

- Device name: `EAREEG`
- Notify UUID (data stream): `0000fe42-8e22-4541-9d4c-21edae82ed19`
- Write UUID (commands): `0000fe41-8e22-4541-9d4c-21edae82ed19`
- Data format: 120 bytes per notification = 5 samples x 8 channels x 3 bytes (24-bit signed)
