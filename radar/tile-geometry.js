// Coordinate helpers kept independent from WPlace's live API details.
// The tile size is always supplied explicitly so we do not hardcode an
// unverified WPlace tile dimension into the Radar.

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
