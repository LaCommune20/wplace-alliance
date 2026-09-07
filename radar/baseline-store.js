import { decodePng } from "./png-decoder.js";

function tileKey(tileX, tileY) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0) {
    throw new Error("Coordonnées de tuile invalides");
  }
  return `${tileX}/${tileY}`;
}

function normalizeTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw new Error("Au moins une tuile est nécessaire");
  }

  const keys = tiles.map(({ tileX, tileY }) => tileKey(tileX, tileY));
  return [...new Set(keys)].sort();
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function candidatePrefix(radarId, version) {
  return `baselines/${encodeURIComponent(radarId)}/${encodeURIComponent(version)}`;
}

function tileObjectKey(candidate, tileX, tileY) {
  return `${candidatePrefix(candidate.radarId, candidate.version)}/tiles/${tileKey(tileX, tileY)}.png`;
}

export class BaselineStoreError extends Error {
  constructor(message, code = "BASELINE_STORE_ERROR") {
    super(message);
    this.name = "BaselineStoreError";
    this.code = code;
  }
}

/**
 * Reference implementation used by tests and local execution.
 * It deliberately follows the same candidate -> finalize -> commit contract
 * as the persistent R2/D1 implementation.
 */
export class MemoryBaselineStore {
  constructor() {
    this.current = new Map();
    this.candidates = new Map();
  }

  async createCandidate(radarId, tiles) {
    const expectedTiles = normalizeTiles(tiles);
    const candidate = {
      id: makeId(),
      radarId,
      version: makeId(),
      expectedTiles,
      tiles: new Map(),
      finalized: false
    };
    this.candidates.set(candidate.id, candidate);
    return candidate;
  }

  async putTile(candidate, tile) {
    const state = this.candidates.get(candidate.id);
    if (!state) throw new BaselineStoreError("Candidat introuvable", "CANDIDATE_NOT_FOUND");
    if (state.finalized) throw new BaselineStoreError("Candidat déjà finalisé", "CANDIDATE_FINALIZED");

    const key = tileKey(tile.tileX, tile.tileY);
    if (!state.expectedTiles.includes(key)) {
      throw new BaselineStoreError(`Tuile ${key} absente du plan`, "UNEXPECTED_TILE");
    }

    state.tiles.set(key, tile);
  }

  async finalizeCandidate(candidate) {
    const state = this.candidates.get(candidate.id);
    if (!state) throw new BaselineStoreError("Candidat introuvable", "CANDIDATE_NOT_FOUND");

    const actual = [...state.tiles.keys()].sort();
    const complete = actual.length === state.expectedTiles.length
      && actual.every((key, index) => key === state.expectedTiles[index]);

    if (!complete) {
      throw new BaselineStoreError(
        "Candidat incomplet: toutes les tuiles attendues ne sont pas présentes",
        "INCOMPLETE_CANDIDATE"
      );
    }

    state.finalized = true;
    return { ...candidate, finalized: true };
  }

  async commitCandidate(candidate) {
    const state = this.candidates.get(candidate.id);
    if (!state) throw new BaselineStoreError("Candidat introuvable", "CANDIDATE_NOT_FOUND");
    if (!state.finalized) throw new BaselineStoreError("Candidat non finalisé", "CANDIDATE_NOT_FINALIZED");

    this.current.set(candidate.radarId, {
      version: candidate.version,
      tiles: new Map(state.tiles)
    });
    this.candidates.delete(candidate.id);

    return {
      radarId: candidate.radarId,
      version: candidate.version,
      tileCount: state.tiles.size
    };
  }

  async abortCandidate(candidate) {
    this.candidates.delete(candidate.id);
    return { id: candidate.id, status: "aborted" };
  }

  async getCurrent(radarId) {
    const current = this.current.get(radarId);
    if (!current) return null;
    return {
      radarId,
      version: current.version,
      tileCount: current.tiles.size
    };
  }

  async getTile(radarId, tileX, tileY) {
    const current = this.current.get(radarId);
    if (!current) return null;
    return current.tiles.get(tileKey(tileX, tileY)) || null;
  }
}

/**
 * Persistent implementation: R2 stores PNG tile objects; D1 stores only
 * candidate/current metadata and the current baseline pointer.
 */
