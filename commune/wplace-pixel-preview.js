(() => {
  "use strict";

  const WPLACE_PROXY = "https://wplace-commune-proxy.mathieu-peter.workers.dev";
  const TILE_SIZE = 1000;
  const WORLD_TILES = 2048;
  const WORLD_SIZE = TILE_SIZE * WORLD_TILES;
  const MIN_ZOOM = 9;
  const MAX_TILES = 32;
  const SOURCE_PREFIX = "wplace-preview-source-";
  const LAYER_PREFIX = "wplace-preview-layer-";
  const CONTROL_ID = "wplace-preview-control";
  const STYLE_ID = "wplace-preview-style";

  let enabled = true;
  let opacity = 0.72;
  let installed = false;
  let refreshTimer = null;

  function getMap() {
    return typeof map !== "undefined" ? map : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeTileX(x) {
    return ((x % WORLD_TILES) + WORLD_TILES) % WORLD_TILES;
  }

  function worldXToLng(x) {
    return x / WORLD_SIZE * 360 - 180;
  }

  function worldYToLat(y) {
    const n = Math.PI - 2 * Math.PI * y / WORLD_SIZE;
    return 180 / Math.PI * Math.atan(Math.sinh(n));
  }

  function lngToWorldX(lng) {
    return (clamp(lng, -180, 180) + 180) / 360 * WORLD_SIZE;
  }

  function latToWorldY(lat) {
    const safeLat = clamp(lat, -85.05112878, 85.05112878);
    const rad = safeLat * Math.PI / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * WORLD_SIZE;
  }

  function tileCoordinates(tileX, tileY) {
    const left = worldXToLng(tileX * TILE_SIZE);
    const right = worldXToLng((tileX + 1) * TILE_SIZE);
    const top = worldYToLat(tileY * TILE_SIZE);
    const bottom = worldYToLat((tileY + 1) * TILE_SIZE);
    return [[left, top], [right, top], [right, bottom], [left, bottom]];
  }

  function tileUrl(tileX, tileY) {
    return `${WPLACE_PROXY}/tile/${tileX}/${tileY}.png`;
  }

  function tileKey(x, y) {
    return `${x}/${y}`;
  }

  function getVisibleTiles() {
    const m = getMap();
    if (!m || m.getZoom() < MIN_ZOOM) return [];

    const bounds = m.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const north = clamp(bounds.getNorth(), -85.05112878, 85.05112878);
    const south = clamp(bounds.getSouth(), -85.05112878, 85.05112878);

    const westX = lngToWorldX(west);
    const eastX = lngToWorldX(east);
    const northY = latToWorldY(north);
    const southY = latToWorldY(south);

    let minX = Math.floor(Math.min(westX, eastX) / TILE_SIZE) - 1;
    let maxX = Math.floor(Math.max(westX, eastX) / TILE_SIZE) + 1;
    let minY = Math.floor(Math.min(northY, southY) / TILE_SIZE) - 1;
    let maxY = Math.floor(Math.max(northY, southY) / TILE_SIZE) + 1;

    minY = clamp(minY, 0, WORLD_TILES - 1);
    maxY = clamp(maxY, 0, WORLD_TILES - 1);

    const out = [];
    const seen = new Set();
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = normalizeTileX(x);
        const key = tileKey(nx, y);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ tileX: nx, tileY: y });
        if (out.length >= MAX_TILES) return out;
      }
    }
    return out;
  }

  function removeTile(m, key) {
    const sourceId = SOURCE_PREFIX + key.replace("/", "-");
    const layerId = LAYER_PREFIX + key.replace("/", "-");
    if (m.getLayer(layerId)) m.removeLayer(layerId);
    if (m.getSource(sourceId)) m.removeSource(sourceId);
  }

  function clearTiles() {
    const m = getMap();
    if (!m) return;
    const style = m.getStyle();
    for (const source of style?.sources ? Object.keys(style.sources) : []) {
      if (source.startsWith(SOURCE_PREFIX)) {
        const key = source.slice(SOURCE_PREFIX.length).replace("-", "/");
        removeTile(m, key);
      }
    }
  }

  function refresh() {
    const m = getMap();
    if (!m || !m.isStyleLoaded()) return;

    if (!enabled || m.getZoom() < MIN_ZOOM) {
      clearTiles();
      return;
    }

    const desired = getVisibleTiles();
    const desiredKeys = new Set(desired.map(t => tileKey(t.tileX, t.tileY)));
    const style = m.getStyle();
    const existing = [];

    for (const sourceId of style?.sources ? Object.keys(style.sources) : []) {
      if (!sourceId.startsWith(SOURCE_PREFIX)) continue;
      const key = sourceId.slice(SOURCE_PREFIX.length).replace("-", "/");
      existing.push(key);
      if (!desiredKeys.has(key)) removeTile(m, key);
    }

    const beforeLayer = m.getLayer("new-fill") ? "new-fill" : undefined;

    for (const tile of desired) {
      const key = tileKey(tile.tileX, tile.tileY);
      const sourceId = SOURCE_PREFIX + key.replace("/", "-");
      const layerId = LAYER_PREFIX + key.replace("/", "-");
      if (m.getSource(sourceId)) continue;

      m.addSource(sourceId, {
        type: "image",
        url: tileUrl(tile.tileX, tile.tileY),
        coordinates: tileCoordinates(tile.tileX, tile.tileY)
      });

      m.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": opacity,
          "raster-fade-duration": 0,
          "raster-resampling": "nearest"
        }
      }, beforeLayer);
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 80);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTROL_ID}{margin-top:9px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025)}
      #${CONTROL_ID} .wplace-preview-row{display:flex;align-items:center;gap:7px;color:#aaa;font-size:9px}
      #${CONTROL_ID} input[type=checkbox]{accent-color:#e10600;margin:0;cursor:pointer}
      #${CONTROL_ID} input[type=range]{width:100%;accent-color:#e10600;cursor:pointer}
      #${CONTROL_ID} .wplace-preview-opacity{margin-top:6px;display:flex;align-items:center;gap:7px;color:#777;font-size:8px}
      #${CONTROL_ID} .wplace-preview-opacity span:first-child{flex:1}
    `;
    document.head.appendChild(style);
  }

  function installControl() {
    const host = document.getElementById("panel");
    if (!host || document.getElementById(CONTROL_ID)) return;

    const box = document.createElement("div");
    box.id = CONTROL_ID;
    box.innerHTML = `
      <label class="wplace-preview-row">
        <input id="wplace-preview-enabled" type="checkbox" checked>
        <span>Afficher les pixels WPlace</span>
      </label>
      <label class="wplace-preview-opacity">
        <span>Opacité</span>
        <input id="wplace-preview-opacity" type="range" min="0" max="100" value="72" step="1">
        <span id="wplace-preview-opacity-value">72%</span>
      </label>
    `;

    const stat = host.querySelector(".stat");
    if (stat) host.insertBefore(box, stat);
    else host.appendChild(box);

    box.querySelector("#wplace-preview-enabled").addEventListener("change", event => {
      enabled = event.target.checked;
      refresh();
    });

    box.querySelector("#wplace-preview-opacity").addEventListener("input", event => {
      opacity = Number(event.target.value) / 100;
      box.querySelector("#wplace-preview-opacity-value").textContent = `${event.target.value}%`;
      const m = getMap();
      if (!m) return;
      const style = m.getStyle();
      for (const layerId of Object.keys(style?.layers ? Object.fromEntries(style.layers.map(layer => [layer.id, layer])) : {})) {
        if (layerId.startsWith(LAYER_PREFIX) && m.getLayer(layerId)) {
          m.setPaintProperty(layerId, "raster-opacity", opacity);
        }
      }
    });
  }

  function install() {
    if (installed) return;
    const m = getMap();
    if (!m) return;
    installed = true;
    installStyles();
    installControl();
    m.on("load", () => {
      installControl();
      refresh();
    });
    m.on("moveend", scheduleRefresh);
    m.on("zoomend", scheduleRefresh);
    m.on("resize", scheduleRefresh);
    scheduleRefresh();
  }

  const timer = setInterval(() => {
    if (getMap()) {
      install();
      clearInterval(timer);
    }
  }, 100);
  setTimeout(() => clearInterval(timer), 10000);
})();
