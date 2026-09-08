import assert from "node:assert/strict";
import {
  eventMatchesRegions,
  regionsAreClose,
  resolveEventExpirations,
  resolveRadarObservation,
  resolveRadarObservationGroups
} from "./event-resolver.js";

const now = "2026-09-08T18:00:00.000Z";
const firstRegion = { tile_x: 100, tile_y: 200, min_x: 10, min_y: 20, max_x: 20, max_y: 30, pixel_count: 10 };
const nearbyRegion = { tile_x: 100, tile_y: 200, min_x: 45, min_y: 20, max_x: 50, max_y: 30, pixel_count: 15 };
const farRegion = { tile_x: 101, tile_y: 200, min_x: 0, min_y: 20, max_x: 5, max_y: 30, pixel_count: 20 };

assert.equal(regionsAreClose(firstRegion, nearbyRegion, 32), true);
assert.equal(regionsAreClose(firstRegion, farRegion, 32), false);
assert.equal(eventMatchesRegions([firstRegion], [nearbyRegion], { proximityPixels: 32 }), true);
assert.equal(eventMatchesRegions([firstRegion], [farRegion], { proximityPixels: 32 }), false);

const observation = {
  changed: true,
  score: 95,
  summary: { changedPixels: 25, changedMeaningfulPixels: 25, regionCount: 1 },
  regions: [firstRegion]
};

const created = resolveRadarObservation({ radarId: "radar-test", zoneId: 7, observation, events: [], now });
assert.equal(created.action, "create");
assert.equal(created.event.status, "active");
assert.equal(created.event.pixel_count, 25);
assert.equal(created.event.region_count, 1);
assert.equal(created.regions.length, 1);

const existing = {
  id: 42,
  radar_id: "radar-test",
  zone_id: 7,
  started_at: "2026-09-08T17:50:00.000Z",
  last_activity_at: "2026-09-08T17:59:00.000Z",
  closed_at: null,
  status: "active",
  pixel_count: 100,
  region_count: 3,
  score: 50,
  regions: [firstRegion]
};

const updated = resolveRadarObservation({ radarId: "radar-test", zoneId: 7, observation, events: [existing], now });
assert.equal(updated.action, "update");
assert.equal(updated.matchedEventId, 42);
assert.equal(updated.event.status, "active");
assert.equal(updated.event.pixel_count, 125);
assert.equal(updated.event.region_count, 4);

const quiet = resolveEventExpirations([{ ...existing, last_activity_at: "2026-09-08T17:54:00.000Z" }], now);
assert.equal(quiet.length, 1);
assert.equal(quiet[0].action, "quiet");
assert.equal(quiet[0].event.status, "quiet");

const closed = resolveEventExpirations([{ ...existing, last_activity_at: "2026-09-08T17:40:00.000Z" }], now);
assert.equal(closed.length, 1);
assert.equal(closed[0].action, "close");
assert.equal(closed[0].event.status, "closed");
assert.equal(closed[0].event.closed_at, now);

const unchanged = resolveRadarObservation({ radarId: "radar-test", observation: { changed: false }, events: [existing], now });
assert.equal(unchanged.action, "none");

const groupObservation = {
  changed: true,
  score: 100,
  summary: { changedPixels: 30, changedMeaningfulPixels: 30, regionCount: 3 },
  regions: [
    { tile_x: 1057, tile_y: 751, min_x: 990, min_y: 500, max_x: 999, max_y: 500, pixel_count: 10 },
    { tile_x: 1058, tile_y: 751, min_x: 0, min_y: 500, max_x: 5, max_y: 500, pixel_count: 5 },
    { tile_x: 1058, tile_y: 751, min_x: 500, min_y: 500, max_x: 505, max_y: 505, pixel_count: 15 }
  ]
};

const grouped = resolveRadarObservationGroups({
  radarId: "radar-test",
  zoneId: 7,
  observation: groupObservation,
  events: [],
  now
});
assert.equal(grouped.length, 2);
assert.equal(grouped[0].action, "create");
assert.equal(grouped[0].regions.length, 2);
assert.equal(grouped[0].event.pixel_count, 15);
assert.equal(grouped[1].action, "create");
assert.equal(grouped[1].regions.length, 1);
assert.equal(grouped[1].event.pixel_count, 15);

const existingGroupEvent = {
  id: 77,
  radar_id: "radar-test",
  zone_id: 7,
  started_at: "2026-09-08T17:55:00.000Z",
  last_activity_at: "2026-09-08T17:59:00.000Z",
  closed_at: null,
  status: "active",
  pixel_count: 50,
  region_count: 2,
  score: 50,
  regions: [groupObservation.regions[0]]
};

const groupedUpdate = resolveRadarObservationGroups({
  radarId: "radar-test",
  zoneId: 7,
  observation: groupObservation,
  events: [existingGroupEvent],
  now
});
assert.equal(groupedUpdate.length, 2);
assert.equal(groupedUpdate[0].action, "update");
assert.equal(groupedUpdate[0].matchedEventId, 77);
assert.equal(groupedUpdate[0].event.pixel_count, 65);
assert.equal(groupedUpdate[1].action, "create");

console.log("Radar event-resolver tests: OK");
