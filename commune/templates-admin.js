(() => {
  "use strict";

  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  let templates = [];
  let zones = [];
  let filterText = "";
  let filterCountry = "";
  let filterContinent = "";
  let filterCategory = "";
  let filterStatus = "active";
  let sortMode = "version";
  let access = null;

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

  function zoneInfo(t) {
    const z = zones.find(z => String(z.id) === String(t.zone_id));
    return {
      name: t.zone_name || t.zone?.name || z?.name || "Zone inconnue",
      country: t.country || t.zone?.country || z?.country || "",
      continent: t.continent || t.zone?.continent || z?.continent || "",
      category: t.category_name || t.zone?.category_name || z?.category_name || t.category_slug || t.zone?.category_slug || z?.category_slug || ""
    };
  }

  function categoryRank(v) {
    v = String(v || "").toLowerCase();
    if (v.includes("commune")) return 0;
    if (v.includes("sympathisant") || v === "allie" || v === "allié") return 1;
    if (v.includes("neutre")) return 2;
    return 9;
  }

  function categoryLabel(v) {
    const r = categoryRank(v);
    return r === 0 ? "La Commune" : r === 1 ? "Allié" : r === 2 ? "Neutre" : (v || "Autre");
  }

  function makeButton(label, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "zone-action";
    b.textContent = label;
    b.addEventListener("click", action);
    return b;
  }

  function addSelect(toolbar, items, value, onChange) {
    const s = document.createElement("select");
    s.className = "template-filter-select";
    items.forEach(([v, l]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      s.appendChild(o);
    });
    s.value = value;
    s.addEventListener("change", () => { onChange(s.value); render(); });
    toolbar.appendChild(s);
    return s;
  }

  function applyStaffAccess() {
    if (!access?.authenticated) return false;

    const templateZones = (access.zones?.templates_manage || []).map(String);
    const notesZones = (access.zones?.notes_manage || []).map(String);
    const canTemplates = access.permissions?.templates_manage === true && templateZones.length > 0;
    const canNotes = access.permissions?.notes_manage === true && notesZones.length > 0;

    if (access.access === "admin" || access.access === "moderator") return false;

    const navs = [...document.querySelectorAll(".navbtn")];
    const allowed = new Set();
    if (canTemplates) allowed.add("templates");
    if (canNotes) allowed.add("notes");

    navs.forEach(button => {
      const section = button.dataset.section;
      button.classList.toggle("hidden", !allowed.has(section));
    });

    document.querySelectorAll(".section").forEach(section => {
      section.classList.remove("active");
    });

    if (canTemplates) {
      const button = document.querySelector('[data-section="templates"]');
      const section = document.getElementById("templates");
      button?.classList.add("active");
      section?.classList.add("active");
    } else if (canNotes) {
      const main = document.querySelector(".main");
      if (main) {
        main.innerHTML = '<section class="section active"><h2>Notes</h2><p>Vous disposez de la permission de gestion des notes, mais le module Notes n’est pas encore intégré à cette interface.</p><div class="notice">La permission serveur est active ; aucune action n’est exposée tant que le module Notes n’est pas implémenté.</div></section>';
      }
    } else {
      return false;
    }

    document.getElementById("gate")?.classList.add("hidden");
    document.getElementById("app")?.classList.remove("hidden");
    const role = document.getElementById("role");
    if (role) role.textContent = canTemplates && canNotes ? "Staff zone" : canTemplates ? "Template Manager" : "Manager";
    return canTemplates || canNotes;
  }

  async function loadStaffAccess() {
    try {
      access = await json("/api/admin/access");
      return applyStaffAccess();
    } catch (error) {
      console.error("Zone staff access", error);
      return false;
    }
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
    toolbar.appendChild(search);

    const continents = [...new Set(templates.map(t => zoneInfo(t).continent).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
    addSelect(toolbar, [["", "Tous les continents"], ...continents.map(x => [x, x])], filterContinent, v => filterContinent = v);

    const countries = [...new Set(templates.map(t => zoneInfo(t).country).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
    addSelect(toolbar, [["", "Tous les pays"], ...countries.map(x => [x, x])], filterCountry, v => filterCountry = v);
    addSelect(toolbar, [["", "Toutes les catégories"], ["commune", "La Commune"], ["allie", "Allié"], ["neutre", "Neutre"]], filterCategory, v => filterCategory = v);
    addSelect(toolbar, [["active", "Actifs"], ["archived", "Archivés"], ["", "Tous les statuts"]], filterStatus, v => filterStatus = v);
    addSelect(toolbar, [["version", "Version récente"], ["country", "Pays A → Z"], ["continent", "Continent A → Z"], ["category", "Catégorie : La Commune → Allié → Neutre"], ["name", "Nom A → Z"], ["updated", "Dernière modification"]], sortMode, v => sortMode = v);

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "refresh";
    refresh.textContent = "Actualiser";
    refresh.addEventListener("click", load);
    toolbar.appendChild(refresh);
  }

  function render() {
    const el = document.getElementById("templates-list");
    if (!el) return;
    el.innerHTML = "";

    let list = templates.filter(t => {
      const i = zoneInfo(t);
      const cat = categoryRank(i.category);
      const hay = [t.name, t.slug, i.name, i.country, i.continent, categoryLabel(i.category)].filter(Boolean).join(" ").toLowerCase();
      return (!filterText || hay.includes(filterText)) &&
        (!filterCountry || i.country === filterCountry) &&
        (!filterContinent || i.continent === filterContinent) &&
        (!filterCategory || (filterCategory === "commune" ? cat === 0 : filterCategory === "allie" ? cat === 1 : filterCategory === "neutre" ? cat === 2 : false)) &&
        (!filterStatus || (t.status || "active") === filterStatus);
    });

    list.sort((a, b) => {
      const A = zoneInfo(a), B = zoneInfo(b);
      if (sortMode === "country") return A.country.localeCompare(B.country, "fr") || A.continent.localeCompare(B.continent, "fr") || A.name.localeCompare(B.name, "fr");
      if (sortMode === "continent") return A.continent.localeCompare(B.continent, "fr") || A.country.localeCompare(B.country, "fr") || A.name.localeCompare(B.name, "fr");
      if (sortMode === "category") return categoryRank(A.category) - categoryRank(B.category) || A.country.localeCompare(B.country, "fr") || A.name.localeCompare(B.name, "fr");
      if (sortMode === "name") return String(a.name || a.slug || "").localeCompare(String(b.name || b.slug || ""), "fr");
      if (sortMode === "updated") return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
      return Number(b.version || 0) - Number(a.version || 0) || String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
    });

    const count = document.createElement("div");
    count.className = "template-result-count";
    count.textContent = list.length + " template" + (list.length > 1 ? "s" : "");
    el.appendChild(count);

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = templates.length ? "Aucun template ne correspond aux filtres." : "Aucun template accessible.";
      el.appendChild(empty);
      return;
    }

    for (const t of list) {
      const i = zoneInfo(t);
      const row = document.createElement("div");
      row.className = "zone template-row";
      const main = document.createElement("div");
      main.className = "zone-main";
      const name = document.createElement("div");
      name.className = "zone-name";
      name.textContent = t.name || t.slug || "Template";
      const meta = document.createElement("div");
      meta.className = "zone-meta";
      meta.textContent = i.name + " · " + (t.slug || "—") + " · v" + (t.version ?? "—");
      main.append(name, meta);

      const state = document.createElement("div");
      state.className = "template-state";
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t.status || "active";
      state.appendChild(tag);
      const r2 = document.createElement("span");
      r2.className = t.r2_key ? "template-r2-ok" : "template-r2-pending";
      r2.textContent = t.r2_key ? "R2 ✓" : "R2 —";
      if (t.r2_key) r2.title = t.r2_key;
      state.appendChild(r2);

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
      if (t.r2_key && t.status !== "archived") {
        const download = makeButton("Télécharger", () => downloadTemplate(t, download));
        actions.append(download);
      }
      row.append(main, state, actions);
      el.appendChild(row);
    }
  }

  async function uploadTemplate(template, input, button) {
    const file = input.files?.[0];
    if (!file) return;
    if (!/\.wplace$/i.test(file.name)) { alert("Sélectionnez un fichier .wplace."); input.value = ""; return; }
    if (file.size > 100 * 1024 * 1024) { alert("Le fichier dépasse la limite de 100 Mo."); input.value = ""; return; }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Upload…";
    try {
      const result = await json("/api/admin/templates/" + encodeURIComponent(template.id) + "/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Template-Filename": file.name },
        body: file
      });
      const updated = result?.template;
      const index = templates.findIndex(t => String(t.id) === String(template.id));
      if (index >= 0) templates[index] = { ...templates[index], ...(updated || {}), r2_key: result.upload?.r2_key || updated?.r2_key || templates[index].r2_key };
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

  async function downloadTemplate(template, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Téléchargement…";
    try {
      const zoneRef = template.zone_slug || template.zone_id;
      const templateRef = template.slug || template.id;
      const response = await fetch(API + "/api/zones/" + encodeURIComponent(zoneRef) + "/templates/" + encodeURIComponent(templateRef) + "/download", authOptions());
      if (!response.ok) {
        let detail = "HTTP " + response.status;
        try { const data = await response.json(); if (data?.error) detail = data.error; } catch {}
        throw new Error(detail);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = (String(template.name || template.slug || "template").replace(/[\\/:*?"<>|\r\n]+/g, "-").replace(/\s+/g, " ").trim() || "template") + ".wplace";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error("Download template", error);
      alert("Téléchargement impossible : " + error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function load() {
    try {
      const [templateData, zoneData] = await Promise.all([
        json("/api/admin/templates"),
        json("/api/zones")
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
        const box = document.createElement("div");
        box.className = "error";
        box.textContent = "Impossible de charger les templates : " + error.message;
        el.appendChild(box);
      }
    }
  }

  function init() {
    const section = document.getElementById("templates");
    if (!section) return;
    const style = document.createElement("style");
    style.textContent = `.templates-toolbar{display:grid;grid-template-columns:minmax(190px,1.7fr) repeat(5,minmax(120px,1fr)) auto;gap:7px;margin-top:14px;align-items:center}.template-filter-input,.template-filter-select{width:100%;min-width:0;padding:8px 9px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:#181818;color:#ccc;font:10px Arial,Helvetica,sans-serif;outline:none}.template-filter-input:focus,.template-filter-select:focus{border-color:rgba(225,6,0,.5)}.template-result-count{padding:0 0 8px;color:#666;font-size:9px;text-transform:uppercase;letter-spacing:.7px}.template-row{padding:12px 0}.template-state{display:flex;align-items:center;gap:6px;flex:0 0 auto}.template-r2-ok,.template-r2-pending{padding:4px 7px;border-radius:4px;font-size:9px;white-space:nowrap}.template-r2-ok{border:1px solid rgba(65,190,110,.25);background:rgba(65,190,110,.06);color:#9dccaa}.template-r2-pending{border:1px solid rgba(255,255,255,.08);color:#666}.zone-action:disabled{opacity:.55;cursor:wait}@media(max-width:1100px){.templates-toolbar{grid-template-columns:repeat(3,minmax(150px,1fr))}.templates-toolbar .template-filter-input{grid-column:span 3}}@media(max-width:600px){.templates-toolbar{grid-template-columns:1fr}.templates-toolbar .template-filter-input{grid-column:auto}.template-state{display:none}.template-row{align-items:flex-start}.template-row .zone-actions{margin-top:2px}}`;
    document.head.appendChild(style);
    const notice = section.querySelector(".notice");
    if (notice) notice.textContent = "Gestion des fichiers .wplace via R2 disponible directement depuis chaque template.";
    document.querySelector('[data-section="templates"]')?.addEventListener("click", () => setTimeout(load, 0));
    setTimeout(async () => {
      const staffOpened = await loadStaffAccess();
      if (staffOpened && access?.permissions?.templates_manage) await load();
    }, 0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
