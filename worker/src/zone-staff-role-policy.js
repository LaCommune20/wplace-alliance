const ZONE_STAFF_ROLES = Object.freeze([
  "manager",
  "template_manager",
  "ally"
]);

const DISCORD_ROLE_ENV_KEYS = Object.freeze({
  manager: "DISCORD_ZONE_MANAGER_ROLE_ID",
  template_manager: "DISCORD_TEMPLATE_MANAGER_ROLE_ID",
  ally: "DISCORD_ALLY_ROLE_ID"
});

export function normalizeZoneStaffRoles(input) {
  if (!Array.isArray(input)) return [];

  return [...new Set(
    input
      .map(value => String(value || "").trim())
      .filter(Boolean)
  )];
}

export function getInvalidZoneStaffRoles(roles) {
  const normalizedRoles = normalizeZoneStaffRoles(roles);
  return normalizedRoles.filter(role => !ZONE_STAFF_ROLES.includes(role));
}

export function hasDiscordRoleForZoneStaffRole(memberRoles, role, env) {
  const envKey = DISCORD_ROLE_ENV_KEYS[role];
  if (!envKey) return false;

  const expectedRoleId = String(env?.[envKey] || "").trim();
  if (!expectedRoleId || !Array.isArray(memberRoles)) return false;

  return memberRoles.some(roleId => String(roleId || "").trim() === expectedRoleId);
}

export function getMissingDiscordZoneStaffRoles(roles, memberRoles, env) {
  return normalizeZoneStaffRoles(roles).filter(
    role => !hasDiscordRoleForZoneStaffRole(memberRoles, role, env)
  );
}

export { ZONE_STAFF_ROLES };
