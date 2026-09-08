# Radar — event resolver V1

This layer turns an already computed `scan-core` observation into an event lifecycle decision. It has no D1 dependency and does not classify the nature of a change.

## Decisions

- `none`: no changed pixels, therefore no event write;
- `create`: changed regions do not match a recent non-closed event;
- `update`: changed regions are spatially close to a recent active/quiet event;
- `quiet`: an active event has had no activity for the quiet threshold;
- `close`: an active/quiet event has had no activity for the close threshold.

## Spatial matching

A region is converted from tile-local coordinates to WPlace world-pixel coordinates:

`worldX = tileX * 1000 + localX`

`worldY = tileY * 1000 + localY`

Two regions match when the Euclidean gap between their bounding boxes is within `proximityPixels` (default 32).

## Time defaults

The resolver exposes defaults suitable for the current observation-mode prototype:

- proximity: 32 world pixels;
- quiet: 5 minutes;
- close: 15 minutes;
- reopen/match window: 15 minutes.

These are application defaults, not WPlace protocol facts. They remain configurable and must be validated against real Radar observations before the production scheduler is enabled.

## Important limitation

A scan of one tile cannot prove that an event has disappeared globally. `resolveEventExpirations()` therefore handles expiration as a separate sweep over known events. The future scheduler must call that sweep deliberately rather than closing an event merely because one scan contained no change.
