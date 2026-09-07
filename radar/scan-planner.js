import { enumerateTilesForBounds, lngLatToWorldPixel } from "./tile-geometry.js";

function pointInPolygon(point, ring) {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, p) {
  return (
    p[0] >= Math.min(a[0], b[0]) - 1e-9 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-9 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-9
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

function polygonIntersectsRect(ring, rect) {
  const rectCorners = [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY]
  ];

  if (ring.some(([x, y]) => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY)) {
    return true;
  }

  if (rectCorners.some((corner) => pointInPolygon(corner, ring))) return true;

  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (let j = 0; j < rectCorners.length; j += 1) {
      const c = rectCorners[j];
      const d = rectCorners[(j + 1) % rectCorners.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }

  return false;
}

function polygonBounds(ring) {
  if (!Array.isArray(ring) || ring.length < 3) throw new Error("Polygone invalide");
  const points = ring.map(([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Point de polygone invalide");
    return [x, y];
  });

  return points.reduce(
    (bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      minY: Math.min(bounds.minY, y),
      maxX: Math.max(bounds.maxX, x),
      maxY: Math.max(bounds.maxY, y)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

export function enumerateTilesForWorldPolygon(ring, tileWidth, tileHeight = tileWidth) {
  const bounds = polygonBounds(ring);
  const candidates = enumerateTilesForBounds(bounds, tileWidth, tileHeight);
  const tiles = [];

  for (const tile of candidates) {
    const rect = {
      minX: tile.tileX * tileWidth,
      minY: tile.tileY * tileHeight,
      maxX: (tile.tileX + 1) * tileWidth,
      maxY: (tile.tileY + 1) * tileHeight
    };

    if (polygonIntersectsRect(ring, rect)) tiles.push(tile);
  }

  return tiles;
}

export function enumerateTilesForLngLatPolygon(ring, options = {}) {
  const worldSize = options.worldSize ?? 2048000;
  const tileWidth = options.tileWidth ?? 1000;
  const tileHeight = options.tileHeight ?? tileWidth;

  if (!Array.isArray(ring) || ring.length < 3) throw new Error("Polygone géographique invalide");

  const worldRing = ring.map(([lng, lat]) => {
    const point = lngLatToWorldPixel(lng, lat, worldSize);
    return [point.x, point.y];
  });

  return enumerateTilesForWorldPolygon(worldRing, tileWidth, tileHeight);
}

export function enumerateTilesForRectangle(bounds, tileWidth = 1000, tileHeight = tileWidth) {
  return enumerateTilesForBounds(bounds, tileWidth, tileHeight);
}

export { pointInPolygon, polygonIntersectsRect };
