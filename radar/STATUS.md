# Radar Lab — status

Branch: `feat/radar-lab`

The lab currently validates the software-side part of the pipeline without touching production data.

## Ready

- PNG parsing
- RGBA normalization
- tile diff
- changed-region extraction
- score calculation
- deterministic tests
- CI workflow
- fresh proxy contract documentation

## Waiting on the proxy Worker

The dedicated `/radar-tile/X/Y.png` endpoint must be implemented in the separate Cloudflare proxy source before a real WPlace scan can be run.

## Deliberately postponed

- Cron every 2 minutes
- D1 writes
- Discord notifications
- automatic alert mode
- ally/grief classification

These are intentionally downstream of real-tile validation.
