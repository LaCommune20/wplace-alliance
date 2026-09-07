import assert from "node:assert/strict";
import { analyzeTileChange } from "./scan-core.js";

function tile(width, height, rgba) {
  return { width, height, rgba: Uint8Array.from(rgba) };
}

const unchanged = tile(4, 1, [
  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255
]);

const changed = tile(4, 1, [
  255, 0, 0, 255,
  0, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255
]);

const noChange = analyzeTileChange(unchanged, unchanged);
assert.equal(noChange.changed, false);
assert.equal(noChange.summary.changedPixels, 0);

const result = analyzeTileChange(unchanged, changed, {
  minRegionPixels: 1,
  alertThreshold: 1,
  urgencyThreshold: 1000
});

assert.equal(result.changed, true);
assert.equal(result.summary.changedPixels, 3);
assert.equal(result.summary.regionCount, 3);
assert.equal(result.severity, "alert");
assert.deepEqual(result.regions, [
  { pixelCount: 1, minX: 0, minY: 0, maxX: 0, maxY: 0 },
  { pixelCount: 1, minX: 2, minY: 0, maxX: 2, maxY: 0 },
  { pixelCount: 1, minX: 3, minY: 0, maxX: 3, maxY: 0 }
]);

console.log("Radar scan-core tests: OK");
