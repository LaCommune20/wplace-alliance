(() => {
  "use strict";

  const SNAP_PX = 14;
  let enabled = true;
  let otherZones = [];
  let candidates = null;
  let loading = null;
  let mode = "unknown";

  function getMap() { return typeof map !== "undefined" ? map : null; }
  function getPoints() { return typeof points !== "undefined" ? points : null; }
  function getZone() { return typeof zone !== "undefined" ? zone : null; }

  function parsePolygon(value) {
    if (Array.isArray(value)) return value;
    try { return JSON.parse(value || "[]"); } catch { return []; }
  }

  async function loadZones() {
    if (loading) return loading;
    loading = (async () => {
      try {
        if (typeof auth !== "function") return;
        const api = typeof API !== "undefined" ? API : "";
        const r = await fetch(api + "/api/admin/zones", auth());
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        otherZones = Array.isArray(d) ? d : (Array.isArray(d?.zones) ? d.zones : []);
        invalidate();
      } catch (e) {
        console.warn("Accrochage : impossible de charger les frontières.", e);
        otherZones = [];
      }
    })();
    return loading;
  }

  function invalidate() { candidates = null; }

  function buildCandidates() {
    const m = getMap();
    if (!m || !enabled) return [];
    const current = getZone();
    const currentId = current?.id == null ? null : String(current.id);
    const out = [];

    for (const z of otherZones) {
      if (currentId !== null && String(z.id) === currentId) continue;
      const poly = parsePolygon(z.polygon);
      if (!Array.isArray(poly) || poly.length < 2) continue;

      const vertices = poly.map(p => [Number(p[1]), Number(p[0])]);
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        if (!Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;
        const pa = m.project({lng: a[0], lat: a[1]});
        const pb = m.project({lng: b[0], lat: b[1]});
        out.push({type: "segment", zoneId: z.id, zoneName: z.name, a, b, pa, pb});
        out.push({type: "vertex", zoneId: z.id, zoneName: z.name, point: a, p: pa});
      }
    }
    return out;
  }

  function getCandidates() {
    if (!candidates) candidates = buildCandidates();
    return candidates;
  }

  function distancePointSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return {distance: Math.hypot(p.x - a.x, p.y - a.y), t: 0};
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return {distance: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t};
  }

  function snapLngLat(lngLat) {
    if (!enabled) return null;
    const m = getMap();
    if (!m) return null;
    const p = m.project(lngLat);
    let best = null;

    for (const c of getCandidates()) {
      if (c.type === "vertex") {
        const d = Math.hypot(p.x - c.p.x, p.y - c.p.y);
        if (d <= SNAP_PX && (!best || d < best.distance)) {
          best = {distance: d, lngLat: {lng: c.point[0], lat: c.point[1]}, label: c.zoneName, kind: "sommet"};
        }
      } else {
        const minX = Math.min(c.pa.x, c.pb.x) - SNAP_PX;
        const maxX = Math.max(c.pa.x, c.pb.x) + SNAP_PX;
        const minY = Math.min(c.pa.y, c.pb.y) - SNAP_PX;
        const maxY = Math.max(c.pa.y, c.pb.y) + SNAP_PX;
        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
        const hit = distancePointSegment(p, c.pa, c.pb);
        if (hit.distance <= SNAP_PX && (!best || hit.distance < best.distance)) {
          const lng = c.a[0] + (c.b[0] - c.a[0]) * hit.t;
          const lat = c.a[1] + (c.b[1] - c.a[1]) * hit.t;
          best = {distance: hit.distance, lngLat: {lng, lat}, label: c.zoneName, kind: "frontière"};
        }
      }
    }
    return best;
  }

  function setSnappedMarker(marker, index, hit) {
    const pts = getPoints();
    if (!pts || !marker || !hit) return;
    pts[index] = [hit.lngLat.lat, hit.lngLat.lng];
    marker.setLngLat([hit.lngLat.lng, hit.lngLat.lat]);
    if (typeof updateSource === "function") updateSource();
    const el = marker.getElement();
    if (el) {
      el.classList.add("snapped");
      el.title = "Accroché à " + hit.kind + " : " + hit.label;
    }
  }

  function clearSnappedMarker(marker, index) {
    const el = marker?.getElement?.();
    if (!el) return;
    el.classList.remove("snapped");
    el.title = "Sommet " + (index + 1);
  }

  function installCheckbox() {
    if (document.getElementById("boundary-snap-control")) return;
    const host = document.getElementById("tools") || document.getElementById("panel");
    if (!host) return;
    const box = document.createElement("label");
    box.id = "boundary-snap-control";
    box.innerHTML = '<input id="boundary-snap" type="checkbox" checked><span>Accrochage aux frontières</span>';
    const stat = host.querySelector(".stat");
    if (stat) host.insertBefore(box, stat);
    else host.appendChild(box);
    box.querySelector("input").addEventListener("change", e => {
      enabled = e.target.checked;
      invalidate();
      if (!enabled && typeof setState === "function") setState("Accrochage aux frontières désactivé.");
      if (enabled && typeof setState === "function") setState("Accrochage aux frontières activé.");
    });
  }

  function installStyles() {
    if (document.getElementById("boundary-snap-style")) return;
    const style = document.createElement("style");
    style.id = "boundary-snap-style";
    style.textContent = `
      #boundary-snap-control{display:flex;align-items:center;gap:7px;margin-top:9px;padding:7px 8px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025);color:#aaa;font-size:9px;cursor:pointer}
      #boundary-snap-control input{accent-color:#e10600;margin:0;cursor:pointer}
      #boundary-snap-control span{flex:1}
      .vertex.snapped{box-shadow:0 0 0 3px rgba(225,6,0,.28),0 2px 8px rgba(0,0,0,.6)}
    `;
    document.head.appendChild(style);
  }

  function patchRenderMarkers() {
    if (typeof renderMarkers !== "function" || renderMarkers.__boundarySnap) return;
    const original = renderMarkers;
    function wrappedRenderMarkers() {
      original();
      if (!enabled || !Array.isArray(markers)) return;
      markers.forEach((marker, index) => {
        marker.on("drag", () => {
          const current = marker.getLngLat();
          const hit = snapLngLat(current);
          if (hit) setSnappedMarker(marker, index, hit);
          else clearSnappedMarker(marker, index);
        });
      });
    }
    wrappedRenderMarkers.__boundarySnap = true;
    renderMarkers = wrappedRenderMarkers;
  }

  function patchCreateClicks() {
    const m = getMap();
    if (!m || m.__boundarySnapCreate) return;
    if (mode !== "create") return;
    m.__boundarySnapCreate = true;
    m.on("click", () => {
      if (!enabled) return;
      const pts = getPoints();
      if (!Array.isArray(pts) || !pts.length || typeof markers === "undefined" || !markers.length) return;
      const index = pts.length - 1;
      const marker = markers[index];
      if (!marker) return;
      const hit = snapLngLat(marker.getLngLat());
      if (hit) setSnappedMarker(marker, index, hit);
    });
  }

  function patch() {
    installStyles();
    installCheckbox();
    patchRenderMarkers();
    const m = getMap();
    if (m) {
      m.on("moveend", invalidate);
      m.on("zoomend", invalidate);
      m.on("resize", invalidate);
      patchCreateClicks();
    }
    loadZones();
  }

  // The editor uses the same global geometry primitives in edit and create mode.
  // Keep initialization bounded and avoid MutationObservers that could loop.
  const timer = setInterval(() => {
    const m = getMap();
    if (m) {
      mode = typeof zone === "undefined" ? "create" : "edit";
      patch();
      clearInterval(timer);
    }
  }, 100);
  setTimeout(() => clearInterval(timer), 10000);
  installStyles();
  installCheckbox();
})();
