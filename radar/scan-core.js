import { compareTiles, findChangedRegions, summarizeDiff } from "./tile-diff.js";

// Turns two decoded tile states into compact Radar metrics.
// This layer deliberately does not classify ally art vs attack/grief yet.
// Classification requires template/context data and is a later stage.

export function analyzeTileChange(previous, current, options = {}) {
  const diff = compareTiles(previous, current);
  if (diff.changedPixels === 0) {
    return {
      changed: false,
      severity: "none",
      diff,
      regions: [],
      summary: summarizeDiff(diff, [])
    };
  }

  const regions = findChangedRegions(diff, {
    maxRegions: options.maxRegions ?? 128,
    minPixels: options.minRegionPixels ?? 2
  });
  const summary = summarizeDiff(diff, regions);

  const alertThreshold = options.alertThreshold ?? Infinity;
  const urgencyThreshold = options.urgencyThreshold ?? Infinity;
  const score = calculateChangeScore(summary, options);

  let severity = "observation";
  if (score >= urgencyThreshold) severity = "urgent";
  else if (score >= alertThreshold) severity = "alert";

  return {
    changed: true,
    severity,
    score,
    diff,
    regions,
    summary
  };
}

export function calculateChangeScore(summary, options = {}) {
  const pixelWeight = options.pixelWeight ?? 1;
  const regionWeight = options.regionWeight ?? 20;
  const densityWeight = options.densityWeight ?? 50;

  if (!summary.bounds || summary.changedPixels === 0) return 0;

  const width = summary.bounds.maxX - summary.bounds.minX + 1;
  const height = summary.bounds.maxY - summary.bounds.minY + 1;
  const area = Math.max(1, width * height);
  const density = summary.changedMeaningfulPixels / area;

  return Math.round(
    summary.changedMeaningfulPixels * pixelWeight +
    summary.regionCount * regionWeight +
    density * densityWeight
  );
}

export function regionToTileRecord(tileX, tileY, region, seenAt) {
  return {
    tile_x: tileX,
    tile_y: tileY,
    min_x: region.minX,
    min_y: region.minY,
    max_x: region.maxX,
    max_y: region.maxY,
    pixel_count: region.pixelCount,
    first_seen_at: seenAt,
    last_seen_at: seenAt
  };
}
