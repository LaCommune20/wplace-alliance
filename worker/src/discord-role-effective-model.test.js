import assert from "node:assert/strict";
import test from "node:test";

import {
  getDiscordBusinessRoles,
  getEffectiveBusinessRoles
} from "./discord-role-model.js";

const env = Object.freeze({
  DISCORD_ADMIN_ROLE_ID: "role-admin",
  DISCORD_MODERATOR_ROLE_ID: "role-moderator",
  DISCORD_ZONE_MANAGER_ROLE_ID: "role-zone-manager",
  DISCORD_TEMPLATE_MANAGER_ROLE_ID: "role-template-manager",
  DISCORD_ALLY_ROLE_ID: "role-ally",
  DISCORD_COMMUNARD_ROLE_ID: "role-communard"
});

test("Ally inherits Communard without changing raw Discord roles", () => {
  assert.deepEqual(
    getDiscordBusinessRoles(["role-ally"], env),
    ["ally"]
  );

  assert.deepEqual(
    getEffectiveBusinessRoles(["role-ally"], env),
    ["communard", "ally"]
  );
});

test("Communard stays Communard when no Ally role is present", () => {
  assert.deepEqual(
    getEffectiveBusinessRoles(["role-communard"], env),
    ["communard"]
  );
});

test("Communard plus Ally remains deduplicated", () => {
  assert.deepEqual(
    getEffectiveBusinessRoles(["role-communard", "role-ally"], env),
    ["communard", "ally"]
  );
});

test("Ally inherits Communard while preserving other business roles", () => {
  assert.deepEqual(
    getEffectiveBusinessRoles(["role-zone-manager", "role-ally"], env),
    ["zoneManager", "communard", "ally"]
  );
});

test("Sympathisant remains the fallback when no configured business role exists", () => {
  assert.deepEqual(
    getEffectiveBusinessRoles(["unrelated-role"], env),
    ["sympathisant"]
  );
});

test("Empty or invalid Discord role input does not invent Ally or Communard", () => {
  assert.deepEqual(getEffectiveBusinessRoles([], env), ["sympathisant"]);
  assert.deepEqual(getEffectiveBusinessRoles(null, env), ["sympathisant"]);
});
