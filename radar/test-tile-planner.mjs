import assert from "node:assert/strict";
import { globalPixelToTile, planPolygon, planRectangle, tileRegionToGlobal } from "./tile-planner.js";

assert.deepEqual(planRectangle({ minX: 2, minY: 2, maxX: 11, maxY: 11 }, 10), [
  { tileX: 0, tileY: 0 },
  { tileX: 1, tileY: 0 },
  { tileX: 0, tileY: 1 },
  { tileX: 1, tileY: 1 }
]);

const triangle = [[2, 2], [8, 2], [5, 8]];
assert.deepEqual(planPolygon(triangle, 10), [{ tileX: 0, tileY: 0 }]);

assert.deepEqual(globalPixelToTile(25, 37, 10), {
  tileX: 2,
  tileY: 3,
  localX: 5,
  localY: 7
});

assert.deepEqual(tileRegionToGlobal(3, 4, {
  minX: 2,
  minY: 1,
  maxX: 8,
  maxY: 9
}, 10), {
  minX: 32,
  minY: 41,
  maxX: 38,
  maxY: 49
});

console.log("Radar tile-planner tests: OK");
