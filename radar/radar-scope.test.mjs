import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRectangle, normalizePolygon, resolveRadarScope } from "./radar-scope.js";

test("normalise un polygone de zone", () => {
  assert.deepEqual(normalizePolygon("[[5.8,43.1],[5.9,43.1],[5.9,43.2]]"), [
    [5.8, 43.1],
    [5.9, 43.1],
    [5.9, 43.2]
  ]);
});

test("normalise un rectangle géographique", () => {
  assert.deepEqual(normalizeRectangle({ west: 5.8, south: 43.1, east: 5.9, north: 43.2 }), {
    west: 5.8,
    south: 43.1,
    east: 5.9,
    north: 43.2
  });
});

test("refuse un rectangle inversé", () => {
  assert.throws(
    () => normalizeRectangle({ west: 5.9, south: 43.2, east: 5.8, north: 43.1 }),
    /inversées/
  );
});

test("un radar zone utilise la géométrie réelle de la zone", () => {
  const scope = resolveRadarScope(
    { type: "zone" },
    {
      id: 4,
      polygon: [[5.8, 43.1], [5.9, 43.1], [5.9, 43.2], [5.8, 43.2]]
    }
  );

  assert.equal(scope.type, "zone");
  assert.equal(scope.zoneId, 4);
  assert.ok(scope.tiles.length > 0);
  assert.ok(scope.tiles.some(({ tileX, tileY }) => tileX === 1057 && tileY === 751));
});

test("un radar rectangle produit les tuiles couvrant le rectangle", () => {
  const scope = resolveRadarScope(
    { type: "rectangle", geometry: { west: 5.8, south: 43.1, east: 5.9, north: 43.2 } },
    { id: 4 }
  );

  assert.equal(scope.type, "rectangle");
  assert.equal(scope.zoneId, 4);
  assert.deepEqual(scope.rectangle, { west: 5.8, south: 43.1, east: 5.9, north: 43.2 });
  assert.ok(scope.tiles.length > 0);
});

test("un radar zone exige une zone", () => {
  assert.throws(() => resolveRadarScope({ type: "zone" }), /Zone requise/);
});

test("refuse un type de radar inconnu", () => {
  assert.throws(() => resolveRadarScope({ type: "polygon" }, null), /Type de radar invalide/);
});

test("accepte la géométrie rectangle sérialisée", () => {
  const scope = resolveRadarScope({
    type: "rectangle",
    geometry: JSON.stringify({ west: 5.8, south: 43.1, east: 5.9, north: 43.2 })
  });
  assert.ok(scope.tiles.length > 0);
});