export class R2D1BaselineStore {
  constructor({ bucket, db, now = () => new Date() }) {
    if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function" || typeof bucket.list !== "function") {
      throw new Error("Un bucket R2 valide est nécessaire");
    }
    if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
      throw new Error("Une base D1 valide est nécessaire");
    }

    this.bucket = bucket;
    this.db = db;
    this.now = now;
  }

  async createCandidate(radarId, tiles) {
    if (!radarId) throw new Error("radarId est nécessaire");

    const expectedTiles = normalizeTiles(tiles);
    const id = makeId();
    const version = `${Date.now()}-${id}`;
    const manifestKey = `${candidatePrefix(radarId, version)}/manifest.json`;
    const createdAt = this.now().toISOString();

    await this.bucket.put(
      manifestKey,
      JSON.stringify({ radarId, version, expectedTiles }),
      { httpMetadata: { contentType: "application/json" } }
    );

    try {
      await this.db.prepare(`
        INSERT INTO radar_baselines
          (id, radar_id, version, status, expected_tile_count, manifest_key, current, created_at, committed_at)
        VALUES (?, ?, ?, 'candidate', ?, ?, 0, ?, NULL)
      `).bind(
        id,
        radarId,
        version,
        expectedTiles.length,
        manifestKey,
        createdAt
      ).run();
    } catch (error) {
      await this.bucket.delete(manifestKey);
      throw error;
    }

    return { id, radarId, version, expectedTiles, manifestKey };
  }

  async getCandidate(candidate) {
    const row = await this.db.prepare(`
      SELECT id, radar_id, version, status, expected_tile_count, manifest_key
      FROM radar_baselines
      WHERE id = ?
    `).bind(candidate.id).first();

    if (!row) {
      throw new BaselineStoreError("Candidat introuvable", "CANDIDATE_NOT_FOUND");
    }

    return row;
  }

  async putTile(candidate, tile) {
    const row = await this.getCandidate(candidate);
    if (row.status !== "candidate") {
      throw new BaselineStoreError(`Candidat dans l'état ${row.status}`, "INVALID_CANDIDATE_STATE");
    }

    const key = tileKey(tile.tileX, tile.tileY);
    if (!candidate.expectedTiles.includes(key)) {
      throw new BaselineStoreError(`Tuile ${key} absente du plan`, "UNEXPECTED_TILE");
    }

    if (!(tile.bytes instanceof Uint8Array) && !(tile.bytes instanceof ArrayBuffer)) {
      throw new BaselineStoreError(`La tuile ${key} ne contient pas les octets PNG`, "MISSING_TILE_BYTES");
    }

    await this.bucket.put(tileObjectKey(candidate, tile.tileX, tile.tileY), tile.bytes, {
      httpMetadata: { contentType: tile.contentType || "image/png" },
      customMetadata: {
        tileX: String(tile.tileX),
        tileY: String(tile.tileY),
        source: "wplace-radar"
      }
    });
  }

  async finalizeCandidate(candidate) {
    const row = await this.getCandidate(candidate);
    if (row.status !== "candidate") {
      throw new BaselineStoreError(`Candidat dans l'état ${row.status}`, "INVALID_CANDIDATE_STATE");
    }

    const manifest = await this.bucket.get(row.manifest_key);
    if (!manifest) {
      throw new BaselineStoreError("Manifest du candidat introuvable", "MANIFEST_NOT_FOUND");
    }

    const manifestData = JSON.parse(await manifest.text());
    const expected = [...manifestData.expectedTiles].sort();
    const prefix = `${candidatePrefix(candidate.radarId, candidate.version)}/tiles/`;
    const actual = await this.listTileKeys(prefix);

    const complete = actual.length === expected.length
      && actual.every((key, index) => key === expected[index]);

    if (!complete) {
      throw new BaselineStoreError(
        `Candidat incomplet: ${actual.length}/${expected.length} tuiles présentes`,
        "INCOMPLETE_CANDIDATE"
      );
    }

    await this.db.prepare(`
      UPDATE radar_baselines
      SET status = 'finalized'
      WHERE id = ? AND status = 'candidate'
    `).bind(candidate.id).run();

    return { ...candidate, finalized: true };
  }

  async commitCandidate(candidate) {
    const row = await this.getCandidate(candidate);
    if (row.status !== "finalized") {
      throw new BaselineStoreError(`Candidat dans l'état ${row.status}`, "CANDIDATE_NOT_FINALIZED");
    }

    const committedAt = this.now().toISOString();

    await this.db.batch([
      this.db.prepare(`
        UPDATE radar_baselines
        SET current = 0
        WHERE radar_id = ? AND current = 1
      `).bind(candidate.radarId),
      this.db.prepare(`
        UPDATE radar_baselines
        SET status = 'committed', current = 1, committed_at = ?
        WHERE id = ? AND status = 'finalized'
      `).bind(committedAt, candidate.id)
    ]);

    return this.getCurrent(candidate.radarId);
  }

  async abortCandidate(candidate) {
    await this.getCandidate(candidate);
    await this.deletePrefix(candidatePrefix(candidate.radarId, candidate.version));

    await this.db.prepare(`
      UPDATE radar_baselines
      SET status = 'aborted'
      WHERE id = ? AND status IN ('candidate', 'finalized')
    `).bind(candidate.id).run();

    return { id: candidate.id, status: "aborted" };
  }

  async getCurrent(radarId) {
    const row = await this.db.prepare(`
      SELECT id, radar_id, version, expected_tile_count, committed_at
      FROM radar_baselines
      WHERE radar_id = ? AND current = 1
    `).bind(radarId).first();

    if (!row) return null;

    return {
      id: row.id,
      radarId: row.radar_id,
      version: row.version,
      tileCount: row.expected_tile_count,
      committedAt: row.committed_at
    };
  }

  async getTile(radarId, tileX, tileY, { version } = {}) {
    const current = version ? { version } : await this.getCurrent(radarId);
    if (!current) return null;

    const key = `${candidatePrefix(radarId, current.version)}/tiles/${tileKey(tileX, tileY)}.png`;
    const object = await this.bucket.get(key);
    if (!object || !object.body) return null;

    const bytes = new Uint8Array(await object.arrayBuffer());
    const decoded = await decodePng(bytes.buffer);

    return {
      tileX,
      tileY,
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
      bytes
    };
  }

  async listTileKeys(prefix) {
    const keys = [];
    let cursor;

    do {
      const page = await this.bucket.list({ prefix, limit: 1000, cursor });
      keys.push(
        ...page.objects.map((object) => object.key.slice(prefix.length).replace(/\.png$/, ""))
      );
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    return keys.sort();
  }

  async deletePrefix(prefix) {
    let cursor;

    do {
      const page = await this.bucket.list({ prefix, limit: 1000, cursor });
      if (page.objects.length) {
        await this.bucket.delete(page.objects.map((object) => object.key));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

export { tileKey, candidatePrefix, tileObjectKey };
