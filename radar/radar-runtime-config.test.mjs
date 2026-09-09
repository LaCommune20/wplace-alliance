import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRadarRuntimeConfig,
  normalizeRadarRow,
  normalizeStoredZonePolygon
} from "./radar-runtime-config.js";

const zonePolygonLatLng = JSON.stringify([
  [43.10, 5.80],
  [43.10, 5.90],
  [43.20, 5.90],
  [43.20, 5.80]
]);

function mockDb(row) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM radars r/);
      assert.match(sql, /INNER JOIN zones z ON z\.id = r\.zone_id/);
      return {
        bind(id) {
          assert.equal(id, row?.id ?? "radar-1");
          return {
            first: async () => row
          };
        }
      };
    }
  };
}

test("convertit le polygone zone stocké [lat,lng] vers [lng,lat]", () => {
  assert.deepEqual(normalizeStoredZonePolygon(zonePolygonLatLng), [
    [5.80, 43.10],
    [5.90, 43.10],
    [5.90, 43.20],
    [5.80, 43.20]
  ]);
});

test("normalise une ligne Radar D1", () => {
  const radar = normalizeRadarRow({
    id: "radar-1",
    zone_id: "4",
    type: "rectangle",
    geometry: JSON.stringify({ west: 5.8, south: 43.1, east: 5.9, north: 43.2 }),
    status: "paused",
    scan_interval_seconds: "120"
  });

  assert.equal(radar.zone_id, 4);
  assert.equal(radar.scan_interval_seconds, 120);
  assert.deepEqual(radar.geometry, {
    west: 5.8,
    south: 43.1,
    east: 5.9,
    north: 43.2
  });
});

test("charge un Radar zone réel et résout ses tuiles", async () => {
  const config = await loadRadarRuntimeConfig(mockDb({
    id: "radar-1",
    zone_id: 4,
    type: "zone",
    geometry: null,
    status: "paused",
    scan_interval_seconds: 120,
    notification_mode: "observation",
    zone_slug: "toulon",
    zone_name: "Toulon",
    zone_status: "active",
    zone_polygon: zonePolygonLatLng
  }), "radar-1");

  assert.equal(config.radar.id, "radar-1");
  assert.equal(config.zone.id, 4);
  assert.deepEqual(config.scope.polygon[0], [5.8, 43.1]);
  assert.ok(config.scope.tiles.some(({ tileX, tileY }) => tileX === 1057 && tileY === 751));
});

test("refuse un Radar inexistant", async () => {
  await assert.rejects(
    () => loadRadarRuntimeConfig(mockDb(null), "radar-404"),
    /Radar introuvable/
  );
});

test("refuse une zone inactive", async () => {
  await assert.rejects(
    () => loadRadarRuntimeConfig(mockDb({
      id: "radar-2",
      zone_id: 4,
      type: "zone",
      geometry: null,
      status: "active",
      scan_interval_seconds: 120,
      notification_mode: "observation",
      zone_slug: "toulon",
      zone_name: "Toulon",
      zone_status: "archived",
      zone_polygon: zonePolygonLatLng
    }), "radar-2"),
    /Zone du Radar inactive/
  );
});
