import assert from "node:assert/strict";
import test from "node:test";

import {
  getAssignableZoneStaffRoles,
  validateZoneStaffAssignmentRoles
} from "./zone-staff-assignment-policy.js";

const env = {
  DISCORD_ZONE_MANAGER_ROLE_ID: "role-zone-manager",
  DISCORD_TEMPLATE_MANAGER_ROLE_ID: "role-template-manager",
  DISCORD_ALLY_ROLE_ID: "role-ally"
};

test("Discord business roles expose matching Zone Staff roles", () => {
  assert.deepEqual(
    getAssignableZoneStaffRoles(
      ["role-zone-manager", "role-template-manager", "role-ally"],
      env
    ),
    ["manager", "template_manager", "ally"]
  );
});

test("a Communard or Sympathisant cannot create Zone Staff access", () => {
  assert.deepEqual(
    getAssignableZoneStaffRoles(["unrelated-role"], env),
    []
  );

  const result = validateZoneStaffAssignmentRoles(
    ["ally"],
    ["unrelated-role"],
    env
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(result.unauthorizedRoles, ["ally"]);
});

test("only Discord roles actually present on the member are assignable", () => {
  const result = validateZoneStaffAssignmentRoles(
    ["ally", "template_manager"],
    ["role-ally"],
    env
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(result.unauthorizedRoles, ["template_manager"]);
  assert.deepEqual(result.assignableRoles, ["ally"]);
});

test("an empty role list remains a valid way to clear an assignment", () => {
  const result = validateZoneStaffAssignmentRoles([], [], env);

  assert.equal(result.ok, true);
  assert.deepEqual(result.roles, []);
});

test("unknown technical roles are rejected before Discord role checks", () => {
  const result = validateZoneStaffAssignmentRoles(
    ["admin"],
    ["role-zone-manager"],
    env
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.deepEqual(result.invalidRoles, ["admin"]);
});
