import test from "node:test";
import assert from "node:assert/strict";
import { canAccessTacticalMap } from "./tactical-map-access-policy.js";

const env = {
  DISCORD_ADMIN_ROLE_ID: "role-admin",
  DISCORD_MODERATOR_ROLE_ID: "role-moderator",
  DISCORD_ZONE_MANAGER_ROLE_ID: "role-zone-manager",
  DISCORD_TEMPLATE_MANAGER_ROLE_ID: "role-template-manager",
  DISCORD_ALLY_ROLE_ID: "role-ally",
  DISCORD_COMMUNARD_ROLE_ID: "role-communard"
};

test("tactical map access follows current Discord role hierarchy", () => {
  assert.equal(canAccessTacticalMap([], env, "member"), false);
  assert.equal(canAccessTacticalMap(["role-sympathisant"], env, "member"), false);
  assert.equal(canAccessTacticalMap(["role-communard"], env, "member"), true);
  assert.equal(canAccessTacticalMap(["role-ally"], env, "member"), true);
  assert.equal(canAccessTacticalMap(["role-zone-manager"], env, "member"), true);
  assert.equal(canAccessTacticalMap(["role-template-manager"], env, "member"), true);
  assert.equal(canAccessTacticalMap([], env, "moderator"), true);
  assert.equal(canAccessTacticalMap([], env, "admin"), true);
  assert.equal(canAccessTacticalMap([], env, "zone_admin"), true);
});
