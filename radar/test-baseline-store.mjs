import assert from "node:assert/strict";
import { MemoryBaselineStore } from "./baseline-store.js";

function tile(tileX, tileY, fill = 1) {
  return {
    tileX,
    tileY,
    width: 1,
    height: 1,
    rgba: new Uint8Array([fill, fill, fill, 255])
  };
}

const store = new MemoryBaselineStore();
const tiles = [
  { tileX: 0, tileY: 0 },
  { tileX: 1, tileY: 0 }
];

const candidate = await store.createCandidate("radar-1", tiles);
await store.putTile(candidate, tile(0, 0));
await assert.rejects(
  () => store.finalizeCandidate(candidate),
  /incomplet|incomplete/i
);

await store.putTile(candidate, tile(1, 0));
const finalized = await store.finalizeCandidate(candidate);
const committed = await store.commitCandidate(finalized);
assert.equal(committed.radarId, "radar-1");
assert.equal(committed.tileCount, 2);
assert.equal((await store.getCurrent("radar-1")).tileCount, 2);
assert.equal((await store.getTile("radar-1", 1, 0)).rgba[0], 1);

const aborted = await store.createCandidate("radar-1", tiles);
await store.putTile(aborted, tile(0, 0, 9));
await store.abortCandidate(aborted);
assert.equal((await store.getCurrent("radar-1")).version, committed.version);
assert.equal((await store.getTile("radar-1", 0, 0)).rgba[0], 1);

console.log("baseline-store tests: OK");
