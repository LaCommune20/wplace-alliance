import assert from "node:assert/strict";
import { MemoryBaselineStore } from "./baseline-store.js";
import { RadarScanRunner } from "./scan-runner.js";

function tile(fill, tileX = 0, tileY = 0) {
  return {
    tileX,
    tileY,
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
    return tile(changed ? 2 : 1, tileX, tileY);
  }
};

const runner = new RadarScanRunner(source, {
  radarId: "test-radar",
  concurrency: 1,
  analysisOptions: { minRegionPixels: 1 }
});

const first = await runner.scanTiles([{ tileX: 0, tileY: 0 }]);
assert.equal(first.status, "committed");
assert.equal(first.requestedTiles, 1);
assert.equal(first.baselineTiles, 1);
assert.equal(first.changedTiles, 0);

changed = true;
const second = await runner.scanTiles([{ tileX: 0, tileY: 0 }]);
assert.equal(second.status, "committed");
assert.equal(second.scannedTiles, 1);
assert.equal(second.changedTiles, 1);
assert.equal(second.results[0].summary.changedPixels, 4);
assert.deepEqual(calls, ["0/0", "0/0"]);

const failureState = { failTileY: null };
const failureSource = {
  tileSize: 2,
  worldSize: 4,
  async fetchTile(tileX, tileY) {
    if (tileY === failureState.failTileY) {
      throw new Error(`simulated failure ${tileX}/${tileY}`);
    }
    return tile(1, tileX, tileY);
  }
};

const failureStore = new MemoryBaselineStore();
const failureRunner = new RadarScanRunner(failureSource, {
  radarId: "incomplete-radar",
  baselineStore: failureStore,
  concurrency: 1,
  analysisOptions: { minRegionPixels: 1 }
});

const tiles = [
  { tileX: 0, tileY: 0 },
  { tileX: 1, tileY: 0 }
];

const baseline = await failureRunner.scanTiles(tiles);
assert.equal(baseline.status, "committed");
assert.equal(baseline.baselineTiles, 2);

failureState.failTileY = 0;
const incomplete = await failureRunner.scanTiles(tiles);
assert.equal(incomplete.status, "failed");
assert.equal(incomplete.errorTiles, 1);

const currentAfterFailure = await failureStore.getCurrent("incomplete-radar");
assert.equal(currentAfterFailure.tileCount, 2);

failureState.failTileY = null;
const afterFailure = await failureRunner.scanTiles(tiles);
assert.equal(afterFailure.status, "committed");
assert.equal(afterFailure.changedTiles, 2);
assert.equal(afterFailure.scannedTiles, 2);

console.log("scan-runner tests: OK");
