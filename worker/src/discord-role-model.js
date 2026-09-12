export const DISCORD_ROLE_ENV_KEYS = Object.freeze({
  admin: "DISCORD_ADMIN_ROLE_ID",
  moderator: "DISCORD_MODERATOR_ROLE_ID",
  zoneManager: "DISCORD_ZONE_MANAGER_ROLE_ID",
  templateManager: "DISCORD_TEMPLATE_MANAGER_ROLE_ID",
  ally: "DISCORD_ALLY_ROLE_ID",
  communard: "DISCORD_COMMUNARD_ROLE_ID"
});

export const DISCORD_BUSINESS_ROLE_ORDER = Object.freeze([
  "admin",
  "moderator",
  "zoneManager",
  "templateManager",
  "ally",
  "communard",
  "sympathisant"
]);

function normalizedRoleIds(memberRoles) {
  if (!Array.isArray(memberRoles)) return new Set();

  return new Set(
    memberRoles
      .map(roleId => String(roleId || "").trim())
      .filter(Boolean)
  );
}

export function getDiscordRoleFlags(memberRoles, env) {
  const roleIds = normalizedRoleIds(memberRoles);

  const has = key => {
    const envKey = DISCORD_ROLE_ENV_KEYS[key];
    const roleId = env?.[envKey];
    return Boolean(roleId) && roleIds.has(String(roleId).trim());
  };

  return Object.freeze({
    admin: has("admin"),
    moderator: has("moderator"),
    zoneManager: has("zoneManager"),
    templateManager: has("templateManager"),
    ally: has("ally"),
    communard: has("communard")
  });
}

export function getDiscordBusinessRoles(memberRoles, env) {
  const flags = getDiscordRoleFlags(memberRoles, env);
  const roles = [];

  for (const role of DISCORD_BUSINESS_ROLE_ORDER) {
    if (role === "sympathisant") {
      if (!Object.values(flags).some(Boolean)) roles.push(role);
      continue;
    }

    if (flags[role]) roles.push(role);
  }

  return roles;
}

/**
 * Return the effective business roles used by application permissions.
 *
 * Discord roles stay untouched: an Ally does not gain the Discord
 * Communard role. In the application model, however, Ally inherits the
 * Communard capability set, so an Ally is treated as Communard + Ally.
 */
export function getEffectiveBusinessRoles(memberRoles, env) {
  const roles = getDiscordBusinessRoles(memberRoles, env);

  if (!roles.includes("ally")) {
    return roles;
  }

  // Normalize the inherited role before Ally. This also makes the result
  // deterministic when Discord already contains both roles.
  const effectiveRoles = roles.filter(role => role !== "communard");
  const allyIndex = effectiveRoles.indexOf("ally");
  effectiveRoles.splice(allyIndex, 0, "communard");
  return effectiveRoles;
}

export function getCurrentSessionAccess(memberRoles, env, userId, devZoneAdminUserId) {
  const flags = getDiscordRoleFlags(memberRoles, env);
  const normalizedUserId = String(userId || "").trim();
  const normalizedDevZoneAdminUserId = String(devZoneAdminUserId || "").trim();

  // Preserve the current session hierarchy. Business roles do not become
  // global session access values merely because they exist on Discord.
  if (flags.admin) return "admin";
  if (
    normalizedDevZoneAdminUserId &&
    normalizedUserId === normalizedDevZoneAdminUserId
  ) {
    return "zone_admin";
  }
  if (flags.moderator) return "moderator";
  return "member";
}
