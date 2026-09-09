import { resolveRadarScope } from "./radar-scope.js";

function parseJson(value, label) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} JSON invalide`);
  }
}

/**
 * The zones table stores polygon points as [latitude, longitude].
 * radar-scope works with the conventional [longitude, latitude] order.
 */
export function normalizeStoredZonePolygon(value) {
  const polygon = parseJson(value, "Polygone de zone");
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error("Polygone de zone invalide");
  }

  return polygon.map((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      throw new Error("Sommet de polygone de zone invalide");
    }

    const lat = Number(point[0]);
    const lng = Number(point[1]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 || lat > 90 ||
      lng < -180 || lng > 180
    ) {
      throw new Error("Coordonnée du polygone de zone invalide");
    }

    return [lng, lat];
  });
}

export function normalizeRadarRow(row) {
  if (!row || typeof row !== "object") throw new Error("Radar introuvable");
  if (row.type !== "zone" && row.type !== "rectangle") {
    throw new Error("Type de radar invalide");
  }
  if (!["active", "paused", "archived"].includes(row.status)) {
    throw new Error("Statut de radar invalide");
  }

  return {
    ...row,
    zone_id: Number(row.zone_id),
    scan_interval_seconds: Number(row.scan_interval_seconds),
    geometry: parseJson(row.geometry, "Géométrie du radar")
  };
}

export async function loadRadarRuntimeConfig(db, radarId) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("Binding DB invalide");
  }
  const id = String(radarId || "").trim();
  if (!id) throw new Error("radar_id requis");

  const radar = await db.prepare(`
    SELECT
      r.id,
      r.zone_id,
      r.created_by,
      r.type,
      r.geometry,
      r.status,
      r.scan_interval_seconds,
      r.notification_mode,
      r.alert_threshold,
      r.urgency_threshold,
      r.last_scan_at,
      r.last_success_at,
      r.last_error_at,
      r.created_at,
      r.updated_at,
      z.slug AS zone_slug,
      z.name AS zone_name,
      z.status AS zone_status,
      z.polygon AS zone_polygon
    FROM radars r
    INNER JOIN zones z ON z.id = r.zone_id
    WHERE r.id = ?
    LIMIT 1
  `).bind(id).first();

  if (!radar) throw new Error("Radar introuvable");
  const normalizedRadar = normalizeRadarRow(radar);

  if (normalizedRadar.zone_status !== "active") {
    throw new Error("Zone du Radar inactive ou archivée");
  }

  const zone = {
    id: normalizedRadar.zone_id,
    slug: normalizedRadar.zone_slug,
    name: normalizedRadar.zone_name,
    status: normalizedRadar.zone_status,
    polygon: normalizeStoredZonePolygon(radar.zone_polygon)
  };

  const scope = resolveRadarScope(normalizedRadar, zone);

  return {
    radar: normalizedRadar,
    zone,
    scope
  };
}
