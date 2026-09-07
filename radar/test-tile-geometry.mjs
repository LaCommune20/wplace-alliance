import assert from "node:assert/strict";
import {
  enumerateTilesForBounds,
  lngLatToWorldPixel,
  regionToWorldBounds,
  tilePixelToWorld,
  worldPixelToLngLat
} from "./tile-geometry.js";

assert.deepEqual(tilePixelToWorld(3, 4, 7, 9, 10), { x: 37, y: 49 });
assert.deepEqual(
  regionToWorldBounds(3, 4, { minX: 2, minY: 5, maxX: 8, maxY: 9 }, 10),
  { minX: 32, minY: 45, maxX: 38, maxY: 49 }
);
assert.deepEqual(
  enumerateTilesForBounds({ minX: 9, minY: 19, maxX: 21, maxY: 20 }, 10),
  [
    { tileX: 0, tileY: 1 },
    { tileX: 1, tileY: 1 },
    { tileX: 2, tileY: 1 },
    { tileX: 0, tileY: 2 },
    { tileX: 1, tileY: 2 },
    { tileX: 2, tileY: 2 }
  ]
);

const world = lngLatToWorldPixel(5.37224, 43.369566);
const geo = worldPixelToLngLat(world.x, world.y);
assert.ok(Math.abs(geo.lng - 5.37224) < 1e-9);
assert.ok(Math.abs(geo.lat - 43.369566) < 1e-9);

const origin = lngLatToWorldPixel(-180, 0);
assert.equal(origin.x, 0);
assert.ok(Math.abs(origin.y - 1024000) < 1e-9);

console.log("Radar tile-geometry tests: OK");
