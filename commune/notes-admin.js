(() => {
  "use strict";

  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  const LEVELS = [
    ["information", "Information"],
    ["watch", "Surveillance"],
    ["important", "Important"]
  ];
  const DURATIONS = [
    ["permanent", "Permanente"],
    ["1h", "1 heure"],
    ["6h", "6 heures"],
    ["24h", "24 heures"],
    ["3d", "3 jours"],
    ["7d", "7 jours"],
    ["custom", "Date personnalisée"]
  ];
  const STATUSES = [
    ["active", "Actives"],
    ["expired", "Expirées"],
    ["archived", "Archivées"],
    ["", "Tous les statuts"]
  ];

  let access = null;
  let zones = [];
  let noteZones = [];
  let notes = [];
  let selectedZoneId = "";
  let filterLevel = "";
  let filterStatus = "active";
  let editingId = null;
  let notePlacementMap = null;
  let notePlacementMarker = null;
  let notePlacementAssetsPromise = null;

  function authOptions(extra = {}) {
    const token = sessionStorage.getItem("wplace_session");
    if (token) {
      return {
        ...extra,
        headers: { ...(extra.headers || {}), Authorization: "Bearer " + token },
        cache: "no-store"
      };
    }
    return { ...extra, credentials: "include", cache: "no-store" };
  }

  async function json(path, options = {}) {
    const r = await fetch(API + path, authOptions(options));
    let d = null;
    try { d = await r.json(); } catch {}
    if (!r.ok) throw new Error(d?.error || "HTTP " + r.status);
    return d;
  }

  function asArray(data, key) {
    return Array.isArray(data) ? data : (key && Array.isArray(data?.[key]) ? data[key] : []);
  }

  function notePosition(note) {
    let p = note?.position;
    if (typeof p === "string") {
      try { p = JSON.parse(p); } catch { p = null; }
    }
    if (!p || typeof p !== "object") return { lat: "", lng: "" };
    return {
      lat: p.lat ?? p.latitude ?? "",
      lng: p.lng ?? p.longitude ?? p.lon ?? ""
    };
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short"
    });
  }

  function levelLabel(value) {
    return LEVELS.find(([v]) => v === value)?.[1] || value || "—";
  }

  function durationLabel(value) {
    return DURATIONS.find(([v]) => v === value)?.[1] || value || "—";
  }

  function statusLabel(value) {
    return { active: "Active", expired: "Expirée", archived: "Archivée" }[value] || value || "—";
  }

  function setStatus(message, error = false) {
    const el = document.getElementById("notes-state");
    if (!el) return;
    el.textContent = message || "";
    el.className = error ? "error" : "muted";
  }

  function makeButton(label, action, danger = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = danger ? "zone-action notes-danger" : "refresh";
    b.textContent = label;
    b.addEventListener("click", action);
    return b;
  }

  function addOptions(select, items) {
    for (const [value, label] of items) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
  }

  function renderToolbar() {
    const toolbar = document.getElementById("notes-toolbar");
    if (!toolbar) return;
    toolbar.innerHTML = "";

    const zone = document.createElement("select");
    zone.className = "notes-control";
    addOptions(zone, [["", "Sélectionner une zone"], ...noteZones.map(z => [String(z.id), z.name])]);
    zone.value = selectedZoneId;
    zone.addEventListener("change", () => {
      selectedZoneId = zone.value;
      editingId = null;
      resetForm();
      loadNotes();
    });
    toolbar.appendChild(zone);

    const level = document.createElement("select");
    level.className = "notes-control";
    addOptions(level, [["", "Tous les niveaux"], ...LEVELS]);
    level.value = filterLevel;
    level.addEventListener("change", () => {
      filterLevel = level.value;
      renderNotes();
    });
    toolbar.appendChild(level);

    const status = document.createElement("select");
    status.className = "notes-control";
    addOptions(status, STATUSES);
    status.value = filterStatus;
    status.addEventListener("change", () => {
      filterStatus = status.value;
      loadNotes();
    });
    toolbar.appendChild(status);

    toolbar.appendChild(makeButton("Actualiser", loadNotes));
  }

  function setFormValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
  }

  function resetForm() {
    editingId = null;
    setFormValue("note-level", "information");
    setFormValue("note-content", "");
    setFormValue("note-lat", "");
    setFormValue("note-lng", "");
    setFormValue("note-duration", "permanent");
    setFormValue("note-expires", "");
    const title = document.getElementById("notes-form-title");
    if (title) title.textContent = "Nouvelle note";
    const save = document.getElementById("notes-save");
    if (save) save.textContent = "Créer la note";
    const cancel = document.getElementById("notes-cancel");
    if (cancel) cancel.classList.add("hidden");
    toggleCustomExpiry();
  }

  function fillForm(note) {
    const p = notePosition(note);
    editingId = note.id;
    setFormValue("note-level", note.level || "information");
    setFormValue("note-content", note.content || "");
    setFormValue("note-lat", p.lat);
    setFormValue("note-lng", p.lng);
    setFormValue("note-duration", note.duration_type || "permanent");
    setFormValue("note-expires", note.expires_at ? toLocalDateTime(note.expires_at) : "");
    const title = document.getElementById("notes-form-title");
    if (title) title.textContent = "Modifier la note #" + note.id;
    const save = document.getElementById("notes-save");
    if (save) save.textContent = "Enregistrer";
    const cancel = document.getElementById("notes-cancel");
    if (cancel) cancel.classList.remove("hidden");
    toggleCustomExpiry();
    document.getElementById("notes-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toLocalDateTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function toggleCustomExpiry() {
    const duration = document.getElementById("note-duration");
    const wrap = document.getElementById("note-expires-wrap");
    if (wrap) wrap.classList.toggle("hidden", duration?.value !== "custom");
  }

  function readForm() {
    const zoneId = selectedZoneId;
    const level = document.getElementById("note-level")?.value || "";
    const content = document.getElementById("note-content")?.value.trim() || "";
    const lat = Number(document.getElementById("note-lat")?.value);
    const lng = Number(document.getElementById("note-lng")?.value);
    const durationType = document.getElementById("note-duration")?.value || "";
    const expiresLocal = document.getElementById("note-expires")?.value || "";

    if (!zoneId) throw new Error("Sélectionnez une zone.");
    if (!level) throw new Error("Sélectionnez un niveau.");
    if (!content) throw new Error("Le contenu est obligatoire.");
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Latitude invalide.");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error("Longitude invalide.");
    if (!DURATIONS.some(([v]) => v === durationType)) throw new Error("Durée invalide.");
    if (durationType === "custom") {
      if (!expiresLocal) throw new Error("Saisissez une date d'expiration personnalisée.");
      const expires = new Date(expiresLocal);
      if (Number.isNaN(expires.getTime())) throw new Error("Date d'expiration invalide.");
      return {
        zone_id: Number(zoneId),
        level,
        content,
        position: { lat, lng },
        duration_type: durationType,
        expires_at: expires.toISOString()
      };
    }
    return {
      zone_id: Number(zoneId),
      level,
      content,
      position: { lat, lng },
      duration_type: durationType
    };
  }

  function renderNotes() {
    const el = document.getElementById("notes-list");
    if (!el) return;
    el.innerHTML = "";

    const filtered = notes.filter(note =>
      (!filterLevel || note.level === filterLevel) &&
      (!filterStatus || (note.status || "active") === filterStatus)
    );

    const count = document.createElement("div");
    count.className = "template-result-count";
    count.textContent = filtered.length + " note" + (filtered.length > 1 ? "s" : "");
    el.appendChild(count);

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = notes.length ? "Aucune note ne correspond aux filtres." : "Aucune note pour cette zone.";
      el.appendChild(empty);
      return;
    }

    for (const note of filtered) {
      const row = document.createElement("div");
      row.className = "zone notes-row";

      const main = document.createElement("div");
      main.className = "zone-main";

      const name = document.createElement("div");
      name.className = "zone-name";
      name.textContent = "[" + levelLabel(note.level) + "] " + (note.content || "Note #" + note.id);

      const p = notePosition(note);
      const meta = document.createElement("div");
      meta.className = "zone-meta";
      meta.textContent = "#" + note.id +
        " · " + p.lat + ", " + p.lng +
        " · " + durationLabel(note.duration_type) +
        " · expire " + formatDate(note.expires_at) +
        " · créée " + formatDate(note.created_at);

      const state = document.createElement("span");
      state.className = "tag";
      state.textContent = statusLabel(note.status || "active");

      const actions = document.createElement("div");
      actions.className = "zone-actions";
      actions.appendChild(makeButton("Modifier", () => fillForm(note)));

      if ((note.status || "active") === "archived") {
        actions.appendChild(makeButton("Restaurer", () => updateStatus(note, "active")));
      } else {
        actions.appendChild(makeButton("Archiver", () => archiveNote(note), true));
      }

      row.append(main, state, actions);
      main.append(name, meta);
      el.appendChild(row);
    }
  }

  async function loadNotes() {
    if (!selectedZoneId) {
      notes = [];
      renderNotes();
      return;
    }
    const el = document.getElementById("notes-list");
    if (el) el.textContent = "Chargement…";
    try {
      const data = await json("/api/admin/notes?zone_id=" + encodeURIComponent(selectedZoneId));
      notes = asArray(data, "notes");
      renderNotes();
      setStatus(notes.length + " note(s) chargée(s).");
    } catch (error) {
      console.error("Notes load", error);
      notes = [];
      renderNotes();
      setStatus("Impossible de charger les notes : " + error.message, true);
    }
  }

  async function saveNote() {
    let payload;
    try {
      payload = readForm();
    } catch (error) {
      setStatus(error.message, true);
      return;
    }

    const button = document.getElementById("notes-save");
    const original = button?.textContent || "Enregistrer";
    if (button) {
      button.disabled = true;
      button.textContent = "Enregistrement…";
    }

    try {
      const path = editingId == null
        ? "/api/admin/notes"
        : "/api/admin/notes/" + encodeURIComponent(editingId);
      const method = editingId == null ? "POST" : "PATCH";
      const result = await json(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const saved = result?.note;
      if (saved) {
        const index = notes.findIndex(note => String(note.id) === String(saved.id));
        if (index >= 0) notes[index] = saved;
        else notes.unshift(saved);
      }
      setStatus(editingId == null ? "Note créée." : "Note modifiée.");
      resetForm();
      renderNotes();
      await loadNotes();
    } catch (error) {
      console.error("Notes save", error);
      setStatus("Enregistrement impossible : " + error.message, true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  async function updateStatus(note, status) {
    try {
      await json("/api/admin/notes/" + encodeURIComponent(note.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      await loadNotes();
      setStatus(status === "active" ? "Note restaurée." : "Note mise à jour.");
    } catch (error) {
      console.error("Notes status", error);
      setStatus("Modification du statut impossible : " + error.message, true);
    }
  }

  async function archiveNote(note) {
    if (!window.confirm("Archiver la note #" + note.id + " ?")) return;
    try {
      await json("/api/admin/notes/" + encodeURIComponent(note.id), { method: "DELETE" });
      await loadNotes();
      setStatus("Note archivée.");
    } catch (error) {
      console.error("Notes archive", error);
      setStatus("Archivage impossible : " + error.message, true);
    }
  }

  function loadMapLibreAssets() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (notePlacementAssetsPromise) return notePlacementAssetsPromise;

    notePlacementAssetsPromise = new Promise((resolve, reject) => {
      const cssId = "lc-notes-maplibre-css";
      const scriptId = "lc-notes-maplibre-js";
      if (!document.getElementById(cssId)) {
        const link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css";
        document.head.appendChild(link);
      }
      const existing = document.getElementById(scriptId);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.maplibregl), { once: true });
        existing.addEventListener("error", () => reject(new Error("Impossible de charger MapLibre")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js";
      script.onload = () => resolve(window.maplibregl);
      script.onerror = () => reject(new Error("Impossible de charger MapLibre"));
      document.body.appendChild(script);
    });

    return notePlacementAssetsPromise;
  }

  function closePlacementPicker() {
    if (notePlacementMap) {
      notePlacementMap.remove();
      notePlacementMap = null;
    }
    notePlacementMarker = null;
    document.getElementById("notes-placement-overlay")?.remove();
  }

  async function openPlacementPicker() {
    if (document.getElementById("notes-placement-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "notes-placement-overlay";
    overlay.innerHTML = `
      <div class="notes-placement-card" role="dialog" aria-modal="true" aria-label="Placement d'une Note">
        <div class="notes-placement-head">
          <div>
            <strong>Placer la Note sur la carte</strong>
            <span>Cliquez sur la carte pour choisir précisément la position.</span>
          </div>
          <button id="notes-placement-close" type="button" class="refresh">Fermer</button>
        </div>
        <div id="notes-placement-map" class="notes-placement-map"></div>
        <div class="notes-placement-foot">
          <div id="notes-placement-coordinates" class="notes-placement-coordinates">Aucun point sélectionné.</div>
          <div class="notes-placement-actions">
            <button id="notes-placement-cancel" type="button" class="refresh">Annuler</button>
            <button id="notes-placement-use" type="button" class="refresh" disabled>Utiliser ce point</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("notes-placement-close")?.addEventListener("click", closePlacementPicker);
    document.getElementById("notes-placement-cancel")?.addEventListener("click", closePlacementPicker);

    try {
      const maplibregl = await loadMapLibreAssets();
      if (!document.getElementById("notes-placement-overlay")) return;

      const currentLat = Number(document.getElementById("note-lat")?.value);
      const currentLng = Number(document.getElementById("note-lng")?.value);
      const hasCurrent = Number.isFinite(currentLat) && Number.isFinite(currentLng) &&
        currentLat >= -90 && currentLat <= 90 && currentLng >= -180 && currentLng <= 180;
      const initial = hasCurrent ? [currentLng, currentLat] : [5.93, 43.12];

      notePlacementMap = new maplibregl.Map({
        container: "notes-placement-map",
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: initial,
        zoom: hasCurrent ? 13 : 9,
        minZoom: 1,
        maxZoom: 18,
        attributionControl: true
      });
      notePlacementMap.addControl(new maplibregl.NavigationControl(), "top-right");

      let pending = hasCurrent ? { lat: currentLat, lng: currentLng } : null;
      const coordinates = document.getElementById("notes-placement-coordinates");
      const useButton = document.getElementById("notes-placement-use");

      const setPending = (lngLat, marker = true) => {
        const lat = Number(lngLat.lat);
        const lng = Number(lngLat.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        pending = { lat, lng };
        coordinates.textContent = "Latitude " + lat.toFixed(6) + " · Longitude " + lng.toFixed(6);
        useButton.disabled = false;
        if (marker) {
          if (notePlacementMarker) notePlacementMarker.setLngLat([lng, lat]);
          else notePlacementMarker = new maplibregl.Marker().setLngLat([lng, lat]).addTo(notePlacementMap);
        }
      };

      if (pending) setPending({ lat: currentLat, lng: currentLng });

      notePlacementMap.on("click", event => setPending(event.lngLat));
      useButton.addEventListener("click", () => {
        if (!pending) return;
        setFormValue("note-lat", pending.lat.toFixed(6));
        setFormValue("note-lng", pending.lng.toFixed(6));
        closePlacementPicker();
        setStatus("Position de la Note sélectionnée sur la carte.");
      });
      notePlacementMap.once("load", () => notePlacementMap?.resize());
    } catch (error) {
      console.error("Notes placement map", error);
      closePlacementPicker();
      setStatus("Impossible de charger la carte de placement : " + error.message, true);
    }
  }

  async function loadAccessAndZones() {
    access = await json("/api/admin/access");
    const noteZoneIds = new Set((access?.zones?.notes_manage || []).map(String));
    const data = await json("/api/zones");
    zones = asArray(data, "zones");
    if (access?.access === "admin") {
      noteZones = zones;
    } else if (noteZoneIds.size) {
      noteZones = zones.filter(zone => noteZoneIds.has(String(zone.id)));
    } else {
      noteZones = [];
    }
    selectedZoneId = noteZones.length ? String(noteZones[0].id) : "";
    renderToolbar();
    resetForm();
    await loadNotes();
  }

  function init() {
    const section = document.getElementById("notes");
    if (!section) return;

    const style = document.createElement("style");
    style.textContent = `
      .notes-toolbar{display:grid;grid-template-columns:minmax(190px,1.7fr) repeat(2,minmax(150px,1fr)) auto;gap:7px;margin-top:14px;align-items:center}
      .notes-control{width:100%;min-width:0;padding:8px 9px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:#181818;color:#ccc;font:10px Arial,Helvetica,sans-serif;outline:none}
      .notes-control:focus{border-color:rgba(225,6,0,.5)}
      .notes-row{padding:12px 0;align-items:flex-start}
      .notes-row .zone-main{min-width:0}
      .notes-row .zone-name{white-space:normal;line-height:1.4}
      .notes-danger{border-color:rgba(225,6,0,.32);background:rgba(225,6,0,.06)}
      .notes-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .notes-form-grid .full{grid-column:1/-1}
      .notes-input,.notes-textarea{width:100%;padding:9px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:#181818;color:#fff;font:11px Arial,Helvetica,sans-serif;outline:none}
      .notes-textarea{min-height:100px;resize:vertical}
      .notes-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:12px}
      #notes-state{margin-top:9px}
      .notes-map-place-button{width:100%;margin-top:7px;border:1px solid rgba(230,200,79,.25);border-radius:7px;background:rgba(230,200,79,.06);color:#ddd;padding:8px 9px;cursor:pointer;font-size:9px;font-weight:bold;letter-spacing:.3px}
      .notes-map-place-button:hover{background:rgba(230,200,79,.12);border-color:rgba(230,200,79,.45);color:#fff}
      #notes-placement-overlay{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.72);backdrop-filter:blur(3px)}
      .notes-placement-card{width:min(1050px,100%);height:min(760px,calc(100vh - 40px));display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#111;box-shadow:0 18px 70px rgba(0,0,0,.65)}
      .notes-placement-head{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
      .notes-placement-head strong{display:block;font-size:13px;color:#eee}
      .notes-placement-head span{display:block;margin-top:4px;color:#777;font-size:9px}
      .notes-placement-map{flex:1;min-height:0}
      .notes-placement-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);background:#121212}
      .notes-placement-coordinates{color:#aaa;font:10px Consolas,monospace}
      .notes-placement-actions{display:flex;gap:7px}
      .notes-placement-actions button:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:700px){.notes-toolbar{grid-template-columns:1fr}.notes-form-grid{grid-template-columns:1fr}.notes-form-grid .full{grid-column:auto}.notes-row .template-state{display:none}.notes-placement-card{height:calc(100vh - 20px)}.notes-placement-foot{align-items:stretch;flex-direction:column}.notes-placement-actions{justify-content:flex-end}}
    `;
    document.head.appendChild(style);

    const lngParent = document.getElementById("note-lng")?.parentElement;
    if (lngParent && !document.getElementById("notes-place-map")) {
      const placeButton = document.createElement("button");
      placeButton.id = "notes-place-map";
      placeButton.type = "button";
      placeButton.className = "notes-map-place-button";
      placeButton.textContent = "PLACER SUR LA CARTE";
      placeButton.addEventListener("click", openPlacementPicker);
      lngParent.appendChild(placeButton);
    }

    document.getElementById("note-duration")?.addEventListener("change", toggleCustomExpiry);
    document.getElementById("notes-save")?.addEventListener("click", saveNote);
    document.getElementById("notes-cancel")?.addEventListener("click", resetForm);
    setTimeout(async () => {
      try {
        await loadAccessAndZones();
      } catch (error) {
        console.error("Notes access", error);
        setStatus("Impossible de charger l'accès Notes : " + error.message, true);
      }
    }, 0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
