import assert from "node:assert/strict";
import {
  enumerateTilesForRectangle,
  enumerateTilesForWorldPolygon,
  pointInPolygon,
  polygonIntersectsRect
} from "./scan-planner.js";

assert.deepEqual(
  enumerateTilesForRectangle({ minX: 1, minY: 1, maxX: 19, maxY: 19 }, 10),
  [
    { tileX: 0, tileY: 0 },
    { tileX: 1, tileY: 0 },
    { tileX: 0, tileY: 1 },
    { tileX: 1, tileY: 1 }
  ]
);

const square = [
  [2, 2],
  [8, 2],
  [8, 8],
  [2, 8]
];

assert.deepEqual(enumerateTilesForWorldPolygon(square, 10), [{ tileX: 0, tileY: 0 }]);
assert.equal(pointInPolygon([5, 5], square), true);
assert.equal(pointInPolygon([9, 9], square), false);
assert.equal(
  polygonIntersectsRect(square, { minX: 8, minY: 0, maxX: 10, maxY: 10 }),
  true,
  "touching a tile boundary must count as an intersection"
);

const diagonal = [
  [5, 0],
  [15, 0],
  [15, 15],
  [5, 15]
];

assert.deepEqual(enumerateTilesForWorldPolygon(diagonal, 10), [
  { tileX: 0, tileY: 0 },
  { tileX: 1, tileY: 0 },
  { tileX: 0, tileY: 1 },
  { tileX: 1, tileY: 1 }
]);

console.log("scan-planner tests: OK");
