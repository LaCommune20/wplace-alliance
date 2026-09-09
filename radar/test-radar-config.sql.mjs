import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../migrations/0004_radar_config.sql", import.meta.url), "utf8");

test("radars conserve un identifiant TEXT compatible avec radar_events", () => {
  assert.match(sql, /id TEXT PRIMARY KEY/);
  assert.match(sql, /scan_interval_seconds INTEGER NOT NULL DEFAULT 120/);
});

test("radars limite les types et statuts", () => {
  assert.match(sql, /type IN \('zone', 'rectangle'\)/);
  assert.match(sql, /status IN \('active', 'paused', 'archived'\)/);
  assert.match(sql, /notification_mode IN \('observation', 'automatic'\)/);
});

test("la géométrie est absente pour zone et valide pour rectangle", () => {
  assert.match(sql, /type = 'zone' AND geometry IS NULL/);
  assert.match(sql, /type = 'rectangle' AND geometry IS NOT NULL AND json_valid\(geometry\)/);
});

test("un seul Radar zone actif ou paused par zone", () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_radars_one_zone_radar/);
  assert.match(sql, /type = 'zone' AND status IN \('active', 'paused'\)/);
});

test("un maximum de deux Radars rectangle actifs ou paused par zone", () => {
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS radars_max_two_rectangles/);
  assert.match(sql, /COUNT\(\*\) FROM radars/);
  assert.match(sql, /type = 'rectangle'/);
  assert.match(sql, /status IN \('active', 'paused'\)/);
  assert.match(sql, /RAISE\(ABORT, 'maximum de 2 Radars rectangle par zone'/);
});

test("radar est rattaché à une zone", () => {
  assert.match(sql, /zone_id INTEGER NOT NULL/);
  assert.match(sql, /REFERENCES zones\(id\) ON DELETE CASCADE/);
});

console.log("Radar config schema tests: OK");
