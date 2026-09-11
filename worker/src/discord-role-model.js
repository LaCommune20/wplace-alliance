// WPlace La Commune — Discord role model V1
// Pure helpers for server-side Discord role interpretation.
//
// Security rule:
// - Discord role names are never used as identifiers.
// - Role IDs come from Worker environment variables.
// - This module only interprets roles from a verified Discord guild member.
// - Zone scope and resource authorization remain Worker/D1 responsibilities.

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

export function getCurrentSessionAccess(memberRoles, env, userId, devZoneAdminUserId) {
  const flags = getDiscordRoleFlags(memberRoles, env);

  // Preserve the current session hierarchy. Business roles do not become
  // global session access values merely because they exist on Discord.
  if (flags.admin) return "admin";
  if (String(userId || "") === String(devZoneAdminUserId || "")) return "zone_admin";
  if (flags.moderator) return "moderator";
  return "member";
}
