import { MemoryBaselineStore } from "./baseline-store.js";
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
    this.baselineStore = options.baselineStore || new MemoryBaselineStore();
    this.radarId = options.radarId || "default";
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
    if (!Array.isArray(tiles) || tiles.length === 0) {
      throw new Error("Aucune tuile à scanner");
    }

    const seenAt = options.seenAt || new Date().toISOString();
    const analysisOptions = { ...this.analysisOptions, ...(options.analysisOptions || {}) };
    const radarId = options.radarId || this.radarId;
    const baselineStore = options.baselineStore || this.baselineStore;
    const currentBaseline = await baselineStore.getCurrent(radarId);
    const candidate = await baselineStore.createCandidate(radarId, tiles);

    let results;
    try {
      results = await mapWithConcurrency(
        tiles,
        async ({ tileX, tileY }) => {
          const key = tileKey(tileX, tileY);

          try {
            const current = await this.source.fetchTile(tileX, tileY, { fresh: true });
            const previous = currentBaseline
              ? await baselineStore.getTile(radarId, tileX, tileY, { version: currentBaseline.version })
              : null;

            await baselineStore.putTile(candidate, current);

            if (!previous) {
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

      const errorTiles = results.filter((result) => result.state === "error").length;
      if (errorTiles > 0) {
        await baselineStore.abortCandidate(candidate);
        return {
          scannedAt: seenAt,
          status: "failed",
          requestedTiles: tiles.length,
          baselineTiles: results.filter((result) => result.state === "baseline").length,
          scannedTiles: results.filter((result) => result.state === "scanned").length,
          errorTiles,
          changedTiles: results.filter((result) => result.changed).length,
          alertTiles: results.filter((result) => result.severity === "alert").length,
          urgentTiles: results.filter((result) => result.severity === "urgent").length,
          results
        };
      }

      const finalizedCandidate = await baselineStore.finalizeCandidate(candidate);
      await baselineStore.commitCandidate(finalizedCandidate);

      return {
        scannedAt: seenAt,
        status: "committed",
        requestedTiles: tiles.length,
        baselineTiles: results.filter((result) => result.state === "baseline").length,
        scannedTiles: results.filter((result) => result.state === "scanned").length,
        errorTiles: 0,
        changedTiles: results.filter((result) => result.changed).length,
        alertTiles: results.filter((result) => result.severity === "alert").length,
        urgentTiles: results.filter((result) => result.severity === "urgent").length,
        results
      };
    } catch (error) {
      try {
        await baselineStore.abortCandidate(candidate);
      } catch {
        // Preserve the original scan error. Candidate cleanup can be retried separately.
      }
      throw error;
    }
  }

  async scanRectangle(bounds, options = {}) {
    return this.scanTiles(this.planRectangle(bounds), options);
  }

  async scanPolygon(ring, options = {}) {
    return this.scanTiles(this.planPolygon(ring), options);
  }
}

export { tileKey };
