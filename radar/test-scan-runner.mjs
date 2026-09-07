import assert from "node:assert/strict";
import { RadarScanRunner } from "./scan-runner.js";

function tile(fill) {
  return {
    width: 2,
    height: 2,
    rgba: new Uint8Array([
      fill, fill, fill, 255,
      fill, fill, fill, 255,
      fill, fill, fill, 255,
      fill, fill, fill, 255
    ])
  };
}

const calls = [];
let changed = false;
const source = {
  tileSize: 2,
  worldSize: 4,
  async fetchTile(tileX, tileY) {
    calls.push(`${tileX}/${tileY}`);
    return { tileX, tileY, ...(changed ? tile(2) : tile(1)) };
  }
};

const runner = new RadarScanRunner(source, { concurrency: 1, analysisOptions: { minRegionPixels: 1 } });

const first = await runner.scanRectangle({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
assert.equal(first.requestedTiles, 1);
assert.equal(first.baselineTiles, 1);
assert.equal(first.changedTiles, 0);

changed = true;
const second = await runner.scanRectangle({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
assert.equal(second.scannedTiles, 1);
assert.equal(second.changedTiles, 1);
assert.equal(second.results[0].summary.changedPixels, 4);
assert.deepEqual(calls, ["0/0", "0/0"]);

console.log("scan-runner tests: OK");
