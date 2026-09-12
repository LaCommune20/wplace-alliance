const NOTE_LEVELS = new Set(["information", "watch", "important"]);
const NOTE_DURATIONS = new Set(["permanent", "1h", "6h", "24h", "3d", "7d", "custom"]);
const NOTE_MUTABLE_STATUSES = new Set(["active", "archived"]);
const DURATION_SECONDS = Object.freeze({
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
  "3d": 3 * 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60
});

function parseNotePosition(value) {
  let position = value;
  if (typeof position === "string") {
    try { position = JSON.parse(position); }
    catch { return { ok: false, error: "Position JSON invalide" }; }
  }
  if (!position || typeof position !== "object" || Array.isArray(position)) {
    return { ok: false, error: "La position de la Note est invalide" };
  }
  const lat = Number(position.lat ?? position.latitude);
  const lng = Number(position.lng ?? position.lon ?? position.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: "Coordonnée géographique de la Note invalide" };
  }
  return { ok: true, position: { lat, lng } };
}

function parseExpiresAt(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function resolveNoteExpiry(durationType, requestedExpiresAt, nowMs = Date.now()) {
  if (!NOTE_DURATIONS.has(durationType)) return { ok: false, error: "Durée de Note invalide" };
  if (durationType === "permanent") {
    if (requestedExpiresAt != null && requestedExpiresAt !== "") {
      return { ok: false, error: "Une Note permanente ne doit pas avoir de date d'expiration" };
    }
    return { ok: true, expiresAt: null };
  }
  if (durationType === "custom") {
    const expiresAt = parseExpiresAt(requestedExpiresAt);
    if (!expiresAt) return { ok: false, error: "Une date d'expiration valide est requise pour une Note personnalisée" };
    if (Date.parse(expiresAt) <= nowMs) return { ok: false, error: "La date d'expiration doit être dans le futur" };
    return { ok: true, expiresAt };
  }
  if (requestedExpiresAt != null && requestedExpiresAt !== "") {
    return { ok: false, error: "La date d'expiration est calculée automatiquement pour cette durée" };
  }
  return { ok: true, expiresAt: new Date(nowMs + DURATION_SECONDS[durationType] * 1000).toISOString() };
}

export function validateNotePayload(body, { partial = false, nowMs = Date.now() } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Corps JSON invalide" };
  }
  const result = {};
  if (!partial || Object.prototype.hasOwnProperty.call(body, "level")) {
    const level = String(body.level || "").trim().toLowerCase();
    if (!NOTE_LEVELS.has(level)) return { ok: false, status: 400, error: "Niveau de Note invalide" };
    result.level = level;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "content")) {
    const content = String(body.content ?? "").trim();
    if (!content) return { ok: false, status: 400, error: "Le contenu de la Note est requis" };
    if (content.length > 4000) return { ok: false, status: 400, error: "Le contenu de la Note est trop long (4000 caractères maximum)" };
    result.content = content;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "position")) {
    const parsedPosition = parseNotePosition(body.position);
    if (!parsedPosition.ok) return { ok: false, status: 400, error: parsedPosition.error };
    result.position = JSON.stringify(parsedPosition.position);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "duration_type")) {
    const durationType = String(body.duration_type || "").trim().toLowerCase();
    const expiry = resolveNoteExpiry(durationType, body.expires_at, nowMs);
    if (!expiry.ok) return { ok: false, status: 400, error: expiry.error };
    result.duration_type = durationType;
    result.expires_at = expiry.expiresAt;
  } else if (Object.prototype.hasOwnProperty.call(body, "expires_at")) {
    return { ok: false, status: 400, error: "duration_type doit être fourni avec expires_at" };
  }
  if (partial && Object.prototype.hasOwnProperty.call(body, "status")) {
    const status = String(body.status || "").trim().toLowerCase();
    if (!NOTE_MUTABLE_STATUSES.has(status)) return { ok: false, status: 400, error: "Statut de Note invalide" };
    result.status = status;
  }
  return { ok: true, value: result };
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function noteSelectSql() {
  return `
    SELECT n.id, n.zone_id, z.slug AS zone_slug, z.name AS zone_name,
           n.created_by, n.updated_by, n.level, n.content, n.position,
           n.duration_type, n.expires_at, n.status, n.created_at,
           n.updated_at, n.archived_at
    FROM notes n
    INNER JOIN zones z ON z.id = n.zone_id
  `;
}

async function getZone(db, zoneId) {
  return db.prepare(`SELECT id, slug, name, status FROM zones WHERE id = ? LIMIT 1`).bind(zoneId).first();
}

async function getNote(db, noteId) {
  return db.prepare(`${noteSelectSql()} WHERE n.id = ? LIMIT 1`).bind(noteId).first();
}

async function log(env, deps, actorId, action, targetId, result, reason, metadata = {}) {
  try {
    await deps.writeAdminLog(env, actorId, action, "note", targetId, result, reason, metadata);
  } catch (error) {
    console.error("Erreur d'écriture du log Notes:", error);
  }
}

function response(deps, request, env, data, status) {
  return deps.jsonAuth(request, data, status, env);
}

