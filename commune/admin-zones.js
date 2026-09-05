(() => {
  "use strict";

  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  const STYLE_ID = "lc-admin-zones-v1";
  let zonesCache = [];
  let categoriesCache = [
    { slug: "commune", name: "La Commune" },
    { slug: "allie", name: "Allié" },
    { slug: "neutre", name: "Neutre" }
  ];

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .lc-zone-actions{margin-left:auto;display:flex;align-items:center;gap:5px;flex:0 0 auto}
    .lc-zone-edit{border:1px solid rgba(225,6,0,.32);background:rgba(225,6,0,.07);color:#ddd;border-radius:7px;padding:5px 7px;cursor:pointer;font-size:9px}
    .lc-zone-edit:hover{background:rgba(225,6,0,.16);border-color:rgba(225,6,0,.55);color:#fff}
    #lc-zone-modal{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.66);backdrop-filter:blur(3px)}
    #lc-zone-modal.open{display:flex}
    .lc-zone-dialog{width:min(720px,100%);max-height:min(90vh,760px);overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:#111;box-shadow:0 24px 80px rgba(0,0,0,.65);color:#eee}
    .lc-zone-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
    .lc-zone-head h3{margin:0;font-size:15px}.lc-zone-head small{display:block;margin-top:3px;color:#777;font:9px Consolas,monospace}
    .lc-zone-close{width:30px;height:30px;border:0;border-radius:9px;background:#1b1b1b;color:#aaa;cursor:pointer;font-size:16px}.lc-zone-close:hover{background:#292929;color:#fff}
    .lc-zone-form{display:grid;grid-template-columns:1fr 1fr;gap:11px;padding:18px}
    .lc-zone-field{display:flex;flex-direction:column;gap:5px}.lc-zone-field.full{grid-column:1/-1}
    .lc-zone-field label{color:#777;font-size:9px;text-transform:uppercase;letter-spacing:.75px}
    .lc-zone-field input,.lc-zone-field select,.lc-zone-field textarea{width:100%;border:1px solid rgba(255,255,255,.11);border-radius:9px;background:#181818;color:#fff;padding:9px 10px;font:11px Arial,Helvetica,sans-serif;outline:none}
    .lc-zone-field textarea{min-height:78px;resize:vertical;line-height:1.45}.lc-zone-field input:focus,.lc-zone-field select:focus,.lc-zone-field textarea:focus{border-color:rgba(225,6,0,.55);box-shadow:0 0 0 2px rgba(225,6,0,.08)}
    .lc-zone-check{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025);color:#aaa;font-size:10px}
    .lc-zone-check input{width:auto;accent-color:#e10600}
    .lc-zone-readonly{opacity:.65}.lc-zone-actions-bottom{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:4px}
    .lc-zone-state{min-height:18px;color:#888;font-size:10px}.lc-zone-state.error{color:#e99}.lc-zone-state.ok{color:#9dcea0}
    .lc-zone-btn{border:1px solid rgba(255,255,255,.1);border-radius:9px;background:#1b1b1b;color:#aaa;padding:8px 11px;cursor:pointer;font-size:10px}.lc-zone-btn:hover{background:#292929;color:#fff}
    .lc-zone-btn.primary{border-color:rgba(225,6,0,.55);background:#b90500;color:#fff}.lc-zone-btn.primary:hover{background:#e10600}
    @media(max-width:620px){.lc-zone-form{grid-template-columns:1fr}.lc-zone-field.full,.lc-zone-actions-bottom{grid-column:auto}.lc-zone-dialog{max-height:94vh}}
  `;
  document.head.appendChild(style);

  function authOptions(extra = {}) {
    const token = sessionStorage.getItem("wplace_session");
    return token
      ? { ...extra, headers: { ...(extra.headers || {}), Authorization: "Bearer " + token }, cache: "no-store" }
      : { ...extra, credentials: "include", cache: "no-store" };
  }

  async function getOverview() {
    const response = await fetch(API + "/api/admin/overview", authOptions());
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error("HTTP " + response.status);
    return data;
  }

  async function loadZone(id) {
    const known = zonesCache.find(z => String(z.id) === String(id) || String(z.slug) === String(id));
    if (known) return known;
    const response = await fetch(API + "/api/admin/zones/" + encodeURIComponent(id), authOptions());
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error("HTTP " + response.status);
    return data?.zone || data;
  }

  function parseCenter(value) {
    if (!value) return { longitude: "", latitude: "" };
    let c = value;
    if (typeof c === "string") { try { c = JSON.parse(c); } catch { return { longitude: "", latitude: "" }; } }
    if (Array.isArray(c)) return { longitude: c[0] ?? "", latitude: c[1] ?? "" };
    return { longitude: c.longitude ?? c.lng ?? "", latitude: c.latitude ?? c.lat ?? "" };
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function ensureModal() {
    if (document.getElementById("lc-zone-modal")) return;
    const modal = document.createElement("div");
    modal.id = "lc-zone-modal";
    modal.innerHTML = `
      <div class="lc-zone-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-zone-title">
        <div class="lc-zone-head">
          <div><h3 id="lc-zone-title">Modifier la zone</h3><small id="lc-zone-subtitle">—</small></div>
          <button class="lc-zone-close" id="lc-zone-close" type="button" aria-label="Fermer">×</button>
        </div>
        <form class="lc-zone-form" id="lc-zone-form">
          <div class="lc-zone-field full"><label for="lc-zone-name">Nom</label><input id="lc-zone-name" name="name" required maxlength="120"></div>
          <div class="lc-zone-field"><label for="lc-zone-slug">Slug</label><input id="lc-zone-slug" name="slug" required maxlength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></div>
          <div class="lc-zone-field"><label for="lc-zone-category">Catégorie</label><select id="lc-zone-category" name="category_slug"></select></div>
          <div class="lc-zone-field full"><label for="lc-zone-description">Description</label><textarea id="lc-zone-description" name="description" maxlength="1000"></textarea></div>
          <div class="lc-zone-field"><label for="lc-zone-continent">Continent</label><input id="lc-zone-continent" name="continent" required maxlength="80"></div>
          <div class="lc-zone-field"><label for="lc-zone-country">Pays</label><input id="lc-zone-country" name="country" required maxlength="80"></div>
          <div class="lc-zone-field"><label for="lc-zone-owner">Propriétaire</label><input id="lc-zone-owner" name="owner_name" maxlength="120"></div>
          <label class="lc-zone-check"><input id="lc-zone-owner-public" name="owner_public" type="checkbox"> Afficher publiquement le propriétaire</label>
          <div class="lc-zone-field"><label for="lc-zone-status">Statut</label><select id="lc-zone-status" name="status"><option value="active">Active</option><option value="archived">Archivée</option></select></div>
          <div class="lc-zone-field"><label>Version actuelle</label><input id="lc-zone-version" class="lc-zone-readonly" readonly></div>
          <div class="lc-zone-field"><label for="lc-zone-lon">Centre — longitude</label><input id="lc-zone-lon" name="longitude" type="number" step="any" min="-180" max="180"></div>
          <div class="lc-zone-field"><label for="lc-zone-lat">Centre — latitude</label><input id="lc-zone-lat" name="latitude" type="number" step="any" min="-90" max="90"></div>
          <div class="lc-zone-field"><label for="lc-zone-zoom">Zoom initial</label><input id="lc-zone-zoom" name="focus_zoom" type="number" step="0.1" min="0" max="24"></div>
          <div class="lc-zone-actions-bottom"><div id="lc-zone-state" class="lc-zone-state"></div><div style="display:flex;gap:7px"><button class="lc-zone-btn" id="lc-zone-cancel" type="button">Annuler</button><button class="lc-zone-btn primary" type="submit">Enregistrer</button></div></div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("lc-zone-close").onclick = closeModal;
    document.getElementById("lc-zone-cancel").onclick = closeModal;
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });
    document.getElementById("lc-zone-form").addEventListener("submit", saveZone);
  }

  let editingZone = null;

  function openModal(zone) {
    ensureModal();
    editingZone = zone;
    const center = parseCenter(zone.center);
    document.getElementById("lc-zone-title").textContent = "Modifier la zone";
    document.getElementById("lc-zone-subtitle").textContent = (zone.slug || zone.id || "zone") + " · v" + (zone.version ?? "—");
    document.getElementById("lc-zone-name").value = zone.name || "";
    document.getElementById("lc-zone-slug").value = zone.slug || "";
    document.getElementById("lc-zone-description").value = zone.description || "";
    document.getElementById("lc-zone-continent").value = zone.continent || "";
    document.getElementById("lc-zone-country").value = zone.country || "";
    document.getElementById("lc-zone-owner").value = zone.owner_name || "";
    document.getElementById("lc-zone-owner-public").checked = zone.owner_public !== 0 && zone.owner_public !== false;
    document.getElementById("lc-zone-status").value = zone.status || "active";
    document.getElementById("lc-zone-version").value = zone.version ?? "—";
    document.getElementById("lc-zone-lon").value = center.longitude;
    document.getElementById("lc-zone-lat").value = center.latitude;
    document.getElementById("lc-zone-zoom").value = zone.focus_zoom ?? "";
    const select = document.getElementById("lc-zone-category");
    const current = zone.category_slug || zone.category || "";
    select.innerHTML = categoriesCache.map(c => `<option value="${esc(c.slug)}" ${c.slug === current ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    const state = document.getElementById("lc-zone-state"); state.className = "lc-zone-state"; state.textContent = "";
    document.getElementById("lc-zone-modal").classList.add("open");
    setTimeout(() => document.getElementById("lc-zone-name").focus(), 0);
  }

  function closeModal() {
    const modal = document.getElementById("lc-zone-modal");
    if (modal) modal.classList.remove("open");
    editingZone = null;
  }

  async function saveZone(event) {
    event.preventDefault();
    if (!editingZone) return;
    const state = document.getElementById("lc-zone-state");
    state.className = "lc-zone-state"; state.textContent = "Enregistrement…";
    const body = {
      name: document.getElementById("lc-zone-name").value.trim(),
      slug: document.getElementById("lc-zone-slug").value.trim(),
      description: document.getElementById("lc-zone-description").value.trim(),
      category_slug: document.getElementById("lc-zone-category").value,
      continent: document.getElementById("lc-zone-continent").value.trim(),
      country: document.getElementById("lc-zone-country").value.trim(),
      owner_name: document.getElementById("lc-zone-owner").value.trim() || null,
      owner_public: document.getElementById("lc-zone-owner-public").checked,
      status: document.getElementById("lc-zone-status").value,
      center: { longitude: Number(document.getElementById("lc-zone-lon").value), latitude: Number(document.getElementById("lc-zone-lat").value) },
      focus_zoom: Number(document.getElementById("lc-zone-zoom").value)
    };
    if (!Number.isFinite(body.center.longitude) || !Number.isFinite(body.center.latitude) || !Number.isFinite(body.focus_zoom)) {
      state.className = "lc-zone-state error"; state.textContent = "Centre et zoom doivent être renseignés."; return;
    }
    const id = editingZone.id ?? editingZone.slug;
    try {
      let response = await fetch(API + "/api/admin/zones/" + encodeURIComponent(id), authOptions({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (response.status === 405) {
        response = await fetch(API + "/api/admin/zones/" + encodeURIComponent(id), authOptions({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      }
      let data = null; try { data = await response.json(); } catch {}
      if (!response.ok) throw new Error(data?.error || data?.message || "HTTP " + response.status);
      state.className = "lc-zone-state ok"; state.textContent = "Zone enregistrée.";
      setTimeout(() => { closeModal(); window.location.reload(); }, 550);
    } catch (error) {
      console.error("Zone update", error);
      state.className = "lc-zone-state error";
      state.textContent = "Échec : " + error.message;
    }
  }

  function attachButtons() {
    const list = document.getElementById("zones-list");
    if (!list) return;
    [...list.querySelectorAll(".zone")].forEach((row, index) => {
      if (row.querySelector(".lc-zone-actions")) return;
      const zone = zonesCache[index];
      if (!zone) return;
      const actions = document.createElement("div"); actions.className = "lc-zone-actions";
      const button = document.createElement("button"); button.className = "lc-zone-edit"; button.type = "button"; button.textContent = "Modifier";
      button.onclick = async () => {
        try { openModal(await loadZone(zone.id ?? zone.slug)); } catch (e) { console.error(e); alert("Impossible de charger cette zone : " + e.message); }
      };
      actions.appendChild(button); row.appendChild(actions);
    });
  }

  async function init() {
    try {
      const overview = await getOverview();
      zonesCache = Array.isArray(overview?.zones) ? overview.zones : [];
      if (Array.isArray(overview?.categories) && overview.categories.length) categoriesCache = overview.categories;
      attachButtons();
    } catch (e) {
      console.warn("Éditeur des zones : overview indisponible", e);
    }
    const observer = new MutationObserver(() => attachButtons());
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(attachButtons, 400);
    setTimeout(attachButtons, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
