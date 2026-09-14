(() => {
  const NOTES_MAP_API_URL = ZONES_API_URL.replace(/\/zones$/, "/notes");
  const NOTES_SOURCE_ID = "alliance-notes";
  const NOTES_PULSE_LAYER_ID = "alliance-notes-pulse";
  const NOTES_LAYER_ID = "alliance-notes-points";
  const NOTES_ICON_IDS = {
    information: "alliance-notes-pin-information",
    watch: "alliance-notes-pin-watch",
    important: "alliance-notes-pin-important"
  };
  const NOTE_LEVEL_COLORS = {
    information: "#3498db",
    watch: "#f1c40f",
    important: "#e74c3c"
  };
  let loadedNotes = [];
  let zoneSlugsById = new Map();
  let notePulseFrame = null;

  function ensureNotesPopupStyles() {
    if (document.getElementById("lc-notes-popup-style")) return;
    const style = document.createElement("style");
    style.id = "lc-notes-popup-style";
    style.textContent = `
      .lc-note-popup{width:min(320px,calc(100vw - 44px));color:#e8e8e8;font-family:Arial,Helvetica,sans-serif}
      .lc-note-popup__head{display:flex;align-items:center;gap:8px;margin:-2px 0 10px;padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,.10)}
      .lc-note-popup__dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 0 3px rgba(255,255,255,.06)}
      .lc-note-popup__level{font-size:10px;font-weight:700;letter-spacing:.9px;text-transform:uppercase}
      .lc-note-popup__body{font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
      .lc-note-popup__meta{display:grid;gap:7px;margin-top:13px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}
      .lc-note-popup__row{display:flex;align-items:flex-start;gap:7px;color:#aaa;font-size:10px;line-height:1.35}
      .lc-note-popup__label{color:#666;font-size:8px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;min-width:46px;padding-top:1px}
      .lc-note-popup__value{color:#bdbdbd}
      .lc-note-popup__id{margin-top:10px;color:#555;font:8px Consolas,monospace;text-align:right}
      .maplibregl-popup-content{background:rgba(15,15,15,.96);border:1px solid rgba(255,255,255,.13);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.48);padding:13px 14px}
      .maplibregl-popup-tip{border-top-color:rgba(15,15,15,.96);border-bottom-color:rgba(15,15,15,.96)}
      .maplibregl-popup-close-button{width:26px;height:26px;color:#777;font-size:17px;line-height:24px;border-radius:6px}
      .maplibregl-popup-close-button:hover{background:rgba(255,255,255,.08);color:#fff}
    `;
    document.head.appendChild(style);
  }

  function notesToGeoJSON(notes) {
    return {
      type: "FeatureCollection",
      features: notes
        .filter(note => note && note.position)
        .map(note => ({
          type: "Feature",
          id: Number(note.id),
          properties: {
            id: note.id,
            zone_id: note.zone_id,
            zone_name: note.zone_name || "",
            level: note.level || "information",
            content: note.content || "",
            expires_at: note.expires_at || null,
            rotation: 0
          },
          geometry: { type: "Point", coordinates: [Number(note.position.lng), Number(note.position.lat)] }
        }))
        .filter(feature => Number.isFinite(feature.geometry.coordinates[0]) && Number.isFinite(feature.geometry.coordinates[1]) && Number.isFinite(feature.id))
    };
  }

  function createPinImage(color) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.moveTo(32, 60);
    ctx.bezierCurveTo(29, 56, 8, 38, 8, 27);
    ctx.arc(32, 27, 24, Math.PI, 0, false);
    ctx.bezierCurveTo(56, 38, 35, 56, 32, 60);
    ctx.closePath();
    ctx.fillStyle = "#111111";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(32, 54);
    ctx.bezierCurveTo(29, 50, 14, 36, 14, 27);
    ctx.arc(32, 27, 18, Math.PI, 0, false);
    ctx.bezierCurveTo(50, 36, 35, 50, 32, 54);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(32, 27, 11, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return ctx.getImageData(0, 0, size, size);
  }

  function ensureNotesIcons() {
    const missing = Object.entries(NOTES_ICON_IDS).filter(([, id]) => !map.hasImage(id));
    if (!missing.length) return;
    for (const [level, id] of missing) map.addImage(id, createPinImage(NOTE_LEVEL_COLORS[level]), { pixelRatio: 2 });
  }

  function getVisibleNotes() {
    if (!zoneFilterEnabled) return loadedNotes;
    return loadedNotes.filter(note => {
      const zoneSlug = zoneSlugsById.get(Number(note.zone_id));
      return zoneSlug ? selectedZones.has(zoneSlug) : false;
    });
  }

  function ensureNotesPulseLayer() {
    if (map.getLayer(NOTES_PULSE_LAYER_ID)) return;
    if (!map.getSource(NOTES_SOURCE_ID)) return;
    map.addLayer({
      id: NOTES_PULSE_LAYER_ID,
      type: "circle",
      source: NOTES_SOURCE_ID,
      paint: {
        "circle-color": [
          "match",
          ["get", "level"],
          "important", NOTE_LEVEL_COLORS.important,
          "watch", NOTE_LEVEL_COLORS.watch,
          "information", NOTE_LEVEL_COLORS.information,
          NOTE_LEVEL_COLORS.information
        ],
        "circle-radius": 12,
        "circle-opacity": 0.46,
        "circle-blur": 0.35
      }
    }, map.getLayer(NOTES_LAYER_ID) ? NOTES_LAYER_ID : undefined);
  }

  function setupNotesWPlaceOrderListener() {
    if (map.__lcNotesWPlaceOrderBound) return;
    map.__lcNotesWPlaceOrderBound = true;
    map.on("sourcedata", event => {
      const source = event.source;
      if (source?.type !== "image" || typeof source.url !== "string") return;
      if (!source.url.startsWith(WPLACE_PROXY + "/tile/")) return;
      if (map.getLayer(NOTES_PULSE_LAYER_ID)) map.moveLayer(NOTES_PULSE_LAYER_ID);
      if (map.getLayer(NOTES_LAYER_ID)) map.moveLayer(NOTES_LAYER_ID);
    });
  }

  function startNotesPulseAnimation() {
    if (notePulseFrame != null) return;
    const startedAt = performance.now();
    const duration = 2200;
    const animate = now => {
      if (!map.getLayer(NOTES_PULSE_LAYER_ID)) {
        notePulseFrame = null;
        return;
      }
      const progress = ((now - startedAt) % duration) / duration;
      const wave = (Math.sin(progress * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      map.setPaintProperty(NOTES_PULSE_LAYER_ID, "circle-radius", 10 + wave * 18);
      map.setPaintProperty(NOTES_PULSE_LAYER_ID, "circle-opacity", 0.46 - wave * 0.38);
      notePulseFrame = requestAnimationFrame(animate);
    };
    notePulseFrame = requestAnimationFrame(animate);
  }

  function animateNewNotePins(data) {
    if (!map.getLayer(NOTES_LAYER_ID)) return;
    const features = Array.isArray(data?.features) ? data.features : [];
    if (!features.length) return;
    if (!map.__lcAnimatedNoteIds) map.__lcAnimatedNoteIds = new Set();
    const candidates = features
      .map(feature => Number(feature.id))
      .filter(id => Number.isFinite(id) && !map.__lcAnimatedNoteIds.has(id));
    candidates.forEach(id => map.__lcAnimatedNoteIds.add(id));
    if (!candidates.length) return;

    const featureById = new Map(features.map(feature => [Number(feature.id), feature]));
    const duration = 1800;
    const interval = 3000;
    const cycles = 3;
    const keyframes = [
      [0.00, -38],
      [0.14, 12],
      [0.28, -8],
      [0.42, 6],
      [0.56, -4],
      [0.70, 3],
      [0.84, -1.5],
      [1.00, 0]
    ];
    const source = map.getSource(NOTES_SOURCE_ID);
    let cycle = 0;
    let intervalTimer = null;

    const runCycle = () => {
      const startedAt = performance.now();
      const animate = now => {
        const progress = Math.min(1, (now - startedAt) / duration);
        let rotation = 0;
        for (let index = 1; index < keyframes.length; index++) {
          const [endProgress, endRotation] = keyframes[index];
          if (progress <= endProgress) {
            const [startProgress, startRotation] = keyframes[index - 1];
            const localProgress = (progress - startProgress) / (endProgress - startProgress);
            const eased = localProgress * localProgress * (3 - 2 * localProgress);
            rotation = startRotation + (endRotation - startRotation) * eased;
            break;
          }
        }
        candidates.forEach(id => {
          const feature = featureById.get(id);
          if (feature) feature.properties.rotation = rotation;
        });
        if (source) source.setData(data);
        if (progress < 1) {
          requestAnimationFrame(animate);
          return;
        }
        candidates.forEach(id => {
          const feature = featureById.get(id);
          if (feature) feature.properties.rotation = 0;
        });
        if (source) source.setData(data);
        cycle += 1;
        if (cycle < cycles) intervalTimer = setTimeout(runCycle, interval);
      };
      requestAnimationFrame(animate);
    };

    runCycle();
  }

  async function renderNotes(notes) {
    const data = notesToGeoJSON(notes);
    const source = map.getSource(NOTES_SOURCE_ID);
    if (source) source.setData(data);
    else {
      if (!map.isStyleLoaded()) return;
      map.addSource(NOTES_SOURCE_ID, { type: "geojson", data });
    }

    ensureNotesPulseLayer();
    ensureNotesIcons();
    setupNotesWPlaceOrderListener();
    const existingLayer = map.getLayer(NOTES_LAYER_ID);
    if (existingLayer && existingLayer.type !== "symbol") map.removeLayer(NOTES_LAYER_ID);
    if (!map.getLayer(NOTES_LAYER_ID)) {
      map.addLayer({
        id: NOTES_LAYER_ID,
        type: "symbol",
        source: NOTES_SOURCE_ID,
        layout: {
          "icon-image": ["match", ["get", "level"], "important", NOTES_ICON_IDS.important, "watch", NOTES_ICON_IDS.watch, "information", NOTES_ICON_IDS.information, NOTES_ICON_IDS.information],
          "icon-anchor": "bottom",
          "icon-rotation-alignment": "viewport",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 9, 0.9, 13, 1.15],
          "icon-rotate": ["coalesce", ["get", "rotation"], 0],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });
    }
    setupNoteInteractions();
    startNotesPulseAnimation();
    animateNewNotePins(data);
  }

  function updateNotesMapFilter() {
    if (!map.getSource(NOTES_SOURCE_ID)) return;
    renderNotes(getVisibleNotes());
  }

  function setupZoneFilterListener() {
    const filter = document.getElementById("zone-filter");
    if (filter && filter.dataset.lcNotesFilterBound !== "1") {
      filter.dataset.lcNotesFilterBound = "1";
      filter.addEventListener("change", updateNotesMapFilter);
    }
    if (document.documentElement.dataset.lcNotesZoneSelectionBound !== "1") {
      document.documentElement.dataset.lcNotesZoneSelectionBound = "1";
      document.addEventListener("change", event => {
        if (event.target instanceof HTMLInputElement && event.target.matches("#zones-list .zone-check")) updateNotesMapFilter();
      });
    }
  }

  async function loadZoneMap() {
    try {
      const response = await fetch(ZONES_API_URL, authFetchOptions());
      if (!response.ok) throw new Error("HTTP " + response.status);
      const zones = await response.json();
      if (!Array.isArray(zones)) throw new Error("Réponse zones invalide");
      zoneSlugsById = new Map(zones.filter(zone => zone && zone.id != null && zone.slug).map(zone => [Number(zone.id), zone.slug]).filter(([id]) => Number.isFinite(id)));
    } catch (error) {
      zoneSlugsById = new Map();
      console.warn("Notes carte : impossible de charger la correspondance des zones :", error);
    }
  }

  function setupNoteInteractions() {
    ensureNotesPopupStyles();
    if (map.getLayer(NOTES_LAYER_ID) && !map.__lcNotesInteractionsBound) {
      map.__lcNotesInteractionsBound = true;
      map.on("click", NOTES_LAYER_ID, event => {
        const feature = event.features?.[0];
        if (!feature) return;
        const properties = feature.properties || {};
        const levelLabels = { information: "Information", watch: "Veille", important: "Important" };
        const levelColors = NOTE_LEVEL_COLORS;
        const color = levelColors[properties.level] || levelColors.information;
        const container = document.createElement("div");
        container.className = "lc-note-popup";

        const head = document.createElement("div");
        head.className = "lc-note-popup__head";
        const dot = document.createElement("span");
        dot.className = "lc-note-popup__dot";
        dot.style.background = color;
        head.appendChild(dot);
        const level = document.createElement("div");
        level.className = "lc-note-popup__level";
        level.textContent = levelLabels[properties.level] || "Information";
        level.style.color = color;
        head.appendChild(level);
        container.appendChild(head);

        const content = document.createElement("div");
        content.className = "lc-note-popup__body";
        content.textContent = properties.content || "";
        container.appendChild(content);

        const meta = document.createElement("div");
        meta.className = "lc-note-popup__meta";
        if (properties.zone_name) {
          const row = document.createElement("div");
          row.className = "lc-note-popup__row";
          const label = document.createElement("div");
          label.className = "lc-note-popup__label";
          label.textContent = "Zone";
          row.appendChild(label);
          const value = document.createElement("div");
          value.className = "lc-note-popup__value";
          value.textContent = properties.zone_name;
          row.appendChild(value);
          meta.appendChild(row);
        }
        if (properties.expires_at) {
          const row = document.createElement("div");
          row.className = "lc-note-popup__row";
          const label = document.createElement("div");
          label.className = "lc-note-popup__label";
          label.textContent = "Expire";
          row.appendChild(label);
          const value = document.createElement("div");
          value.className = "lc-note-popup__value";
          const date = new Date(properties.expires_at);
          value.textContent = Number.isNaN(date.getTime()) ? properties.expires_at : date.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          row.appendChild(value);
          meta.appendChild(row);
        }
        if (meta.childElementCount) container.appendChild(meta);
        if (properties.id != null) {
          const id = document.createElement("div");
          id.className = "lc-note-popup__id";
          id.textContent = "NOTE #" + properties.id;
          container.appendChild(id);
        }

        const coordinates = feature.geometry?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) return;
        new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "none" })
          .setLngLat([Number(coordinates[0]), Number(coordinates[1])])
          .setDOMContent(container)
          .addTo(map);
      });
      map.on("mouseenter", NOTES_LAYER_ID, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", NOTES_LAYER_ID, () => { map.getCanvas().style.cursor = ""; });
    }
  }

  async function loadNotes() {
    try {
      setupZoneFilterListener();
      const [notesResponse] = await Promise.all([fetch(NOTES_MAP_API_URL, authFetchOptions()), loadZoneMap()]);
      if (notesResponse.status === 401 || notesResponse.status === 403) {
        console.warn("Notes carte : accès refusé (HTTP " + notesResponse.status + ")");
        return;
      }
      if (!notesResponse.ok) throw new Error("HTTP " + notesResponse.status);
      const data = await notesResponse.json();
      if (!data || !Array.isArray(data.notes)) throw new Error("Réponse Notes invalide");
      loadedNotes = data.notes;
      await renderNotes(getVisibleNotes());
      console.log("Notes carte chargées :", data.notes.length);
    } catch (error) {
      console.error("Impossible de charger les Notes sur la carte :", error);
    }
  }

  window.__loadNotesMap = loadNotes;
  window.__renderNotesMap = renderNotes;
  window.__updateNotesMapFilter = updateNotesMapFilter;
  loadNotes();
})();