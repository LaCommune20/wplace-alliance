import assert from "node:assert/strict";
import { getCurrentZoneStaffAccess, hasCurrentZoneStaffCapability } from "./current-zone-staff-policy.js";

function makeDb(rows) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return { results: rows };
            }
          };
        }
      };
    }
  };
}

const env = {
  DB: makeDb([
    { zone_id: 1, role: "manager" },
    { zone_id: 2, role: "ally" },
    { zone_id: 3, role: "template_manager" }
  ]),
  DISCORD_BOT_TOKEN: "test",
  DISCORD_GUILD_ID: "guild",
  DISCORD_ZONE_MANAGER_ROLE_ID: "zone-manager",
  DISCORD_TEMPLATE_MANAGER_ROLE_ID: "template-manager",
  DISCORD_ALLY_ROLE_ID: "ally"
};

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => new Response(JSON.stringify({ roles: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  assert.deepEqual(
    await getCurrentZoneStaffAccess(env, "user-no-role"),
    { notes_manage: [], templates_manage: [] }
  );

  globalThis.fetch = async () => new Response(JSON.stringify({ roles: ["zone-manager"] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  assert.deepEqual(
    await getCurrentZoneStaffAccess(env, "user-manager"),
    { notes_manage: [1], templates_manage: [] }
  );
  assert.equal(await hasCurrentZoneStaffCapability(env, "user-manager", 1, "notes_manage"), true);
  assert.equal(await hasCurrentZoneStaffCapability(env, "user-manager", 2, "notes_manage"), false);

  globalThis.fetch = async () => new Response(JSON.stringify({ roles: ["ally"] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  assert.deepEqual(
    await getCurrentZoneStaffAccess(env, "user-ally"),
    { notes_manage: [2], templates_manage: [2] }
  );

  globalThis.fetch = async () => new Response(JSON.stringify({ roles: ["template-manager"] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  assert.deepEqual(
    await getCurrentZoneStaffAccess(env, "user-template-manager"),
    { notes_manage: [], templates_manage: [3] }
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("PASS: current Zone Staff role validation");
