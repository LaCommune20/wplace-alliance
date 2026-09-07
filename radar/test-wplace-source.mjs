import assert from "node:assert/strict";
import { WPlaceTileSource } from "./wplace-source.js";

const fixture = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAAMIM/4EAAB/uBfsL2WiLAAAAAElFTkSuQmCC";
const fixtureBytes = Uint8Array.from(Buffer.from(fixture, "base64"));

const source = new WPlaceTileSource({
  baseUrl: "https://proxy.example.test",
  pathPrefix: "/radar-tile",
  tileSize: 2,
  cacheBust: true
});

assert.equal(
  source.tileUrl(12, 34, { fresh: false }),
  "https://proxy.example.test/radar-tile/12/34.png"
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /^https:\/\/proxy\.example\.test\/radar-tile\/12\/34\.png\?radar_ts=/);
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Accept, "image/png,image/*;q=0.8");
  return new Response(fixtureBytes, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(fixtureBytes.byteLength),
      etag: "\"fixture\""
    }
  });
};

try {
  const tile = await source.fetchTile(12, 34, { fresh: true });
  assert.equal(tile.tileX, 12);
  assert.equal(tile.tileY, 34);
  assert.equal(tile.width, 2);
  assert.equal(tile.height, 2);
  assert.equal(tile.rgba.length, 16);
  assert.equal(tile.etag, '"fixture"');
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Radar WPlace source tests: OK");
