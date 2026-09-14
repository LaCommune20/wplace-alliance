import { getEffectiveBusinessRoles } from "./discord-role-model.js";
import {
  getCurrentZoneStaffAccess,
  hasCurrentZoneStaffCapability
} from "./current-zone-staff-policy.js";

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

async function handleAdminAccessRequest(request, env, deps) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/access" || request.method !== "GET") return null;

  const session = await deps.requireMember(request, env);
  if (!session) return response(deps, request, env, { authenticated: false }, 401);

  if (session.access !== "member") return null;

  const access = await getCurrentZoneStaffAccess(env, session.user.id);
  return response(deps, request, env, {
    authenticated: true,
    access: session.access,
    permissions: {
      templates_manage: access.templates_manage.length > 0,
      notes_manage: access.notes_manage.length > 0
    },
    zones: access
  }, 200);
}

async function getTemplate(env, templateId) {
  return env.DB.prepare(`
    SELECT t.id, t.zone_id, z.slug AS zone_slug, z.name AS zone_name,
           t.slug, t.name, t.description, t.r2_key, t.wplace_url,
           t.status, t.version, t.created_by, t.updated_by,
           t.created_at, t.updated_at
    FROM templates t
    INNER JOIN zones z ON z.id = t.zone_id
    WHERE t.id = ?
    LIMIT 1
  `).bind(templateId).first();
}

async function handleAdminTemplatesRequest(request, env, deps) {
  const url = new URL(request.url);
  const collection = url.pathname === "/api/admin/templates";
  const itemMatch = url.pathname.match(/^\/api\/admin\/templates\/(\d+)(?:\/upload)?$/);
  if (!collection && !itemMatch) return null;

  const session = await deps.requireMember(request, env);
  if (!session) return response(deps, request, env, { error: "Authentification requise" }, 401);

  if (session.access !== "member") return null;

  const access = await getCurrentZoneStaffAccess(env, session.user.id);
  const allowedZoneIds = new Set(access.templates_manage.map(Number));

  if (collection && request.method === "GET") {
    if (!allowedZoneIds.size) return response(deps, request, env, [], 200);
    const placeholders = [...allowedZoneIds].map(() => "?").join(",");
    try {
      const result = await env.DB.prepare(`
        SELECT t.id, t.zone_id, z.slug AS zone_slug, z.name AS zone_name,
               t.slug, t.name, t.description, t.r2_key, t.wplace_url,
               t.status, t.version, t.created_by, t.updated_by,
               t.created_at, t.updated_at
        FROM templates t
        INNER JOIN zones z ON z.id = t.zone_id
        WHERE t.zone_id IN (${placeholders})
        ORDER BY z.name ASC, t.name ASC, t.version DESC
      `).bind(...allowedZoneIds).all();
      return response(deps, request, env, result?.results || [], 200);
    } catch (error) {
      console.error("Erreur D1 /api/admin/templates GET (current role filter):", error);
      return response(deps, request, env, { error: "Erreur lors de la lecture des templates" }, 500);
    }
  }

  if (collection && request.method === "POST") {
    let body;
    try { body = await request.clone().json(); }
    catch { return null; }
    const zoneId = Number(body?.zone_id);
    if (!Number.isInteger(zoneId) || !allowedZoneIds.has(zoneId)) {
      return response(deps, request, env, { error: "Cette zone ne vous est pas attribuée" }, 403);
    }
    return null;
  }

  if (!itemMatch) return null;

  const templateId = Number(itemMatch[1]);
  const template = await getTemplate(env, templateId);
  if (!template) return null;

  if (!allowedZoneIds.has(Number(template.zone_id))) {
    return response(deps, request, env, { error: "Ce template n'est pas autorisé" }, 403);
  }

  return null;
}

export async function handleNotesMapRequest(request, env, deps) {
  const accessResponse = await handleAdminAccessRequest(request, env, deps);
  if (accessResponse) return accessResponse;

  const templatesResponse = await handleAdminTemplatesRequest(request, env, deps);
  if (templatesResponse) return templatesResponse;

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
