(() => {
  "use strict";

  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  let templates = [];
  let zones = [];
  let filterText = "";
  let filterZone = "";
  let filterStatus = "active";
  let sortMode = "name";

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
    const response = await fetch(API + path, authOptions(options));
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data?.error || "HTTP " + response.status);
    return data;
  }

  function asArray(data, key) {
    if (Array.isArray(data)) return data;
    if (key && Array.isArray(data?.[key])) return data[key];
    return [];
  }

  function zoneName(template) {
    return template.zone_name || template.zone?.name || zones.find(z => String(z.id) === String(template.zone_id))?.name || "Zone inconnue";
  }

  function formatSize(bytes) {
    if (!Number.isFinite(Number(bytes))) return "";
    const value = Number(bytes);
    if (value < 1024) return value + " o";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " Ko";
    return (value / (1024 * 1024)).toFixed(1) + " Mo";
  }

  function makeButton(label, action, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zone-action";
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", action);
    return button;
  }

  function renderToolbar() {
    const section = document.getElementById("templates");
    if (!section) return;
    let toolbar = document.getElementById("templates-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = "templates-toolbar";
      toolbar.className = "templates-toolbar";
      section.querySelector(".panel")?.before(toolbar);
    }

    toolbar.innerHTML = "";

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Rechercher un template…";
    search.value = filterText;
    search.className = "template-filter-input";
    search.addEventListener("input", () => { filterText = search.value.trim().toLowerCase(); render(); });

    const zone = document.createElement("select");
    zone.className = "template-filter-select";
    const zoneAll = document.createElement("option");
    zoneAll.value = "";
    zoneAll.textContent = "Toutes les zones";
    zone.appendChild(zoneAll);
    [...new Map(templates.map(t => [String(t.zone_id), zoneName(t)])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "fr"))
      .forEach(([id, name]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = name;
        zone.appendChild(option);
      });
    zone.value = filterZone;
    zone.addEventListener("change", () => { filterZone = zone.value; render(); });

    const status = document.createElement("select");
    status.className = "template-filter-select";
    [["active", "Actifs"], ["archived", "Archivés"], ["", "Tous les statuts"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      status.appendChild(option);
    });
    status.value = filterStatus;
    status.addEventListener("change", () => { filterStatus = status.value; render(); });

    const sort = document.createElement("select");
    sort.className = "template-filter-select";
    [["name", "Nom A → Z"], ["zone", "Zone A → Z"], ["version", "Version récente"], ["updated", "Dernière modification"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      sort.appendChild(option);
    });
    sort.value = sortMode;
    sort.addEventListener("change", () => { sortMode = sort.value; render(); });

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "refresh";
    refresh.textContent = "Actualiser";
    refresh.addEventListener("click", load);

    toolbar.append(search, zone, status, sort, refresh);
  }

  function render() {
    const el = document.getElementById("templates-list");
    if (!el) return;
    el.innerHTML = "";

    let list = templates.filter(t => {
      const haystack = [t.name, t.slug, zoneName(t)].filter(Boolean).join(" ").toLowerCase();
      return (!filterText || haystack.includes(filterText)) &&
             (!filterZone || String(t.zone_id) === filterZone) &&
             (!filterStatus || (t.status || "active") === filterStatus);
    });

    list.sort((a, b) => {
      if (sortMode === "zone") return zoneName(a).localeCompare(zoneName(b), "fr") || String(a.name || "").localeCompare(String(b.name || ""), "fr");
      if (sortMode === "version") return Number(b.version || 0) - Number(a.version || 0) || String(a.name || "").localeCompare(String(b.name || ""), "fr");
      if (sortMode === "updated") return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
      return String(a.name || a.slug || "").localeCompare(String(b.name || b.slug || ""), "fr");
    });

    const panelTitle = document.createElement("div");
    panelTitle.className = "template-result-count";
    panelTitle.textContent = list.length + " template" + (list.length > 1 ? "s" : "");
    el.appendChild(panelTitle);

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = templates.length ? "Aucun template ne correspond aux filtres." : "Aucun template accessible.";
      el.appendChild(empty);
      return;
    }

    for (const t of list) {
      const row = document.createElement("div");
      row.className = "zone template-row";

      const main = document.createElement("div");
      main.className = "zone-main";
      const name = document.createElement("div");
      name.className = "zone-name";
      name.textContent = t.name || t.slug || "Template";
      const meta = document.createElement("div");
      meta.className = "zone-meta";
      meta.textContent = zoneName(t) + " · " + (t.slug || "—") + " · v" + (t.version ?? "—");
      main.append(name, meta);

      const state = document.createElement("div");
      state.className = "template-state";
      const status = document.createElement("span");
      status.className = "tag";
      status.textContent = t.status || "active";
      state.appendChild(status);
      if (t.r2_key) {
        const r2 = document.createElement("span");
        r2.className = "template-r2-ok";
        r2.textContent = "R2 ✓";
        r2.title = t.r2_key;
        state.appendChild(r2);
      } else {
        const pending = document.createElement("span");
        pending.className = "template-r2-pending";
        pending.textContent = "R2 —";
        state.appendChild(pending);
      }

      const actions = document.createElement("div");
      actions.className = "zone-actions";
      if (t.status !== "archived") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".wplace,application/octet-stream";
        input.hidden = true;
        const upload = makeButton(t.r2_key ? "Remplacer" : "Upload .wplace", () => input.click());
        input.addEventListener("change", () => uploadTemplate(t, input, upload));
        actions.append(input, upload);
      }

      row.append(main, state, actions);
      el.appendChild(row);
    }
  }

  async function uploadTemplate(template, input, button) {
    const file = input.files?.[0];
    if (!file) return;
    if (!/\.wplace$/i.test(file.name)) {
      alert("Sélectionnez un fichier .wplace.");
      input.value = "";
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      alert("Le fichier dépasse la limite de 100 Mo.");
      input.value = "";
      return;
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Upload…";
    try {
      const result = await json("/api/admin/templates/" + encodeURIComponent(template.id) + "/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Template-Filename": file.name
        },
        body: file
      });
      const updated = result?.template;
      if (updated) {
        const index = templates.findIndex(t => String(t.id) === String(template.id));
        if (index >= 0) templates[index] = { ...templates[index], ...updated, r2_key: result.upload?.r2_key || updated.r2_key };
      }
      button.textContent = "Upload OK";
      render();
    } catch (error) {
      console.error("Upload template", error);
      button.disabled = false;
      button.textContent = original;
      alert("Upload impossible : " + error.message);
    } finally {
      input.value = "";
    }
  }

  async function load() {
    try {
      const [templateData, zoneData] = await Promise.all([
        json("/api/admin/templates"),
        json("/api/admin/zones")
      ]);
      templates = asArray(templateData, "templates");
      zones = asArray(zoneData, "zones");
      renderToolbar();
      render();
      const count = document.getElementById("count-templates");
      if (count) count.textContent = templates.filter(t => (t.status || "active") === "active").length;
    } catch (error) {
      console.error("Templates admin", error);
      const el = document.getElementById("templates-list");
      if (el) {
        el.innerHTML = "";
        const errorBox = document.createElement("div");
        errorBox.className = "error";
        errorBox.textContent = "Impossible de charger les templates : " + error.message;
        el.appendChild(errorBox);
      }
    }
  }

  function init() {
    const section = document.getElementById("templates");
    if (!section) return;
    const style = document.createElement("style");
    style.textContent = `
      .templates-toolbar{display:grid;grid-template-columns:minmax(180px,1.6fr) minmax(150px,1fr) minmax(130px,.8fr) minmax(150px,1fr) auto;gap:7px;margin-top:14px;align-items:center}
      .template-filter-input,.template-filter-select{width:100%;min-width:0;padding:8px 9px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:#181818;color:#ccc;font:10px Arial,Helvetica,sans-serif;outline:none}
      .template-filter-input:focus,.template-filter-select:focus{border-color:rgba(225,6,0,.5)}
      .template-result-count{padding:0 0 8px;color:#666;font-size:9px;text-transform:uppercase;letter-spacing:.7px}
      .template-row{padding:12px 0}
      .template-state{display:flex;align-items:center;gap:6px;flex:0 0 auto}
      .template-r2-ok,.template-r2-pending{padding:4px 7px;border-radius:4px;font-size:9px;white-space:nowrap}
      .template-r2-ok{border:1px solid rgba(65,190,110,.25);background:rgba(65,190,110,.06);color:#9dccaa}
      .template-r2-pending{border:1px solid rgba(255,255,255,.08);color:#666}
      .zone-action:disabled{opacity:.55;cursor:wait}
      @media(max-width:900px){.templates-toolbar{grid-template-columns:1fr 1fr}.templates-toolbar .refresh{width:100%}}
      @media(max-width:600px){.templates-toolbar{grid-template-columns:1fr}.template-state{display:none}.template-row{align-items:flex-start}.template-row .zone-actions{margin-top:2px}}
    `;
    document.head.appendChild(style);

    const templatesNav = document.querySelector('[data-section="templates"]');
    templatesNav?.addEventListener("click", () => setTimeout(load, 0));

    // The legacy page renderer may run first; this bounded refresh replaces it without observers.
    setTimeout(load, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
