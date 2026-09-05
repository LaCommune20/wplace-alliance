(() => {
  "use strict";

  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  let zones = [];
  let categories = [
    ["commune", "La Commune"],
    ["allie", "Allié"],
    ["neutre", "Neutre"]
  ];
  let editingZone = null;

  const style = document.createElement("style");
  style.textContent = `
    .lc-zone-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex:0 0 auto}
    .lc-zone-edit{border:1px solid rgba(225,6,0,.35);border-radius:7px;background:rgba(225,6,0,.07);color:#ddd;padding:5px 9px;cursor:pointer;font-size:9px}
    .lc-zone-edit:hover{background:rgba(225,6,0,.16);border-color:rgba(225,6,0,.6);color:#fff}
    .lc-zone-edit:disabled{opacity:.5;cursor:wait}
    #lc-zone-modal{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.68);backdrop-filter:blur(3px)}
    #lc-zone-modal.open{display:flex}
    .lc-zone-dialog{width:min(720px,100%);max-height:min(90vh,760px);overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:#111;box-shadow:0 24px 80px rgba(0,0,0,.65);color:#eee}
    .lc-zone-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
    .lc-zone-head h3{margin:0;font-size:15px}.lc-zone-head small{display:block;margin-top:3px;color:#777;font:9px Consolas,monospace}
    .lc-zone-close{border:0;border-radius:9px;background:#1b1b1b;color:#aaa;padding:7px 10px;cursor:pointer}.lc-zone-close:hover{background:#292929;color:#fff}
    .lc-zone-form{display:grid;grid-template-columns:1fr 1fr;gap:11px;padding:18px}
    .lc-zone-field{display:flex;flex-direction:column;gap:5px}.lc-zone-field.full{grid-column:1/-1}
    .lc-zone-field label{color:#777;font-size:9px;text-transform:uppercase;letter-spacing:.75px}
    .lc-zone-field input,.lc-zone-field select,.lc-zone-field textarea{width:100%;border:1px solid rgba(255,255,255,.11);border-radius:9px;background:#181818;color:#fff;padding:9px 10px;font:11px Arial,Helvetica,sans-serif;outline:none}
    .lc-zone-field textarea{min-height:90px;resize:vertical;line-height:1.45}.lc-zone-field input:focus,.lc-zone-field select:focus,.lc-zone-field textarea:focus{border-color:rgba(225,6,0,.55);box-shadow:0 0 0 2px rgba(225,6,0,.08)}
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
    const base = token ? { headers: { Authorization: "Bearer " + token }, cache: "no-store" } : { credentials: "include", cache: "no-store" };
    return { ...base, ...extra, headers: { ...(base.headers || {}), ...(extra.headers || {}) } };
  }

  async function getJson(path) {
    const response = await fetch(API + path, authOptions());
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "HTTP " + response.status);
    return data;
  }

  async function loadZones() {
    const data = await getJson("/api/admin/zones");
    return Array.isArray(data) ? data : (Array.isArray(data?.zones) ? data.zones : []);
  }

  async function loadZone(id) {
    const data = await getJson("/api/admin/zones/" + encodeURIComponent(id));
    return data?.zone || data;
  }

  function canonicalCategory(slug, fallback = "") {
    const s = String(slug || "").toLowerCase();
    if (s === "commune") return "La Commune";
    if (s === "allie" || s === "sympathisant" || s === "allie-neutre") return "Allié";
    if (s === "neutre") return "Neutre";
    return fallback || slug || "—";
  }

  function parseCenter(value) {
    if (!value) return { longitude: "", latitude: "" };
    let c = value;
    if (typeof c === "string") { try { c = JSON.parse(c); } catch { return { longitude: "", latitude: "" }; } }
    if (Array.isArray(c)) return { longitude: c[0] ?? "", latitude: c[1] ?? "" };
    return { longitude: c.longitude ?? c.lng ?? "", latitude: c.latitude ?? c.lat ?? "" };
  }

  function ensureModal() {
    if (document.getElementById("lc-zone-modal")) return;
    const modal = document.createElement("div");
    modal.id = "lc-zone-modal";
    modal.innerHTML = `
      <div class="lc-zone-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-zone-title">
        <div class="lc-zone-head"><div><h3 id="lc-zone-title">Modifier la zone</h3><small id="lc-zone-subtitle">—</small></div><button class="lc-zone-close" id="lc-zone-close" type="button" aria-label="Fermer">×</button></div>
        <form class="lc-zone-form" id="lc-zone-form">
          <div class="lc-zone-field full"><label for="lc-zone-name">Nom</label><input id="lc-zone-name" required maxlength="120"></div>
          <div class="lc-zone-field"><label for="lc-zone-slug">Slug</label><input id="lc-zone-slug" required maxlength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></div>
          <div class="lc-zone-field"><label for="lc-zone-category">Catégorie</label><select id="lc-zone-category"></select></div>
          <div class="lc-zone-field full"><label for="lc-zone-description">Description</label><textarea id="lc-zone-description" maxlength="1000"></textarea></div>
          <div class="lc-zone-field"><label for="lc-zone-continent">Continent</label><input id="lc-zone-continent" required maxlength="80"></div>
          <div class="lc-zone-field"><label for="lc-zone-country">Pays</label><input id="lc-zone-country" required maxlength="80"></div>
          <div class="lc-zone-field"><label for="lc-zone-owner">Responsable</label><input id="lc-zone-owner" maxlength="120"></div>
          <label class="lc-zone-check"><input id="lc-zone-owner-public" type="checkbox"> Afficher le responsable publiquement</label>
          <div class="lc-zone-field"><label for="lc-zone-status">Statut</label><select id="lc-zone-status"><option value="active">Active</option><option value="archived">Archivée</option></select></div>
          <div class="lc-zone-field"><label>Version actuelle</label><input id="lc-zone-version" class="lc-zone-readonly" readonly></div>
          <div class="lc-zone-field"><label for="lc-zone-lon">Centre — longitude</label><input id="lc-zone-lon" type="number" step="any" min="-180" max="180"></div>
          <div class="lc-zone-field"><label for="lc-zone-lat">Centre — latitude</label><input id="lc-zone-lat" type="number" step="any" min="-90" max="90"></div>
          <div class="lc-zone-field"><label for="lc-zone-zoom">Zoom initial</label><input id="lc-zone-zoom" type="number" step="0.1" min="0" max="24"></div>
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

  function openModal(zone) {
    ensureModal();
    editingZone = zone;
    const center = parseCenter(zone.center);
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
    const current = zone.category_slug || zone.category || "";
    const select = document.getElementById("lc-zone-category");
    select.innerHTML = "";
    const used = new Set();
    for (const [slug,name] of categories) {
      const label = canonicalCategory(slug,name);
      if (used.has(label)) continue;
      used.add(label);
      const option=document.createElement("option"); option.value=slug; option.textContent=label;
      if (slug===current || label===canonicalCategory(current)) option.selected=true;
      select.appendChild(option);
    }
    const state=document.getElementById("lc-zone-state"); state.className="lc-zone-state"; state.textContent="";
    document.getElementById("lc-zone-modal").classList.add("open");
    setTimeout(()=>document.getElementById("lc-zone-name").focus(),0);
  }

  function closeModal(){ const modal=document.getElementById("lc-zone-modal"); if(modal) modal.classList.remove("open"); editingZone=null; }

  async function saveZone(event){
    event.preventDefault();
    if(!editingZone)return;
    const state=document.getElementById("lc-zone-state"); state.className="lc-zone-state"; state.textContent="Enregistrement…";
    const body={
      name:document.getElementById("lc-zone-name").value.trim(),
      slug:document.getElementById("lc-zone-slug").value.trim(),
      description:document.getElementById("lc-zone-description").value.trim(),
      category_slug:document.getElementById("lc-zone-category").value,
      continent:document.getElementById("lc-zone-continent").value.trim(),
      country:document.getElementById("lc-zone-country").value.trim(),
      owner_name:document.getElementById("lc-zone-owner").value.trim() || null,
      owner_public:document.getElementById("lc-zone-owner-public").checked,
      status:document.getElementById("lc-zone-status").value,
      center:{longitude:Number(document.getElementById("lc-zone-lon").value),latitude:Number(document.getElementById("lc-zone-lat").value)},
      focus_zoom:Number(document.getElementById("lc-zone-zoom").value)
    };
    if(!Number.isFinite(body.center.longitude)||!Number.isFinite(body.center.latitude)||!Number.isFinite(body.focus_zoom)){
      state.className="lc-zone-state error"; state.textContent="Centre et zoom doivent être renseignés."; return;
    }
    const id=editingZone.id ?? editingZone.slug;
    try{
      let response=await fetch(API+"/api/admin/zones/"+encodeURIComponent(id),authOptions({method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
      if(response.status===405)response=await fetch(API+"/api/admin/zones/"+encodeURIComponent(id),authOptions({method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.error||data?.message||"HTTP "+response.status);
      state.className="lc-zone-state ok"; state.textContent="Zone enregistrée.";
      setTimeout(()=>{closeModal();window.location.reload();},550);
    }catch(error){console.error("Zone update",error);state.className="lc-zone-state error";state.textContent="Échec : "+error.message;}
  }

  function attachButtons(){
    const rows=[...document.querySelectorAll("#zones-list .zone")];
    if(!rows.length||!zones.length)return false;
    rows.forEach((row,index)=>{
      if(row.dataset.lcEditorAttached)return;
      const name=row.querySelector(".zone-name")?.textContent.trim();
      const zone=zones.find(z=>String(z.name||"").trim()===name)||zones[index];
      if(!zone)return;
      row.dataset.lcEditorAttached="1"; row.dataset.zoneId=String(zone.id);
      const actions=document.createElement("div"); actions.className="lc-zone-actions";
      const button=document.createElement("button"); button.className="lc-zone-edit"; button.type="button"; button.textContent="Modifier";
      button.onclick=async()=>{button.disabled=true;try{openModal(await loadZone(zone.id??zone.slug));}catch(e){console.error(e);alert("Impossible de charger cette zone : "+e.message);}finally{button.disabled=false;}};
      actions.appendChild(button); row.appendChild(actions);
      const tag=row.querySelector(".tag"); if(tag)tag.textContent=canonicalCategory(zone.category_slug,zone.category_name);
    });
    return true;
  }

  async function init(){
    try{
      zones=await loadZones();
      const unique=new Map();
      zones.forEach(z=>{const slug=z.category_slug||z.category;if(slug&&!unique.has(slug))unique.set(slug,canonicalCategory(slug,z.category_name));});
      if(unique.size)categories=[...unique.entries()];
      attachButtons();
      let attempts=0;
      const timer=setInterval(()=>{attempts++;if(attachButtons()||attempts>=20)clearInterval(timer);},250);
    }catch(e){console.warn("Éditeur des zones : impossible de charger les zones",e);}
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
