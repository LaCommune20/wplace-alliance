// Pure spatial grouping for Radar observations.
// Regions are grouped by connected proximity in WPlace world pixels.

const DEFAULT_PROXIMITY_PIXELS = 32;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function worldBounds(region) {
  const tileX = finiteNumber(region.tile_x ?? region.tileX);
  const tileY = finiteNumber(region.tile_y ?? region.tileY);
  const minX = finiteNumber(region.min_x ?? region.minX);
  const minY = finiteNumber(region.min_y ?? region.minY);
  const maxX = finiteNumber(region.max_x ?? region.maxX);
  const maxY = finiteNumber(region.max_y ?? region.maxY);
  return {
    minX: tileX * 1000 + minX,
    minY: tileY * 1000 + minY,
    maxX: tileX * 1000 + maxX,
    maxY: tileY * 1000 + maxY
  };
}

function axisGap(aMin, aMax, bMin, bMax) {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

export function regionsAreClose(a, b, proximityPixels = DEFAULT_PROXIMITY_PIXELS) {
  const left = worldBounds(a);
  const right = worldBounds(b);
  const dx = axisGap(left.minX, left.maxX, right.minX, right.maxX);
  const dy = axisGap(left.minY, left.maxY, right.minY, right.maxY);
  return Math.hypot(dx, dy) <= proximityPixels;
}

export function groupRegionsByProximity(regions = [], proximityPixels = DEFAULT_PROXIMITY_PIXELS) {
  const remaining = regions.map((_, index) => index);
  const groups = [];

  while (remaining.length) {
    const seed = remaining.shift();
    const groupIndexes = [seed];
    const queue = [seed];

    while (queue.length) {
      const current = queue.shift();
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const candidate = remaining[i];
        if (!regionsAreClose(regions[current], regions[candidate], proximityPixels)) continue;
        remaining.splice(i, 1);
        groupIndexes.push(candidate);
        queue.push(candidate);
      }
    }

    groups.push(groupIndexes.map(index => regions[index]));
  }

  return groups;
}

export const EVENT_REGION_GROUP_DEFAULTS = Object.freeze({
  proximityPixels: DEFAULT_PROXIMITY_PIXELS
});
