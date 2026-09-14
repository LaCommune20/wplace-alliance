(() => {
  const NOTES_MAP_API_URL = ZONES_API_URL.replace(/\/zones$/, "/notes");
  const NOTES_SOURCE_ID = "alliance-notes";
  const NOTES_LAYER_ID = "alliance-notes-points";
  const NOTES_ICON_ID = "alliance-notes-pin";

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

  function ensureNotesIcon() {
    if (map.hasImage(NOTES_ICON_ID)) return Promise.resolve();
    if (map.__lcNotesIconPromise) return map.__lcNotesIconPromise;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 4C18.75 4 8 14.75 8 28c0 17.5 24 32 24 32s24-14.5 24-32C56 14.75 45.25 4 32 4Z" fill="#000"/><circle cx="32" cy="28" r="9" fill="#fff"/></svg>`;
  
    map.__lcNotesIconPromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          if (!map.hasImage(NOTES_ICON_ID)) {
            map.addImage(NOTES_ICON_ID, image, { sdf: true, pixelRatio: 2 });
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = reject;
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });

    return map.__lcNotesIconPromise;
  }

  async function renderNotes(notes) {
    const data = notesToGeoJSON(notes);
    const source = map.getSource(NOTES_SOURCE_ID);

    if (source) {
      source.setData(data);
    } else {
      if (!map.isStyleLoaded()) return;

      map.addSource(NOTES_SOURCE_ID, {
        type: "geojson",
        data
      });
    }

    if (map.getLayer(NOTES_LAYER_ID)) return;

    try {
      await ensureNotesIcon();

      if (!map.getLayer(NOTES_LAYER_ID)) {
        map.addLayer({
          id: NOTES_LAYER_ID,
          type: "symbol",
          source: NOTES_SOURCE_ID,
          layout: {
            "icon-image": NOTES_ICON_ID,
            "icon-anchor": "bottom",
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5, 0.65,
              9, 0.8,
              13, 1
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          },
          paint: {
            "icon-color": [
              "match",
              ["get", "level"],
              "important", "#e74c3c",
              "watch", "#f1c40f",
              "information", "#3498db",
              "#3498db"
            ],
            "icon-halo-color": "#ffffff",
            "icon-halo-width": 2,
            "icon-opacity": 1
          }
        });
      }

      setupNoteInteractions();
    } catch (error) {
      console.error("Impossible de créer le marqueur Notes :", error);
    }
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
