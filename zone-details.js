(() => {
  "use strict";

  const ZONES_API_URL = "https://wplace-commune-api-dev.mathieu-peter.workers.dev/api/zones";

  function installZoneDetails() {
    if (document.getElementById("zone-details")) return;

    const style = document.createElement("style");
    style.id = "zone-details-style";
    style.textContent = `
      #panel,#zones-tab,#zones-panel,#status,#coordinates{border-radius:3px!important;box-shadow:0 3px 14px rgba(0,0,0,.28)!important;border-color:rgba(255,255,255,.12)!important}
      #panel{background:rgba(12,12,12,.88)!important;padding:12px 14px!important}
      #title{font-size:18px!important}#info{margin-top:9px!important;padding-top:8px!important;line-height:1.55!important}
      #zones-tab{background:rgba(12,12,12,.88)!important;padding:9px 12px!important}
      #zones-panel{background:rgba(12,12,12,.92)!important;padding:12px!important}
      .zone-card,.zone-details-field,.zone-template-card,.future-tab{border-radius:3px!important}
      .zone-focus,.zone-overall button,.zone-template-actions a,.zone-template-actions button,#zone-details-actions button{border-radius:2px!important}
      #zone-details{position:absolute;top:12px;right:15px;z-index:1100;width:320px;max-width:calc(100vw - 30px);max-height:calc(100vh - 30px);overflow-y:auto;padding:14px;border-radius:3px;background:rgba(15,15,15,.96);border:1px solid rgba(255,255,255,.15);box-shadow:0 5px 25px rgba(0,0,0,.5);color:#fff;display:none}
      #zone-details.open{display:block}#zone-details-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px}
      #zone-details-swatch{width:10px;height:10px;margin-top:4px;border-radius:50%;border:1px solid #777;flex:0 0 auto}
      #zone-details-title{flex:1;min-width:0;font-size:15px;font-weight:bold;line-height:1.25}
      #zone-details-close{border:0;background:transparent;color:#888;font-size:20px;line-height:1;padding:0 2px;cursor:pointer}
      #zone-details-close:hover{color:#fff}#zone-details-description{margin-bottom:12px;color:#aaa;font-size:11px;line-height:1.5}
      .zone-details-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.zone-details-field{min-width:0;padding:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
      .zone-details-label{margin-bottom:4px;color:#777;font-size:9px;text-transform:uppercase;letter-spacing:.6px}.zone-details-value{color:#ddd;font-size:11px;line-height:1.3;overflow-wrap:anywhere}
      #zone-details-templates{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}#zone-details-templates-title{margin-bottom:9px;color:#aaa;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.8px}
      #zone-details-templates-list{display:flex;flex-direction:column;gap:7px}.zone-template-card{padding:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
      .zone-template-name{color:#ddd;font-size:11px;font-weight:bold;line-height:1.3}.zone-template-description{margin-top:4px;color:#888;font-size:10px;line-height:1.4}.zone-template-meta{margin-top:6px;color:#666;font:9px Consolas,monospace}
      .zone-template-actions{display:flex;gap:6px;margin-top:8px}.zone-template-actions a,.zone-template-actions button{flex:1;min-width:0;border:1px solid rgba(255,255,255,.12);background:#202020;color:#ccc;padding:7px 6px;cursor:pointer;font-size:9px;text-align:center;text-decoration:none}
      .zone-template-actions a:hover,.zone-template-actions button:hover:not(:disabled){background:#2b2b2b;color:#fff}.zone-template-actions button:disabled{color:#666;cursor:not-allowed;opacity:.7}.zone-templates-message{color:#777;font-size:10px;line-height:1.4}
      #zone-details-actions{display:flex;gap:7px;margin-top:12px}#zone-details-actions button{flex:1;border:1px solid rgba(255,255,255,.12);background:#202020;color:#ccc;padding:8px;cursor:pointer;font-size:10px}
      #zone-details-actions button:hover{background:#2b2b2b;color:#fff}@media(max-width:700px){#zone-details{top:auto;right:15px;bottom:55px;width:min(320px,calc(100vw - 30px));max-height:calc(100vh - 70px)}}
    `;
    document.head.appendChild(style);

    const panel = document.createElement("aside");
    panel.id = "zone-details";
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <div id="zone-details-head"><span id="zone-details-swatch"></span><div id="zone-details-title"></div><button id="zone-details-close" type="button" aria-label="Fermer">×</button></div>
      <div id="zone-details-description"></div>
      <div class="zone-details-grid">
        <div class="zone-details-field"><div class="zone-details-label">Catégorie</div><div class="zone-details-value" id="zone-details-category">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Statut</div><div class="zone-details-value" id="zone-details-status">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Propriétaire</div><div class="zone-details-value" id="zone-details-owner">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Localisation</div><div class="zone-details-value" id="zone-details-location">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Version</div><div class="zone-details-value" id="zone-details-version">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Périmètre</div><div class="zone-details-value" id="zone-details-perimeter">—</div></div>
        <div class="zone-details-field" style="grid-column:1/-1"><div class="zone-details-label">Dernière modification</div><div class="zone-details-value" id="zone-details-updated">—</div></div>
      </div>
      <div id="zone-details-templates"><div id="zone-details-templates-title">Templates</div><div id="zone-details-templates-list"><div class="zone-templates-message">Chargement...</div></div></div>
      <div id="zone-details-actions"><button id="zone-details-center" type="button">CENTRER LA ZONE</button></div>`;
    document.body.appendChild(panel);

    let templatesRequestToken = 0;
    const categoryName = z => z.type === "commune" ? "La Commune" : z.type === "sympathisant" ? "Allié sympathisant" : z.type === "allie-neutre" ? "Allié neutre" : z.type || "—";
    const statusName = s => !s || s === "active" ? "Active" : s === "archived" ? "Archivée" : s;
    const ownerName = z => !z.owner_name ? "Non renseigné" : z.owner_public === false ? "Propriétaire privé" : z.owner_name;
    function updatedName(v){if(!v)return "Non renseignée";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"})}
    function isAllowedWPlaceUrl(v){if(!v)return false;try{const u=new URL(v);return u.protocol==="https:"&&(u.hostname==="wplace.live"||u.hostname.endsWith(".wplace.live"))}catch(e){return false}}

    function renderTemplates(templates){
      const list=document.getElementById("zone-details-templates-list");if(!list)return;list.innerHTML="";
      if(!Array.isArray(templates)||!templates.length){const m=document.createElement("div");m.className="zone-templates-message";m.textContent="Aucun template actif pour cette zone.";list.appendChild(m);return}
      templates.forEach(t=>{const card=document.createElement("div");card.className="zone-template-card";const n=document.createElement("div");n.className="zone-template-name";n.textContent=t.name||t.slug||"Template";card.appendChild(n);if(t.description){const d=document.createElement("div");d.className="zone-template-description";d.textContent=t.description;card.appendChild(d)}const meta=document.createElement("div");meta.className="zone-template-meta";meta.textContent="Version "+(t.version!=null?t.version:"—")+" · Actif";card.appendChild(meta);const actions=document.createElement("div");actions.className="zone-template-actions";const dl=document.createElement("button");dl.type="button";dl.disabled=true;dl.textContent="Télécharger";dl.title="Le téléchargement sera disponible après l'activation de R2.";actions.appendChild(dl);if(isAllowedWPlaceUrl(t.wplace_url)){const a=document.createElement("a");a.href=t.wplace_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Ouvrir WPlace";actions.appendChild(a)}card.appendChild(actions);list.appendChild(card)})
    }
    async function loadTemplates(zone){const list=document.getElementById("zone-details-templates-list");if(!list||!zone)return;const token=++templatesRequestToken;list.innerHTML="";const loading=document.createElement("div");loading.className="zone-templates-message";loading.textContent="Chargement...";list.appendChild(loading);const id=zone.slug||zone.id;if(!id){renderTemplates([]);return}try{const opts=typeof authFetchOptions==="function"?authFetchOptions():{credentials:"include",cache:"no-store"};const r=await fetch(ZONES_API_URL+"/"+encodeURIComponent(id)+"/templates",opts);if(!r.ok)throw new Error("HTTP "+r.status);const t=await r.json();if(token!==templatesRequestToken)return;renderTemplates(t)}catch(e){console.error("Erreur lors du chargement des templates:",e);if(token!==templatesRequestToken)return;list.innerHTML="";const m=document.createElement("div");m.className="zone-templates-message";m.textContent="Impossible de charger les templates.";list.appendChild(m)}}

    function showZoneDetails(zone){
      if(!zone)return;document.getElementById("zone-details-title").textContent=zone.name||"Zone";document.getElementById("zone-details-description").textContent=zone.description||"Aucune description.";document.getElementById("zone-details-category").textContent=categoryName(zone);document.getElementById("zone-details-status").textContent=statusName(zone.status);document.getElementById("zone-details-owner").textContent=ownerName(zone);document.getElementById("zone-details-location").textContent=[zone.country,zone.continent].filter(Boolean).join(" · ")||"—";document.getElementById("zone-details-version").textContent=zone.version!=null?"v"+zone.version:"—";document.getElementById("zone-details-perimeter").textContent=(zone.points?zone.points.length:0)+" points";document.getElementById("zone-details-updated").textContent=updatedName(zone.updated_at);const sw=document.getElementById("zone-details-swatch");sw.style.background=typeof zoneColor==="function"?zoneColor(zone):"#888";sw.style.borderColor=zone.type==="allie-neutre"?"#777":sw.style.background;panel.classList.add("open");panel.setAttribute("aria-hidden","false");panel.dataset.zoneId=zone.id||"";loadTemplates(zone)
    }
    function closeZoneDetails(){templatesRequestToken++;panel.classList.remove("open");panel.setAttribute("aria-hidden","true");delete panel.dataset.zoneId}
    document.getElementById("zone-details-close").addEventListener("click",closeZoneDetails);
    document.getElementById("zone-details-center").addEventListener("click",()=>{const z=Array.isArray(ALLIANCE_ZONES)?ALLIANCE_ZONES.find(x=>x.id===panel.dataset.zoneId):null;if(z&&typeof map!=="undefined")map.flyTo({center:z.center,zoom:z.zoom,duration:700})});
    window.showZoneDetails=showZoneDetails;window.closeZoneDetails=closeZoneDetails;

    function bindZoneCards(){document.querySelectorAll("#zones-list .zone-card").forEach(card=>{if(card.dataset.detailsBound==="true")return;const name=card.querySelector(".zone-name");if(!name)return;const z=Array.isArray(ALLIANCE_ZONES)?ALLIANCE_ZONES.find(x=>x.name===name.textContent):null;if(!z)return;name.style.cursor="pointer";name.title="Afficher les détails";name.addEventListener("click",()=>showZoneDetails(z));card.dataset.detailsBound="true"})}
    const observer=new MutationObserver(bindZoneCards),list=document.getElementById("zones-list");if(list)observer.observe(list,{childList:true,subtree:true});bindZoneCards();

    let mapEventsBound=false;
    function bindMapEvents(){
      if(mapEventsBound||typeof map==="undefined")return false;
      const layers=["alliance-zones-fill","alliance-zones-line","alliance-zones-casing"].filter(id=>map.getLayer(id));
      if(!layers.length)return false;
      const handle=event=>{const feature=event.features&&event.features[0];if(!feature)return;const id=feature.properties&&feature.properties.id;const zone=Array.isArray(ALLIANCE_ZONES)?ALLIANCE_ZONES.find(x=>x.id===id):null;if(zone)showZoneDetails(zone)};
      layers.forEach(id=>map.on("click",id,handle));
      const fill=map.getLayer("alliance-zones-fill");if(fill){map.on("mouseenter","alliance-zones-fill",()=>map.getCanvas().style.cursor="pointer");map.on("mouseleave","alliance-zones-fill",()=>map.getCanvas().style.cursor="")}
      mapEventsBound=true;console.log("Zone details : clics carte activés",layers);return true;
    }
    if(typeof map!=="undefined"){
      if(!bindMapEvents()){
        const retry=()=>{if(bindMapEvents()){map.off("styledata",retry);map.off("idle",retry)}};
        map.on("styledata",retry);map.on("idle",retry);
        setTimeout(bindMapEvents,0);setTimeout(bindMapEvents,100);setTimeout(bindMapEvents,500);
      }
    }
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installZoneDetails,{once:true});else installZoneDetails();
})();
