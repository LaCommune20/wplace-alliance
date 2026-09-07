// Coordinate helpers for the Radar.
// WPlace's current world is 2048 tiles x 1000 pixels at native zoom 11,
// but tile/world dimensions remain explicit so the code is easy to validate.

export function validateTileSize(tileWidth, tileHeight = tileWidth) {
  const width = Number(tileWidth);
  const height = Number(tileHeight);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Taille de tuile invalide");
  }
  return { width, height };
}

export function tilePixelToWorld(tileX, tileY, pixelX, pixelY, tileWidth, tileHeight = tileWidth) {
  const size = validateTileSize(tileWidth, tileHeight);
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
    throw new Error("Coordonnées de tuile invalides");
  }
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
    throw new Error("Coordonnées pixel invalides");
  }

  return {
    x: tileX * size.width + pixelX,
    y: tileY * size.height + pixelY
  };
}

export function regionToWorldBounds(tileX, tileY, region, tileWidth, tileHeight = tileWidth) {
  if (!region) throw new Error("Région absente");
  const topLeft = tilePixelToWorld(tileX, tileY, region.minX, region.minY, tileWidth, tileHeight);
  const bottomRight = tilePixelToWorld(tileX, tileY, region.maxX, region.maxY, tileWidth, tileHeight);
  return {
    minX: topLeft.x,
    minY: topLeft.y,
    maxX: bottomRight.x,
    maxY: bottomRight.y
  };
}

export function enumerateTilesForBounds(bounds, tileWidth, tileHeight = tileWidth) {
  const size = validateTileSize(tileWidth, tileHeight);
  if (!bounds || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
    throw new Error("Bornes invalides");
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new Error("Bornes inversées");
  }

  const minTileX = Math.floor(bounds.minX / size.width);
  const maxTileX = Math.floor(bounds.maxX / size.width);
  const minTileY = Math.floor(bounds.minY / size.height);
  const maxTileY = Math.floor(bounds.maxY / size.height);
  const tiles = [];

  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) {
      tiles.push({ tileX: x, tileY: y });
    }
  }

  return tiles;
}

export function lngLatToWorldPixel(lng, lat, worldSize = 2048000) {
  if (![lng, lat, worldSize].every(Number.isFinite) || worldSize <= 0) {
    throw new Error("Coordonnée géographique invalide");
  }
  if (lng < -180 || lng > 180) throw new Error("Longitude hors limites");

  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize
  };
}

export function worldPixelToLngLat(x, y, worldSize = 2048000) {
  if (![x, y, worldSize].every(Number.isFinite) || worldSize <= 0) {
    throw new Error("Coordonnée monde invalide");
  }

  const lng = (x / worldSize) * 360 - 180;
  const y2 = 0.5 - y / worldSize;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(y2 * 2 * Math.PI)) - 90;
  return { lng, lat };
}
