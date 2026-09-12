import assert from "node:assert/strict";
import test from "node:test";

import {
  ZONE_STAFF_ROLES,
  getBusinessRoleForZoneStaffRole,
  getZoneStaffRoleForBusinessRole,
  getZoneStaffRolesForBusinessRoles,
  isZoneStaffRole
} from "./zone-staff-role-model.js";

test("zone staff roles expose the three technical roles", () => {
  assert.deepEqual([...ZONE_STAFF_ROLES], [
    "manager",
    "template_manager",
    "ally"
  ]);
});

test("business roles map to the expected zone staff role", () => {
  assert.equal(getZoneStaffRoleForBusinessRole("zoneManager"), "manager");
  assert.equal(getZoneStaffRoleForBusinessRole("templateManager"), "template_manager");
  assert.equal(getZoneStaffRoleForBusinessRole("ally"), "ally");
  assert.equal(getZoneStaffRoleForBusinessRole("communard"), null);
  assert.equal(getZoneStaffRoleForBusinessRole("sympathisant"), null);
});

test("zone staff roles map back to the expected business role", () => {
  assert.equal(getBusinessRoleForZoneStaffRole("manager"), "zoneManager");
  assert.equal(getBusinessRoleForZoneStaffRole("template_manager"), "templateManager");
  assert.equal(getBusinessRoleForZoneStaffRole("ally"), "ally");
  assert.equal(getBusinessRoleForZoneStaffRole("moderator"), null);
  assert.equal(getBusinessRoleForZoneStaffRole("admin"), null);
});

test("multiple business roles are deduplicated", () => {
  assert.deepEqual(
    getZoneStaffRolesForBusinessRoles([
      "ally",
      "templateManager",
      "ally",
      "communard"
    ]),
    ["ally", "template_manager"]
  );
});

test("unknown technical roles are rejected", () => {
  assert.equal(isZoneStaffRole("ally"), true);
  assert.equal(isZoneStaffRole("manager"), true);
  assert.equal(isZoneStaffRole("template_manager"), true);
  assert.equal(isZoneStaffRole("moderator"), false);
  assert.equal(isZoneStaffRole("admin"), false);
  assert.equal(isZoneStaffRole(""), false);
});
