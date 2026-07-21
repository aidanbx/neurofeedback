# NF-7: Cap waveform display bounds at +/-25uv

Set the React waveform canvas y-axis to fixed `-25µV` through `25µV` bounds by replacing its percentile-derived dynamic scale in `eeg/frontend/src/components/graphs/Waveform.tsx`. Remove any now-unused percentile helper. Verify the frontend TypeScript build still passes.