export async function handleAdminNotesRequest(request, env, deps) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/notes" && !/^\/api\/admin\/notes\/\d+$/.test(url.pathname)) return null;

  const session = await deps.requireMember(request, env);
  if (!session) return response(deps, request, env, { error: "Authentification requise" }, 401);

  if (url.pathname === "/api/admin/notes" && request.method === "GET") {
    const requestedZoneId = url.searchParams.get("zone_id");
    const zoneId = requestedZoneId == null ? null : parsePositiveInteger(requestedZoneId);
    if (requestedZoneId != null && zoneId == null) return response(deps, request, env, { error: "zone_id invalide" }, 400);
    try {
      if (zoneId != null && !(await deps.canManageNotes(env.DB, session, zoneId))) {
        await log(env, deps, session.user.id, "note_list", zoneId, "denied", "Zone non attribuée", { zone_id: zoneId });
        return response(deps, request, env, { error: "Cette zone ne vous est pas attribuée" }, 403);
      }
      let rows;
      if (zoneId != null) {
        const zone = await getZone(env.DB, zoneId);
        if (!zone) return response(deps, request, env, { error: "Zone introuvable" }, 404);
        rows = await env.DB.prepare(`${noteSelectSql()} WHERE n.zone_id = ? ORDER BY n.created_at DESC, n.id DESC`).bind(zoneId).all();
      } else if (session.access === "admin") {
        rows = await env.DB.prepare(`${noteSelectSql()} WHERE z.status = 'active' ORDER BY n.created_at DESC, n.id DESC`).all();
      } else {
        const candidates = await env.DB.prepare(`
          SELECT DISTINCT z.id
          FROM zones z
          LEFT JOIN zone_moderators zm ON zm.zone_id = z.id AND zm.discord_user_id = ?
          LEFT JOIN zone_staff zs ON zs.zone_id = z.id AND zs.discord_user_id = ? AND zs.role IN ('manager', 'ally')
          WHERE z.status = 'active' AND (zm.zone_id IS NOT NULL OR zs.zone_id IS NOT NULL)
          ORDER BY z.id ASC
        `).bind(session.user.id, session.user.id).all();
        const allowedZoneIds = [];
        for (const row of candidates.results || []) {
          const candidateZoneId = Number(row.id);
          if (await deps.canManageNotes(env.DB, session, candidateZoneId)) allowedZoneIds.push(candidateZoneId);
        }
        if (allowedZoneIds.length === 0) return response(deps, request, env, { ok: true, notes: [] }, 200);
        const placeholders = allowedZoneIds.map(() => "?").join(",");
        rows = await env.DB.prepare(`${noteSelectSql()} WHERE n.zone_id IN (${placeholders}) ORDER BY n.created_at DESC, n.id DESC`).bind(...allowedZoneIds).all();
      }
      return response(deps, request, env, { ok: true, notes: rows.results || [] }, 200);
    } catch (error) {
      console.error("Erreur D1 GET /api/admin/notes:", error);
      return response(deps, request, env, { error: "Impossible de lire les Notes" }, 500);
    }
  }

  const noteMatch = url.pathname.match(/^\/api\/admin\/notes\/(\d+)$/);
  const noteId = noteMatch ? Number(noteMatch[1]) : null;

  if (noteMatch && request.method === "GET") {
    try {
      const note = await getNote(env.DB, noteId);
      if (!note) return response(deps, request, env, { error: "Note introuvable" }, 404);
      if (!(await deps.canManageNotes(env.DB, session, note.zone_id))) {
        await log(env, deps, session.user.id, "note_read", noteId, "denied", "Zone non attribuée", { zone_id: Number(note.zone_id) });
        return response(deps, request, env, { error: "Cette zone ne vous est pas attribuée" }, 403);
      }
      return response(deps, request, env, { ok: true, note }, 200);
    } catch (error) {
      console.error("Erreur D1 GET /api/admin/notes/:id:", error);
      return response(deps, request, env, { error: "Impossible de lire la Note" }, 500);
    }
  }

  if (url.pathname === "/api/admin/notes" && request.method === "POST") {
    let body;
    try { body = await request.json(); }
    catch { return response(deps, request, env, { error: "Requête JSON invalide" }, 400); }
    const zoneId = parsePositiveInteger(body?.zone_id);
    if (zoneId == null) return response(deps, request, env, { error: "zone_id invalide" }, 400);
    try {
      const zone = await getZone(env.DB, zoneId);
      if (!zone) return response(deps, request, env, { error: "Zone introuvable" }, 404);
      if (zone.status !== "active") return response(deps, request, env, { error: "La zone doit être active" }, 400);
      if (!(await deps.canManageNotes(env.DB, session, zoneId))) {
        await log(env, deps, session.user.id, "note_create", zoneId, "denied", "Zone non attribuée", { zone_id: zoneId });
        return response(deps, request, env, { error: "Cette zone ne vous est pas attribuée" }, 403);
      }
      const validation = validateNotePayload(body);
      if (!validation.ok) return response(deps, request, env, { error: validation.error }, validation.status);
      const value = validation.value;
      const now = new Date().toISOString();
      const result = await env.DB.prepare(`
        INSERT INTO notes (zone_id, created_by, updated_by, level, content, position, duration_type, expires_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(zoneId, session.user.id, session.user.id, value.level, value.content, value.position, value.duration_type, value.expires_at, now, now).run();
      const createdId = Number(result?.meta?.last_row_id ?? result?.meta?.last_rowid ?? result?.last_row_id ?? 0);
      if (!createdId) throw new Error("D1 n'a pas retourné l'identifiant de la Note créée");
      const note = await getNote(env.DB, createdId);
      await log(env, deps, session.user.id, "note_create", createdId, "success", "Note créée", { zone_id: zoneId });
      return response(deps, request, env, { ok: true, note }, 201);
    } catch (error) {
      console.error("Erreur D1 POST /api/admin/notes:", error);
      await log(env, deps, session.user.id, "note_create", zoneId, "error", "Échec de création", { message: String(error?.message || error) });
      return response(deps, request, env, { error: "Impossible de créer la Note" }, 500);
    }
  }

  if (noteMatch && request.method === "PATCH") {
    let body;
    try { body = await request.json(); }
    catch { return response(deps, request, env, { error: "Requête JSON invalide" }, 400); }
    try {
      const current = await getNote(env.DB, noteId);
      if (!current) return response(deps, request, env, { error: "Note introuvable" }, 404);
      if (!(await deps.canManageNotes(env.DB, session, current.zone_id))) {
        await log(env, deps, session.user.id, "note_update", noteId, "denied", "Zone non attribuée", { zone_id: Number(current.zone_id) });
        return response(deps, request, env, { error: "Cette zone ne vous est pas attribuée" }, 403);
      }
      let value = { level: current.level, content: current.content, position: current.position, duration_type: current.duration_type, expires_at: current.expires_at };
      const contentBody = { level: body?.level ?? current.level, content: body?.content ?? current.content, position: body?.position ?? current.position };
      if (Object.prototype.hasOwnProperty.call(body || {}, "duration_type")) {
        contentBody.duration_type = body.duration_type;
        contentBody.expires_at = body?.expires_at;
      } else if (Object.prototype.hasOwnProperty.call(body || {}, "expires_at")) {
        return response(deps, request, env, { error: "duration_type doit être fourni avec expires_at" }, 400);
      }
      const validation = validateNotePayload(contentBody);
      if (!validation.ok) return response(deps, request, env, { error: validation.error }, validation.status);
      value = { ...value, ...validation.value };
      const status = body?.status == null ? current.status : String(body.status).trim().toLowerCase();
      if (!NOTE_MUTABLE_STATUSES.has(status)) return response(deps, request, env, { error: "Statut de Note invalide" }, 400);
      const now = new Date().toISOString();
      const archivedAt = status === "archived" ? (current.archived_at || now) : null;
      await env.DB.prepare(`
        UPDATE notes SET level = ?, content = ?, position = ?, duration_type = ?, expires_at = ?, status = ?, updated_by = ?, archived_at = ?
        WHERE id = ?
      `).bind(value.level, value.content, value.position, value.duration_type, value.expires_at, status, session.user.id, archivedAt, noteId).run();
      const note = await getNote(env.DB, noteId);
      await log(env, deps, session.user.id, "note_update", noteId, "success", "Note mise à jour", { zone_id: Number(current.zone_id) });
      return response(deps, request, env, { ok: true, note }, 200);
    } catch (error) {
      console.error("Erreur D1 PATCH /api/admin/notes/:id:", error);
      await log(env, deps, session.user.id, "note_update", noteId, "error", "Échec de mise à jour", { message: String(error?.message || error) });
      return response(deps, request, env, { error: "Impossible de mettre à jour la Note" }, 500);
    }
  }

  if (noteMatch && request.method === "DELETE") {
    try {
      const current = await getNote(env.DB, noteId);
      if (!current) return response(deps, request, env, { error: "Note introuvable" }, 404);
      if (!(await deps.canManageNotes(env.DB, session, current.zone_id))) {
        await log(env, deps, session.user.id, "note_archive", noteId, "denied", "Zone non attribuée", { zone_id: Number(current.zone_id) });
        return response(deps, request, env, { error: "Cette zone ne vous est pas attribuée" }, 403);
      }
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE notes SET status = 'archived', archived_at = ?, updated_by = ? WHERE id = ?`).bind(now, session.user.id, noteId).run();
      const note = await getNote(env.DB, noteId);
      await log(env, deps, session.user.id, "note_archive", noteId, "success", "Note archivée", { zone_id: Number(current.zone_id) });
      return response(deps, request, env, { ok: true, note }, 200);
    } catch (error) {
      console.error("Erreur D1 DELETE /api/admin/notes/:id:", error);
      await log(env, deps, session.user.id, "note_archive", noteId, "error", "Échec d'archivage", { message: String(error?.message || error) });
      return response(deps, request, env, { error: "Impossible d'archiver la Note" }, 500);
    }
  }

  return response(deps, request, env, { error: "Méthode non autorisée" }, 405);
}
