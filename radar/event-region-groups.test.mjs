import assert from "node:assert/strict";
import { groupRegionsByProximity, regionsAreClose } from "./event-region-groups.js";

const a = { tile_x: 1057, tile_y: 751, min_x: 990, min_y: 500, max_x: 999, max_y: 500 };
const b = { tile_x: 1058, tile_y: 751, min_x: 0, min_y: 500, max_x: 5, max_y: 500 };
const c = { tile_x: 1058, tile_y: 751, min_x: 500, min_y: 500, max_x: 505, max_y: 505 };
const d = { tile_x: 1058, tile_y: 751, min_x: 700, min_y: 700, max_x: 705, max_y: 705 };

assert.equal(regionsAreClose(a, b, 32), true);
assert.equal(regionsAreClose(a, c, 32), false);

const groups = groupRegionsByProximity([a, b, c, d], 32);
assert.equal(groups.length, 3);
assert.equal(groups[0].length, 2);
assert.equal(groups[1].length, 1);
assert.equal(groups[2].length, 1);

const transitiveA = { tile_x: 100, tile_y: 200, min_x: 0, min_y: 0, max_x: 0, max_y: 0 };
const transitiveB = { tile_x: 100, tile_y: 200, min_x: 30, min_y: 0, max_x: 30, max_y: 0 };
const transitiveC = { tile_x: 100, tile_y: 200, min_x: 60, min_y: 0, max_x: 60, max_y: 0 };
const transitive = groupRegionsByProximity([transitiveA, transitiveB, transitiveC], 32);
assert.equal(transitive.length, 1);
assert.equal(transitive[0].length, 3);

assert.deepEqual(groupRegionsByProximity([], 32), []);
console.log("Radar event-region-groups tests: OK");
