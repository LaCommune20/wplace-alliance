import {
  getBusinessRoleForZoneStaffRole,
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

  return Object.entries(BUSINESS_ROLE_ENV_KEYS)
    .filter(([businessRole, envKey]) => {
      const discordRoleId = String(env?.[envKey] || "").trim();
      return Boolean(discordRoleId) && roleIds.has(discordRoleId) && Boolean(getBusinessRoleForZoneStaffRole(
        Object.entries(BUSINESS_ROLE_ENV_KEYS).find(([, key]) => key === envKey)?.[0]
      ));
    })
    .map(([businessRole]) => {
      const role = Object.entries({
        zoneManager: "manager",
        templateManager: "template_manager",
        ally: "ally"
      }).find(([key]) => key === businessRole)?.[1];
      return role || null;
    })
    .filter(Boolean);
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
