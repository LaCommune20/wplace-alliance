// Pure tile comparison logic. No network, D1 or Discord dependency.
// Input tiles must expose { width, height, rgba } with RGBA8 pixels.

function samePixel(a, b, offset) {
  return (
    a[offset] === b[offset] &&
    a[offset + 1] === b[offset + 1] &&
    a[offset + 2] === b[offset + 2] &&
    a[offset + 3] === b[offset + 3]
  );
}

function pixelIsMeaningful(rgba, offset) {
  // Transparent pixels are still a valid tile state, but this helper makes
  // it possible to ignore fully transparent padding if WPlace ever exposes it.
  return rgba[offset + 3] !== 0;
}

export function compareTiles(previous, current) {
  if (!previous || !current) {
    throw new Error("Deux états de tuile sont nécessaires");
  }
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new Error("Dimensions de tuiles incompatibles");
  }

  const pixelCount = current.width * current.height;
  if (previous.rgba.length !== pixelCount * 4 || current.rgba.length !== pixelCount * 4) {
    throw new Error("Buffer RGBA invalide");
  }

  const changed = new Uint8Array(pixelCount);
  let changedPixels = 0;
  let changedMeaningfulPixels = 0;
  let minX = current.width;
  let minY = current.height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (samePixel(previous.rgba, current.rgba, offset)) continue;

    changed[index] = 1;
    changedPixels += 1;
    if (pixelIsMeaningful(current.rgba, offset)) changedMeaningfulPixels += 1;

    const x = index % current.width;
    const y = Math.floor(index / current.width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    width: current.width,
    height: current.height,
    changed,
    changedPixels,
    changedMeaningfulPixels,
    bounds: changedPixels
      ? { minX, minY, maxX, maxY }
      : null
  };
}

export function findChangedRegions(diff, options = {}) {
  const { width, height, changed } = diff;
  const maxRegions = options.maxRegions ?? 128;
  const minPixels = options.minPixels ?? 1;

  if (changed.length !== width * height) {
    throw new Error("Masque de changement invalide");
  }

  // Queue fixed-size: 4 MB for a 1000x1000 tile instead of allocating
  // millions of JS array entries.
  const queue = new Int32Array(width * height);
  const visited = new Uint8Array(width * height);
  const regions = [];

  for (let start = 0; start < changed.length; start += 1) {
    if (!changed[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);

      pixelCount += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);

      for (const neighbor of neighbors) {
        if (!changed[neighbor] || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }

    if (pixelCount >= minPixels) {
      regions.push({ pixelCount, minX, minY, maxX, maxY });
      if (regions.length >= maxRegions) break;
    }
  }

  regions.sort((a, b) => b.pixelCount - a.pixelCount);
  return regions;
}

export function summarizeDiff(diff, regions) {
  return {
    changedPixels: diff.changedPixels,
    changedMeaningfulPixels: diff.changedMeaningfulPixels,
    regionCount: regions.length,
    bounds: diff.bounds,
    largestRegion: regions[0] || null,
    regionPixels: regions.reduce((sum, region) => sum + region.pixelCount, 0)
  };
}
