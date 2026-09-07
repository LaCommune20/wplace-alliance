import { analyzeTileChange } from "./scan-core.js";
import { enumerateTilesForLngLatPolygon, enumerateTilesForRectangle } from "./scan-planner.js";

function tileKey(tileX, tileY) {
  return `${tileX}/${tileY}`;
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const count = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

export class RadarScanRunner {
  constructor(source, options = {}) {
    if (!source || typeof source.fetchTile !== "function") {
      throw new Error("Une source WPlace valide est nécessaire");
    }

    this.source = source;
    this.baseline = options.baseline || new Map();
    this.concurrency = options.concurrency ?? 2;
    this.analysisOptions = options.analysisOptions || {};
  }

  planRectangle(bounds) {
    return enumerateTilesForRectangle(
      bounds,
      this.source.tileSize,
      this.source.tileSize
    );
  }

  planPolygon(ring) {
    return enumerateTilesForLngLatPolygon(ring, {
      worldSize: this.source.worldSize,
      tileWidth: this.source.tileSize,
      tileHeight: this.source.tileSize
    });
  }

  async scanTiles(tiles, options = {}) {
    const seenAt = options.seenAt || new Date().toISOString();
    const analysisOptions = { ...this.analysisOptions, ...(options.analysisOptions || {}) };

    const results = await mapWithConcurrency(
      tiles,
      async ({ tileX, tileY }) => {
        const key = tileKey(tileX, tileY);

        try {
          const current = await this.source.fetchTile(tileX, tileY, { fresh: true });
          const previous = this.baseline.get(key);

          if (!previous) {
            this.baseline.set(key, current);
            return {
              tileX,
              tileY,
              state: "baseline",
              changed: false,
              severity: "none",
              error: null
            };
          }

          const analysis = analyzeTileChange(previous, current, analysisOptions);
          this.baseline.set(key, current);

          return {
            tileX,
            tileY,
            state: "scanned",
            ...analysis,
            error: null
          };
        } catch (error) {
          return {
            tileX,
            tileY,
            state: "error",
            changed: false,
            severity: "none",
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      options.concurrency ?? this.concurrency
    );

    return {
      scannedAt: seenAt,
      requestedTiles: tiles.length,
      baselineTiles: results.filter((result) => result.state === "baseline").length,
      scannedTiles: results.filter((result) => result.state === "scanned").length,
      errorTiles: results.filter((result) => result.state === "error").length,
      changedTiles: results.filter((result) => result.changed).length,
      alertTiles: results.filter((result) => result.severity === "alert").length,
      urgentTiles: results.filter((result) => result.severity === "urgent").length,
      results
    };
  }

  async scanRectangle(bounds, options = {}) {
    return this.scanTiles(this.planRectangle(bounds), options);
  }

  async scanPolygon(ring, options = {}) {
    return this.scanTiles(this.planPolygon(ring), options);
  }
}

export { tileKey };
