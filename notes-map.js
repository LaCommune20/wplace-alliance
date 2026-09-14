(() => {
  const NOTES_MAP_API_URL = ZONES_API_URL.replace(/\/zones$/, "/notes");
  const NOTES_SOURCE_ID = "alliance-notes";
  const NOTES_LAYER_ID = "alliance-notes-points";

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
            coordinates: [
              Number(note.position.lng),
              Number(note.position.lat)
            ]
          }
        }))
        .filter(feature =>
          Number.isFinite(feature.geometry.coordinates[0]) &&
          Number.isFinite(feature.geometry.coordinates[1])
        )
    };
  }

  function renderNotes(notes) {
    const data = notesToGeoJSON(notes);
    const source = map.getSource(NOTES_SOURCE_ID);

    if (source) {
      source.setData(data);
      return;
    }

    if (!map.isStyleLoaded()) return;

    map.addSource(NOTES_SOURCE_ID, {
      type: "geojson",
      data
    });

    map.addLayer({
      id: NOTES_LAYER_ID,
      type: "circle",
      source: NOTES_SOURCE_ID,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 4,
          9, 6,
          13, 8
        ],
        "circle-color": [
          "match",
          ["get", "level"],
          "important", "#e74c3c",
          "watch", "#f1c40f",
          "information", "#3498db",
          "#3498db"
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.95
      }
    });
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

        new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true
        })
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

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const data = await response.json();

      if (!data || !Array.isArray(data.notes)) {
        throw new Error("Réponse Notes invalide");
      }

      renderNotes(data.notes);

      console.log("Notes carte chargées :", data.notes.length);
    } catch (error) {
      console.error("Impossible de charger les Notes sur la carte :", error);
    }
  }

  window.__loadNotesMap = loadNotes;
  window.__renderNotesMap = renderNotes;

  loadNotes();
})();
