(() => {
  const NOTES_MAP_API_URL = ZONES_API_URL.replace(/\/zones$/, "/notes");
  const NOTES_SOURCE_ID = "alliance-notes";
  const NOTES_LAYER_ID = "alliance-notes-points";
  const NOTES_ICON_IDS = {
    information: "alliance-notes-pin-information",
    watch: "alliance-notes-pin-watch",
    important: "alliance-notes-pin-important"
  };

  function notesToGeoJSON(notes) {
    return {
      type: "FeatureCollection",
      features: notes
        .filter(note => note && note.position)
        .map(note => ({
          type: "Feature",
          properties: {
            id: note.id,
            zone_id: note.zone_id,
            zone_name: note.zone_name || "",
            level: note.level || "information",
            content: note.content || "",
            expires_at: note.expires_at || null
          },
          geometry: {
            type: "Point",
            coordinates: [Number(note.position.lng), Number(note.position.lat)]
          }
        }))
        .filter(feature =>
          Number.isFinite(feature.geometry.coordinates[0]) &&
          Number.isFinite(feature.geometry.coordinates[1])
        )
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

    const colors = {
      information: "#3498db",
      watch: "#f1c40f",
      important: "#e74c3c"
    };

    for (const [level, id] of missing) {
      map.addImage(id, createPinImage(colors[level]), { pixelRatio: 2 });
    }
  }

  async function renderNotes(notes) {
    const data = notesToGeoJSON(notes);
    const source = map.getSource(NOTES_SOURCE_ID);

    if (source) {
      source.setData(data);
    } else {
      if (!map.isStyleLoaded()) return;
      map.addSource(NOTES_SOURCE_ID, { type: "geojson", data });
    }

    const existingLayer = map.getLayer(NOTES_LAYER_ID);
    if (existingLayer && existingLayer.type !== "symbol") {
      map.removeLayer(NOTES_LAYER_ID);
    }

    if (!map.getLayer(NOTES_LAYER_ID)) {
      ensureNotesIcons();
      map.addLayer({
        id: NOTES_LAYER_ID,
        type: "symbol",
        source: NOTES_SOURCE_ID,
        layout: {
          "icon-image": [
            "match",
            ["get", "level"],
            "important", NOTES_ICON_IDS.important,
            "watch", NOTES_ICON_IDS.watch,
            "information", NOTES_ICON_IDS.information,
            NOTES_ICON_IDS.information
          ],
          "icon-anchor": "bottom",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5, 0.7,
            9, 0.9,
            13, 1.15
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });
    }

    setupNoteInteractions();
  }

  function setupNoteInteractions() {
    if (map.getLayer(NOTES_LAYER_ID) && !map.__lcNotesInteractionsBound) {
      map.__lcNotesInteractionsBound = true;

      map.on("click", NOTES_LAYER_ID, event => {
        const feature = event.features?.[0];
        if (!feature) return;

        const properties = feature.properties || {};
        const levelLabels = {
          information: "Information",
          watch: "Veille",
          important: "Important"
        };
        const container = document.createElement("div");

        const level = document.createElement("strong");
        level.textContent = levelLabels[properties.level] || "Information";
        container.appendChild(level);

        const content = document.createElement("div");
        content.textContent = properties.content || "";
        content.style.marginTop = "6px";
        container.appendChild(content);

        if (properties.zone_name) {
          const zone = document.createElement("div");
          zone.textContent = "Zone : " + properties.zone_name;
          zone.style.marginTop = "8px";
          container.appendChild(zone);
        }

        if (properties.expires_at) {
          const expiration = document.createElement("div");
          const date = new Date(properties.expires_at);
          expiration.textContent = Number.isNaN(date.getTime())
            ? "Expiration : " + properties.expires_at
            : "Expiration : " + date.toLocaleString("fr-FR");
          expiration.style.marginTop = "4px";
          container.appendChild(expiration);
        }

        new maplibregl.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat(event.lngLat)
          .setDOMContent(container)
          .addTo(map);
      });

      map.on("mouseenter", NOTES_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", NOTES_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
    }
  }

  async function loadNotes() {
    try {
      const response = await fetch(NOTES_MAP_API_URL, authFetchOptions());
      if (response.status === 401 || response.status === 403) {
        console.warn("Notes carte : accès refusé (HTTP " + response.status + ")");
        return;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.json();
      if (!data || !Array.isArray(data.notes)) throw new Error("Réponse Notes invalide");

      await renderNotes(data.notes);
      console.log("Notes carte chargées :", data.notes.length);
    } catch (error) {
      console.error("Impossible de charger les Notes sur la carte :", error);
    }
  }

  window.__loadNotesMap = loadNotes;
  window.__renderNotesMap = renderNotes;
  loadNotes();
})();
