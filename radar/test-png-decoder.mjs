import assert from "node:assert/strict";
import { decodePng } from "./png-decoder.js";

// 2x2 RGB PNG: red, green / blue, white.
const fixture = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAAMIM/4EAAB/uBfsL2WiLAAAAAElFTkSuQmCC";
const bytes = Uint8Array.from(Buffer.from(fixture, "base64"));

const image = await decodePng(bytes.buffer);

assert.equal(image.width, 2);
assert.equal(image.height, 2);
assert.deepEqual(Array.from(image.rgba), [
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255,
  255, 255, 255, 255
]);

console.log("Radar PNG decoder tests: OK");
