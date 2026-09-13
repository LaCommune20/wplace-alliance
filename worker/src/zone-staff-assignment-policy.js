import {
  ZONE_STAFF_TO_DISCORD_BUSINESS_ROLE,
  isZoneStaffRole
} from "./zone-staff-role-model.js";

const BUSINESS_ROLE_ENV_KEYS = Object.freeze({
  zoneManager: "DISCORD_ZONE_MANAGER_ROLE_ID",
  templateManager: "DISCORD_TEMPLATE_MANAGER_ROLE_ID",
  ally: "DISCORD_ALLY_ROLE_ID"
});

export function getAssignableZoneStaffRoles(memberRoles, env) {
  const roleIds = new Set(
    Array.isArray(memberRoles)
      ? memberRoles.map(roleId => String(roleId || "").trim()).filter(Boolean)
      : []
  );

  const roles = [];

  for (const [zoneStaffRole, businessRole] of Object.entries(ZONE_STAFF_TO_DISCORD_BUSINESS_ROLE)) {
    const envKey = BUSINESS_ROLE_ENV_KEYS[businessRole];
    const discordRoleId = String(env?.[envKey] || "").trim();
    if (discordRoleId && roleIds.has(discordRoleId)) roles.push(zoneStaffRole);
  }

  return roles;
}

export function validateZoneStaffAssignmentRoles(requestedRoles, memberRoles, env) {
  const roles = Array.isArray(requestedRoles)
    ? [...new Set(requestedRoles.map(role => String(role || "").trim()))]
    : [];

  const invalidRoles = roles.filter(role => !isZoneStaffRole(role));
  if (invalidRoles.length > 0) {
    return Object.freeze({
      ok: false,
      status: 400,
      error: "Rôle Zone Staff invalide",
      invalidRoles
    });
  }

  const assignableRoles = new Set(getAssignableZoneStaffRoles(memberRoles, env));
  const unauthorizedRoles = roles.filter(role => !assignableRoles.has(role));

  if (unauthorizedRoles.length > 0) {
    return Object.freeze({
      ok: false,
      status: 403,
      error: "Le rôle Discord métier correspondant est absent",
      unauthorizedRoles,
      assignableRoles: [...assignableRoles]
    });
  }

  return Object.freeze({
    ok: true,
    status: 200,
    roles,
    assignableRoles: [...assignableRoles]
  });
}
