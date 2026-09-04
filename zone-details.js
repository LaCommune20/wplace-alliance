(() => {
  "use strict";

  const ZONES_API_URL = "https://wplace-commune-api-dev.mathieu-peter.workers.dev/api/zones";

  function installZoneDetails() {
    if (document.getElementById("zone-details")) return;

    const style = document.createElement("style");
    style.id = "zone-details-style";
    style.textContent = `
      #panel,#zones-tab,#zones-panel,#status,#coordinates{border-radius:4px!important;box-shadow:0 4px 18px rgba(0,0,0,.30)!important;border-color:rgba(255,255,255,.12)!important}
      #panel{top:10px!important;left:10px!important;min-width:270px!important;padding:11px 13px!important;background:rgba(15,15,15,.88)!important}
      #title{font-size:17px!important;line-height:1.2!important}#subtitle{margin-top:3px!important;font-size:11px!important}
      #info{margin-top:8px!important;padding-top:7px!important;line-height:1.5!important;font-size:10px!important}
      #zones-tab{top:150px!important;left:10px!important;width:270px!important;padding:8px 11px!important;background:rgba(15,15,15,.88)!important;color:#ddd!important;font-size:11px!important}
      #zones-panel{top:187px!important;left:10px!important;width:270px!important;max-height:calc(100vh - 205px)!important;padding:10px!important;background:rgba(15,15,15,.92)!important}
      .panel-section-title{font-size:10px!important;margin-bottom:8px!important;letter-spacing:.7px!important}.zone-card{gap:8px!important;padding:8px!important;margin-bottom:5px!important;border-radius:4px!important;background:rgba(255,255,255,.035)!important}
      .zone-name{font-size:12px!important}.zone-meta{font-size:9px!important;margin-top:2px!important}.zone-focus{padding:4px 6px!important;font-size:9px!important;border-radius:3px!important}
      .zone-group-continent{margin-top:11px!important;font-size:10px!important;padding-bottom:4px!important}.zone-group-country{margin:6px 2px 5px!important;font-size:9px!important}.zone-legend{gap:5px 8px!important;margin-bottom:8px!important;font-size:8px!important}
      .zone-overall{gap:4px!important;margin-bottom:8px!important}.zone-overall button{padding:4px 6px!important;font-size:8px!important;border-radius:3px!important}
      #zone-filter-row{gap:7px!important;margin:9px 0 8px!important;padding:8px!important;border-radius:4px!important}#zone-filter-label{font-size:10px!important}
      #zone-info{font-size:9px!important;padding-top:8px!important}.future-tab{margin-top:5px!important;padding:7px 8px!important;border-radius:4px!important;font-size:9px!important}
      #status,#coordinates{bottom:10px!important;padding:6px 9px!important;border-radius:4px!important;font-size:10px!important}#status{left:10px!important}#coordinates{right:10px!important}
      #zone-details{position:absolute;top:10px;right:10px;z-index:1100;width:300px;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);overflow-y:auto;padding:12px;border-radius:4px;background:rgba(15,15,15,.94);border:1px solid rgba(255,255,255,.14);box-shadow:0 5px 20px rgba(0,0,0,.42);color:#fff;display:none;scrollbar-width:thin}
      #zone-details.open{display:block}#zone-details-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}#zone-details-swatch{width:9px;height:9px;border-radius:50%;border:1px solid #777;flex:0 0 auto}
      #zone-details-title{flex:1;min-width:0;font-size:14px;font-weight:700;line-height:1.25}#zone-details-close{width:24px;height:24px;border:0;background:transparent;color:#888;font-size:19px;line-height:20px;padding:0;cursor:pointer;border-radius:3px}
      #zone-details-close:hover{background:rgba(255,255,255,.07);color:#fff}#zone-details-description{margin:0 0 9px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08);color:#999;font-size:10px;line-height:1.4}
      .zone-details-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}.zone-details-field{min-width:0;padding:7px 0;background:transparent!important;border:0!important;border-bottom:1px solid rgba(255,255,255,.06)!important;border-radius:0!important}
      .zone-details-label{margin-bottom:3px;color:#666;font-size:8px;text-transform:uppercase;letter-spacing:.65px}.zone-details-value{color:#ddd;font-size:10px;line-height:1.25;overflow-wrap:anywhere}.zone-details-field[style*="grid-column"]{grid-column:1/-1}
      #zone-details-templates{margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}#zone-details-templates-title{display:flex;align-items:center;margin-bottom:6px;color:#aaa;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.75px}
      #zone-details-templates-list{display:flex;flex-direction:column;gap:5px}.zone-template-card{padding:7px 8px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:3px!important}
      .zone-template-name{color:#ddd;font-size:10px;font-weight:700;line-height:1.25}.zone-template-description{margin-top:3px;color:#888;font-size:9px;line-height:1.3}.zone-template-meta{margin-top:4px;color:#666;font:8px Consolas,monospace}
      .zone-template-actions{display:flex;gap:5px;margin-top:6px}.zone-template-actions a,.zone-template-actions button{flex:1;min-width:0;border:1px solid rgba(255,255,255,.11);background:#1d1d1d;color:#bbb;padding:5px 6px;cursor:pointer;font-size:8px;text-align:center;text-decoration:none;border-radius:3px!important}
      .zone-template-actions a:hover,.zone-template-actions button:hover:not(:disabled){background:#292929;color:#fff}.zone-template-actions button:disabled{color:#555;cursor:not-allowed;opacity:.7}.zone-templates-message{color:#777;font-size:9px;line-height:1.35}
      #zone-details-actions{display:flex;gap:5px;margin-top:8px}#zone-details-actions button{flex:1;border:1px solid rgba(255,255,255,.12);background:#202020;color:#ccc;padding:6px 8px;cursor:pointer;font-size:9px;border-radius:3px!important}#zone-details-actions button:hover{background:#2b2b2b;color:#fff}
      @media(max-width:700px){#panel{left:8px!important;top:8px!important;min-width:240px!important;max-width:calc(100vw - 16px)}#zones-tab{left:8px!important;top:138px!important;width:240px!important}#zones-panel{left:8px!important;top:173px!important;width:min(310px,calc(100vw - 16px))!important;max-height:calc(100vh - 190px)!important}#zone-details{top:auto;right:8px;bottom:45px;width:min(310px,calc(100vw - 16px));max-height:calc(100vh - 55px)}}
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
      <div id="zone-details-actions"><button id="zone-details-center" type="button">⌖ &nbsp;Centrer la zone</button></div>`;
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
      templates.forEach(t=>{const card=document.createElement("div");card.className="zone-template-card";const n=document.createElement("div");n.className="zone-template-name";n.textContent=t.name||t.slug||"Template";card.appendChild(n);if(t.description){const d=document.createElement("div");d.className="zone-template-description";d.textContent=t.description;card.appendChild(d)}const meta=document.createElement("div");meta.className="zone-template-meta";meta.textContent="Version "+(t.version!=null?t.version:"—")+" · Actif";card.appendChild(meta);const actions=document.createElement("div");actions.className="zone-template-actions";const dl=document.createElement("button");dl.type="button";dl.disabled=true;dl.textContent="↓  Télécharger";dl.title="Le téléchargement sera disponible après l'activation de R2.";actions.appendChild(dl);if(isAllowedWPlaceUrl(t.wplace_url)){const a=document.createElement("a");a.href=t.wplace_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="↗  Ouvrir WPlace";actions.appendChild(a)}card.appendChild(actions);list.appendChild(card)})
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