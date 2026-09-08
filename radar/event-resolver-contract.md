# Event resolver contract V1

`resolveRadarObservation()` consumes the result of `analyzeTileChange()` and returns one of `none`, `create`, or `update`.

`resolveEventExpirations()` separately returns `quiet` or `close` transitions for events whose `last_activity_at` exceeded the configured thresholds.

The module is pure: no network, no D1, no Cron, no Discord. Spatial matching uses WPlace world pixels derived from the existing 1000-pixel tile geometry.
