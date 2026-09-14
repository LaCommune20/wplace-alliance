import { getEffectiveBusinessRoles } from "./discord-role-model.js";

const MAP_BUSINESS_ROLES = new Set(["communard", "ally", "zoneManager", "templateManager"]);
const MAP_SESSION_ACCESS = new Set(["admin", "moderator", "zone_admin"]);

export function canAccessTacticalMap(memberRoles, env, sessionAccess) {
  if (MAP_SESSION_ACCESS.has(String(sessionAccess || ""))) return true;

  const effectiveRoles = getEffectiveBusinessRoles(memberRoles, env);
  return effectiveRoles.some(role => MAP_BUSINESS_ROLES.has(role));
}
