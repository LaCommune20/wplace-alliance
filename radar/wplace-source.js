import { decodePng } from "./png-decoder.js";

const DEFAULT_TILE_SIZE = 1000;
const DEFAULT_WORLD_SIZE = 2048000;

export class WPlaceTileSource {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || "").replace(/\/$/, "");
    this.pathPrefix = String(options.pathPrefix || "/radar-tile").replace(/\/$/, "");
    this.tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
    this.worldSize = options.worldSize ?? DEFAULT_WORLD_SIZE;
    this.cacheBust = options.cacheBust === true;

    if (!this.baseUrl) throw new Error("baseUrl est nécessaire");
    if (!Number.isInteger(this.tileSize) || this.tileSize <= 0) {
      throw new Error("tileSize invalide");
    }
  }

  tileUrl(tileX, tileY, { fresh = true } = {}) {
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0) {
      throw new Error("Coordonnées de tuile invalides");
    }

    const url = new URL(`${this.baseUrl}${this.pathPrefix}/${tileX}/${tileY}.png`);
    if (fresh && this.cacheBust) url.searchParams.set("radar_ts", String(Date.now()));
    return url.toString();
  }

  async fetchTile(tileX, tileY, options = {}) {
    const fresh = options.fresh !== false;
    const url = this.tileUrl(tileX, tileY, options);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "image/png,image/*;q=0.8"
      },
      cache: fresh ? "no-store" : "default"
    });

    if (!response.ok) {
      throw new Error(`Tuile WPlace ${tileX}/${tileY}: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("image/png")) {
      throw new Error(`Tuile WPlace ${tileX}/${tileY}: Content-Type inattendu (${contentType || "absent"})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await decodePng(buffer);

    if (decoded.width !== this.tileSize || decoded.height !== this.tileSize) {
      throw new Error(
        `Dimensions WPlace inattendues: ${decoded.width}x${decoded.height}, attendu ${this.tileSize}x${this.tileSize}`
      );
    }

    return {
      tileX,
      tileY,
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
      url,
      contentType,
      contentLength: response.headers.get("content-length"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified")
    };
  }
}

export { DEFAULT_TILE_SIZE, DEFAULT_WORLD_SIZE };
