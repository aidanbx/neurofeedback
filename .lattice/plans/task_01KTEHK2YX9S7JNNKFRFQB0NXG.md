# NF-10: Investigate slow-wave drive not muting audio

Trace why the master feedback slow-wave band can show high drive above threshold while the inhibit activation line and audio mute do not engage. Inspect the master feedback runtime payload fields, frontend audio consumer, and reproduce with synthetic runtime ticks. Record the cause and likely fix; do not change behavior in this diagnostic pass unless explicitly requested.
