import { enumerateTilesForLngLatPolygon, enumerateTilesForRectangle } from "./scan-planner.js";

const DEFAULT_WORLD_SIZE = 2048000;
const DEFAULT_TILE_SIZE = 1000;

function finite(value) {
  return Number.isFinite(Number(value));
}

function parseJson(value, label) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} JSON invalide`);
  }
}

function normalizePolygon(value) {
  const polygon = parseJson(value, "Polygone");
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error("Polygone invalide");
  }

  return polygon.map((point) => {
    if (!Array.isArray(point) || point.length < 2 || !finite(point[0]) || !finite(point[1])) {
      throw new Error("Point de polygone invalide");
    }
    return [Number(point[0]), Number(point[1])];
  });
}

function normalizeRectangle(value) {
  const rectangle = parseJson(value, "Rectangle");
  if (!rectangle || typeof rectangle !== "object" || Array.isArray(rectangle)) {
    throw new Error("Rectangle invalide");
  }

  const west = Number(rectangle.west ?? rectangle.minLng ?? rectangle.minLon);
  const south = Number(rectangle.south ?? rectangle.minLat);
  const east = Number(rectangle.east ?? rectangle.maxLng ?? rectangle.maxLon);
  const north = Number(rectangle.north ?? rectangle.maxLat);

  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error("Bornes du rectangle invalides");
  }
  if (west > east || south > north) {
    throw new Error("Bornes du rectangle inversées");
  }
  if (west < -180 || east > 180 || south < -90 || north > 90) {
    throw new Error("Rectangle géographique hors limites");
  }

  return { west, south, east, north };
}

export function resolveRadarScope(radar, zone = null, options = {}) {
  if (!radar || typeof radar !== "object") throw new Error("Radar invalide");

  const worldSize = options.worldSize ?? DEFAULT_WORLD_SIZE;
  const tileWidth = options.tileWidth ?? DEFAULT_TILE_SIZE;
  const tileHeight = options.tileHeight ?? tileWidth;

  if (!Number.isFinite(worldSize) || worldSize <= 0) throw new Error("Taille monde invalide");

  if (radar.type === "zone") {
    if (!zone || typeof zone !== "object") throw new Error("Zone requise pour un radar de type zone");
    const polygon = normalizePolygon(zone.polygon);
    return {
      type: "zone",
      zoneId: zone.id ?? null,
      polygon,
      tiles: enumerateTilesForLngLatPolygon(polygon, { worldSize, tileWidth, tileHeight })
    };
  }

  if (radar.type === "rectangle") {
    const rectangle = normalizeRectangle(radar.geometry);
    const worldWest = ((rectangle.west + 180) / 360) * worldSize;
    const worldEast = ((rectangle.east + 180) / 360) * worldSize;

    const projectY = (lat) => {
      const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const sin = Math.sin((clamped * Math.PI) / 180);
      return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize;
    };

    const ySouth = projectY(rectangle.south);
    const yNorth = projectY(rectangle.north);

    return {
      type: "rectangle",
      zoneId: zone?.id ?? null,
      rectangle,
      tiles: enumerateTilesForRectangle(
        {
          minX: Math.min(worldWest, worldEast),
          minY: Math.min(yNorth, ySouth),
          maxX: Math.max(worldWest, worldEast),
          maxY: Math.max(yNorth, ySouth)
        },
        tileWidth,
        tileHeight
      )
    };
  }

  throw new Error("Type de radar invalide");
}

export { normalizePolygon, normalizeRectangle };
