import assert from "node:assert/strict";
import { validateNotePayload } from "./notes-api.js";

const base = {
  level: "information",
  content: "Note de test",
  position: { lat: 43.12, lng: 5.93 },
  duration_type: "permanent"
};

const nowMs = Date.parse("2026-09-12T20:00:00Z");

const valid = validateNotePayload(base, { nowMs });
assert.equal(valid.ok, true);
assert.equal(valid.value.expires_at, null);
assert.deepEqual(JSON.parse(valid.value.position), { lat: 43.12, lng: 5.93 });

for (const level of ["information", "watch", "important"]) {
  assert.equal(validateNotePayload({ ...base, level }, { nowMs }).ok, true, `level ${level}`);
}

assert.equal(validateNotePayload({ ...base, level: "bad" }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, content: "" }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, position: { lat: 91, lng: 5 } }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, position: { lat: 43, lng: 181 } }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, position: "not-json" }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, duration_type: "bad" }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, duration_type: "permanent", expires_at: "2030-01-01T00:00:00Z" }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, duration_type: "1h" }, { nowMs }).value.expires_at, "2026-09-12T21:00:00.000Z");
assert.equal(validateNotePayload({ ...base, duration_type: "custom", expires_at: "2026-09-13T20:00:00Z" }, { nowMs }).ok, true);
assert.equal(validateNotePayload({ ...base, duration_type: "custom", expires_at: "2026-09-12T19:00:00Z" }, { nowMs }).ok, false);
assert.equal(validateNotePayload({ ...base, status: "archived" }, { partial: true, nowMs }).ok, true);
assert.equal(validateNotePayload({ ...base, status: "expired" }, { partial: true, nowMs }).ok, false);

console.log("PASS: notes-api validation");
