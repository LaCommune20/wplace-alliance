export const ZONE_STAFF_ROLES = Object.freeze([
  "manager",
  "template_manager",
  "ally"
]);

export const DISCORD_BUSINESS_TO_ZONE_STAFF_ROLE = Object.freeze({
  zoneManager: "manager",
  templateManager: "template_manager",
  ally: "ally"
});

export const ZONE_STAFF_TO_DISCORD_BUSINESS_ROLE = Object.freeze({
  manager: "zoneManager",
  template_manager: "templateManager",
  ally: "ally"
});

export function isZoneStaffRole(role) {
  return ZONE_STAFF_ROLES.includes(String(role || "").trim());
}

export function getZoneStaffRoleForBusinessRole(businessRole) {
  const key = String(businessRole || "").trim();
  return DISCORD_BUSINESS_TO_ZONE_STAFF_ROLE[key] || null;
}

export function getBusinessRoleForZoneStaffRole(role) {
  const key = String(role || "").trim();
  return ZONE_STAFF_TO_DISCORD_BUSINESS_ROLE[key] || null;
}

export function getZoneStaffRolesForBusinessRoles(businessRoles) {
  if (!Array.isArray(businessRoles)) return [];

  return [
    ...new Set(
      businessRoles
        .map(getZoneStaffRoleForBusinessRole)
        .filter(Boolean)
    )
  ];
}
