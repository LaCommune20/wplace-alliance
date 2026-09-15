import { getDiscordRoleFlags } from "./discord-role-model.js";

const CAPABILITY_ROLES = Object.freeze({
  notes_manage: ["manager", "ally"],
  templates_manage: ["template_manager", "ally"]
});

async function fetchCurrentMember(userId, env) {
  if (!env?.DISCORD_BOT_TOKEN || !env?.DISCORD_GUILD_ID || !userId) return null;

  const url = `https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}`;
  const headers = {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
  };

  let response = await fetch(url, { headers });

  if (response.status === 429 || response.status >= 500) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter)
      ? Math.min(Math.max(retryAfter * 1000, 100), 2000)
      : 250;

    await new Promise(resolve => setTimeout(resolve, delayMs));
    response = await fetch(url, { headers });
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    console.error("Discord current member check:", response.status);
    return null;
  }

  return response.json();
}

function roleIsCurrentlyValid(role, flags) {
  if (role === "manager") return flags.zoneManager;
  if (role === "template_manager") return flags.templateManager;
  if (role === "ally") return flags.ally;
  return false;
}

export async function getCurrentZoneStaffAccess(env, discordUserId) {
  const empty = { notes_manage: [], templates_manage: [] };
  if (!env?.DB || !discordUserId) return empty;

  try {
    const member = await fetchCurrentMember(discordUserId, env);
    const roles = Array.isArray(member?.roles) ? member.roles : [];
    const flags = getDiscordRoleFlags(roles, env);

    if (!flags.zoneManager && !flags.templateManager && !flags.ally) {
      return empty;
    }

    const { results } = await env.DB.prepare(`
      SELECT zone_id, role
      FROM zone_staff
      WHERE discord_user_id = ?
        AND role IN ('manager', 'template_manager', 'ally')
      ORDER BY zone_id ASC, role ASC
    `).bind(String(discordUserId)).all();

    const notes = new Set();
    const templates = new Set();

    for (const row of results || []) {
      const zoneId = Number(row.zone_id);
      const role = String(row.role || "");
      if (!Number.isInteger(zoneId) || !roleIsCurrentlyValid(role, flags)) continue;
      if (CAPABILITY_ROLES.notes_manage.includes(role)) notes.add(zoneId);
      if (CAPABILITY_ROLES.templates_manage.includes(role)) templates.add(zoneId);
    }

    return {
      notes_manage: [...notes].sort((a, b) => a - b),
      templates_manage: [...templates].sort((a, b) => a - b)
    };
  } catch (error) {
    console.error("Current Zone Staff access check failed:", error);
    return empty;
  }
}

export async function hasCurrentZoneStaffCapability(env, discordUserId, zoneId, capability) {
  const access = await getCurrentZoneStaffAccess(env, discordUserId);
  const ids = access?.[capability];
  if (!Array.isArray(ids)) return false;
  return ids.includes(Number(zoneId));
}
