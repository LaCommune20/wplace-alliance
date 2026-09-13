import { getEffectiveBusinessRoles } from "./discord-role-model.js";

function parseNotePosition(value) {
  let position = value;
  if (typeof position === "string") {
    try { position = JSON.parse(position); }
    catch { return null; }
  }
  if (!position || typeof position !== "object" || Array.isArray(position)) return null;
  const lat = Number(position.lat ?? position.latitude);
  const lng = Number(position.lng ?? position.lon ?? position.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function response(deps, request, env, data, status) {
  return deps.jsonAuth(request, data, status, env);
}

export async function handleNotesMapRequest(request, env, deps) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/notes") return null;
  if (request.method !== "GET") return response(deps, request, env, { error: "Méthode non autorisée" }, 405);

  const session = await deps.requireMember(request, env);
  if (!session) return response(deps, request, env, { error: "Authentification requise" }, 401);

  try {
    const member = await deps.fetchDiscordGuildMember(session.user.id, env);
    const roles = Array.isArray(member?.roles) ? member.roles : [];
    const effectiveRoles = getEffectiveBusinessRoles(roles, env);
    const canRead = ["admin", "moderator", "zone_admin"].includes(session.access)
      || effectiveRoles.includes("communard");

    if (!canRead) {
      return response(deps, request, env, { error: "Accès réservé aux Communards" }, 403);
    }

    const now = new Date().toISOString();
    const rows = await env.DB.prepare(`
      SELECT n.id, n.zone_id, z.name AS zone_name,
             n.level, n.content, n.position, n.expires_at
      FROM notes n
      INNER JOIN zones z ON z.id = n.zone_id
      WHERE z.status = 'active'
        AND n.status = 'active'
        AND (n.expires_at IS NULL OR n.expires_at > ?)
      ORDER BY n.created_at DESC, n.id DESC
    `).bind(now).all();

    const notes = (rows.results || []).map(row => ({
      id: Number(row.id),
      zone_id: Number(row.zone_id),
      zone_name: row.zone_name,
      level: row.level,
      content: row.content,
      position: parseNotePosition(row.position),
      expires_at: row.expires_at || null
    })).filter(note => note.position !== null);

    return response(deps, request, env, { ok: true, notes }, 200);
  } catch (error) {
    console.error("Erreur GET /api/notes:", error);
    return response(deps, request, env, { error: "Impossible de lire les Notes" }, 500);
  }
}
