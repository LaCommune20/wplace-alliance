// Geometry helpers for selecting WPlace tiles before a Radar scan.
// Coordinates are abstract global pixel coordinates: the caller supplies
// the real WPlace tile size once the live proxy contract is validated.

function boundsOfPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error("Un polygone avec au moins 3 points est nécessaire");
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of polygon) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Coordonnée de polygone invalide");
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(ax, ay, bx, by, cx, cy) {
  const value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(ax, ay, bx, by, cx, cy) {
  return Math.min(ax, cx) - 1e-9 <= bx && bx <= Math.max(ax, cx) + 1e-9 &&
    Math.min(ay, cy) - 1e-9 <= by && by <= Math.max(ay, cy) + 1e-9;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orientation(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orientation(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orientation(c[0], c[1], d[0], d[1], b[0], b[1]);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a[0], a[1], c[0], c[1], b[0], b[1])) return true;
  if (o2 === 0 && onSegment(a[0], a[1], d[0], d[1], b[0], b[1])) return true;
  if (o3 === 0 && onSegment(c[0], c[1], a[0], a[1], d[0], d[1])) return true;
  if (o4 === 0 && onSegment(c[0], c[1], b[0], b[1], d[0], d[1])) return true;
  return false;
}

function tileIntersectsPolygon(tileX, tileY, tileSize, polygon) {
  const left = tileX * tileSize, top = tileY * tileSize;
  const right = left + tileSize, bottom = top + tileSize;
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]];
  if (corners.some(([x, y]) => pointInPolygon(x, y, polygon))) return true;
  if (pointInPolygon((left + right) / 2, (top + bottom) / 2, polygon)) return true;
  const edges = [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[3]], [corners[3], corners[0]]];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    for (const [c, d] of edges) if (segmentsIntersect(a, b, c, d)) return true;
  }
  return false;
}

function enumerateBounds(bounds, tileSize) {
  if (!Number.isFinite(tileSize) || tileSize <= 0) throw new Error("tileSize doit être un nombre positif");
  const minTileX = Math.floor(bounds.minX / tileSize);
  const minTileY = Math.floor(bounds.minY / tileSize);
  const maxTileX = Math.floor(bounds.maxX / tileSize);
  const maxTileY = Math.floor(bounds.maxY / tileSize);
  const tiles = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (tileX >= 0 && tileY >= 0) tiles.push({ tileX, tileY });
    }
  }
  return tiles;
}

export function planRectangle(rectangle, tileSize) {
  const minX = Math.min(rectangle.minX, rectangle.maxX);
  const minY = Math.min(rectangle.minY, rectangle.maxY);
  const maxX = Math.max(rectangle.minX, rectangle.maxX);
  const maxY = Math.max(rectangle.minY, rectangle.maxY);
  return enumerateBounds({ minX, minY, maxX, maxY }, tileSize);
}

export function planPolygon(polygon, tileSize) {
  const bounds = boundsOfPolygon(polygon);
  return enumerateBounds(bounds, tileSize).filter(({ tileX, tileY }) => tileIntersectsPolygon(tileX, tileY, tileSize, polygon));
}

export function globalPixelToTile(x, y, tileSize) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error("Coordonnée ou tileSize invalide");
  }
  const tileX = Math.floor(x / tileSize), tileY = Math.floor(y / tileSize);
  return { tileX, tileY, localX: x - tileX * tileSize, localY: y - tileY * tileSize };
}

export function tileRegionToGlobal(tileX, tileY, region, tileSize) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) throw new Error("Coordonnée de tuile invalide");
  return {
    minX: tileX * tileSize + region.minX,
    minY: tileY * tileSize + region.minY,
    maxX: tileX * tileSize + region.maxX,
    maxY: tileY * tileSize + region.maxY
  };
}
