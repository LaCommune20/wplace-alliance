(() => {
  "use strict";

  const ZONES_API_URL = "https://wplace-commune-api-dev.mathieu-peter.workers.dev/api/zones";

  const ICONS = {
    commune: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h5v5H6zM13 5h5v5h-5zM6 12h5v5H6zM13 12h5v7h-5z"/></svg>',
    allie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 8.5 6.2 6.2a3 3 0 0 0-4.2 4.2l4.5 4.5a3 3 0 0 0 4.2 0l1.4-1.4-2.1-2.1-1.4 1.4a.1.1 0 0 1-.1 0L4.1 8.3a.1.1 0 1 1 .1-.1l2.3 2.3 2-2Zm7-1 1.4-1.4a.1.1 0 0 1 .1 0l4.4 4.4a.1.1 0 0 1 0 .1l-4.4 4.4a.1.1 0 0 1-.1 0l-1.4-1.4-2.1 2.1 1.4 1.4a3 3 0 0 0 4.2 0l4.4-4.4a3 3 0 0 0 0-4.2l-4.4-4.4a3 3 0 0 0-4.2 0l-1.4 1.4 2.1 2Z"/></svg>',
    neutre: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
    all: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
    zones: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 5v8l-8 5-8-5V8l8-5Zm0 2.3L6 9v6l6 3.7 6-3.7V9l-6-3.7Z"/></svg>',
    center: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function icon(name, className="") {
    return `<span class="lc-icon ${className}">${ICONS[name] || ICONS.all}</span>`;
  }

  function decorateInterface() {
    const panelTitle = document.getElementById("title");
    if (panelTitle && !panelTitle.querySelector(".lc-brand-mark")) {
      panelTitle.insertAdjacentHTML("afterbegin", `<span class="lc-brand-mark">${ICONS.commune}</span>`);
    }

    const zonesTab = document.getElementById("zones-tab");
    if (zonesTab && !zonesTab.dataset.iconReady) {
      zonesTab.dataset.iconReady = "true";
      const sync = () => {
        const label = zonesTab.textContent.trim();
        zonesTab.innerHTML = `${icon("zones")}<span>${label}</span>`;
      };
      const original = zonesTab.onclick;
      zonesTab.onclick = event => { if (typeof original === "function") original.call(zonesTab, event); sync(); };
      sync();
    }

    document.querySelectorAll("#zone-overall-filter button").forEach(btn => {
      if (btn.dataset.iconReady) return;
      btn.dataset.iconReady = "true";
      const type = btn.dataset.type === "commune" ? "commune" : btn.dataset.type === "neutre" ? "neutre" : btn.dataset.type === "allie" ? "allie" : "all";
      btn.innerHTML = `${icon(type)}<span>${btn.textContent.trim()}</span>`;
    });

    document.querySelectorAll(".zone-legend span").forEach(item => {
      if (item.dataset.iconReady) return;
      item.dataset.iconReady = "true";
      const text = item.textContent.trim();
      const type = text === "La Commune" ? "commune" : text === "Allié" ? "allie" : "neutre";
      const dot = item.querySelector("i");
      if (dot) dot.replaceWith(document.createRange().createContextualFragment(icon(type)));
    });

    document.querySelectorAll("#zones-list .zone-card").forEach(card => {
      if (card.dataset.iconReady) return;
      card.dataset.iconReady = "true";
      const focus = card.querySelector(".zone-focus");
      if (focus) focus.innerHTML = `${icon("center")}<span>Centrer</span>`;
    });
  }

  function installZoneDetails() {
    if (document.getElementById("zone-details")) return;

    const style = document.createElement("style");
    style.id = "zone-details-style";
    style.textContent = `
      #panel,#zones-tab,#zones-panel,#status,#coordinates{border-radius:11px!important;box-shadow:0 3px 14px rgba(0,0,0,.30)!important;border-color:rgba(255,255,255,.12)!important}
      #panel{top:10px!important;left:10px!important;min-width:270px!important;padding:10px 12px!important;background:rgba(15,15,15,.88)!important}
      #title{font-size:16px!important;line-height:1.2!important;display:flex!important;align-items:center!important;gap:7px!important}#subtitle{margin-top:3px!important;color:#999!important;font-size:10px!important}
      #info{margin-top:7px!important;padding-top:6px!important;line-height:1.35!important;font-size:9px!important;color:#888!important}
      .lc-brand-mark{width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(229,57,53,.13);color:#e53935;flex:0 0 auto}.lc-brand-mark svg{width:14px;height:14px;fill:currentColor}
      .lc-icon{width:13px;height:13px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}.lc-icon svg{width:100%;height:100%;display:block;fill:currentColor}.lc-icon+span{min-width:0}
      #zones-tab{top:139px!important;left:10px!important;width:270px!important;padding:7px 10px!important;background:rgba(15,15,15,.88)!important;color:#ccc!important;font-size:10px!important;display:flex!important;align-items:center!important;gap:7px!important}
      #zones-panel{top:173px!important;left:10px!important;width:270px!important;max-height:calc(100vh - 191px)!important;padding:9px!important;background:rgba(15,15,15,.93)!important}
      .panel-section-title{font-size:9px!important;margin-bottom:7px!important;letter-spacing:.8px!important;color:#aaa!important}
      #zone-filter-row{gap:6px!important;margin:7px 0 7px!important;padding:7px!important;border-radius:9px!important;background:rgba(230,200,79,.045)!important;border-color:rgba(230,200,79,.12)!important}
      #zone-filter-row input{margin:0!important}
      #zone-filter-label{font-size:9px!important;line-height:1.3!important;color:#aaa!important}
      .zone-legend{gap:4px 8px!important;margin:0 1px 7px!important;padding:0!important;font-size:8px!important;color:#777!important}
      .zone-legend span{gap:4px!important;display:inline-flex!important;align-items:center!important}.zone-legend .lc-icon{width:8px!important;height:8px!important}
      .zone-overall{gap:3px!important;margin:0 0 7px!important}
      .zone-overall button{padding:4px 7px!important;border-radius:8px!important;font-size:8px!important;background:#1b1b1b!important;color:#888!important;display:inline-flex!important;align-items:center!important;gap:4px!important}
      .zone-overall button .lc-icon{width:10px!important;height:10px!important}.zone-overall button.active{background:rgba(230,200,79,.10)!important;border-color:rgba(230,200,79,.38)!important;color:#eee!important}
      .zone-group-continent{margin:10px 1px 4px!important;padding-bottom:4px!important;font-size:9px!important;letter-spacing:1px!important}
      .zone-group-country{margin:5px 1px 4px!important;font-size:8px!important;letter-spacing:.8px!important}
      .zone-card{gap:7px!important;padding:7px!important;margin-bottom:4px!important;border-radius:9px!important;background:rgba(255,255,255,.028)!important;border-color:rgba(255,255,255,.07)!important}
      .zone-card:hover{background:rgba(255,255,255,.055)!important}
      .zone-swatch{width:8px!important;height:8px!important}.zone-check{width:14px!important;height:14px!important}
      .zone-name{font-size:11px!important;line-height:1.2!important}.zone-meta{margin-top:2px!important;font-size:8px!important;color:#777!important}
      .zone-focus{padding:4px 7px!important;border-radius:8px!important;font-size:8px!important;background:#1b1b1b!important;color:#aaa!important;display:inline-flex!important;align-items:center!important;gap:4px!important}
      .zone-focus .lc-icon{width:10px!important;height:10px!important}
      #zone-info{margin-top:7px!important;padding-top:7px!important;font-size:8px!important;line-height:1.4!important;color:#666!important}
      .future-tab{margin-top:4px!important;padding:6px 7px!important;border-radius:9px!important;font-size:8px!important;background:rgba(255,255,255,.018)!important;color:#555!important}
      #status,#coordinates{bottom:9px!important;padding:5px 8px!important;border-radius:8px!important;font-size:9px!important}#status{left:9px!important}#coordinates{right:9px!important}
      #zone-details{position:absolute;top:10px;right:10px;z-index:1100;width:300px;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);overflow-y:auto;padding:11px 12px;border-radius:12px;background:rgba(15,15,15,.95);border:1px solid rgba(255,255,255,.13);box-shadow:0 4px 18px rgba(0,0,0,.42);color:#fff;display:none;scrollbar-width:thin}
      #zone-details.open{display:block}#zone-details-head{display:flex;align-items:center;gap:8px;margin-bottom:7px}
      #zone-details-swatch{width:9px;height:9px;border-radius:50%;border:1px solid #777;flex:0 0 auto}#zone-details-title{flex:1;min-width:0;font-size:14px;font-weight:700;line-height:1.2}
      #zone-details-close{width:22px;height:22px;border:0;background:transparent;color:#777;font-size:18px;line-height:20px;padding:0;cursor:pointer;border-radius:8px;display:inline-flex;align-items:center;justify-content:center}#zone-details-close:hover{background:rgba(255,255,255,.06);color:#fff}#zone-details-close .lc-icon{width:14px;height:14px}
      #zone-details-description{margin:0 0 7px;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,.07);color:#888;font-size:9px;line-height:1.35}
      .zone-details-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.zone-details-field{min-width:0;padding:6px 0;background:transparent!important;border:0!important;border-bottom:1px solid rgba(255,255,255,.055)!important;border-radius:0!important}
      .zone-details-label{margin-bottom:2px;color:#5f5f5f;font-size:7px;text-transform:uppercase;letter-spacing:.65px}.zone-details-value{color:#d4d4d4;font-size:9px;line-height:1.2;overflow-wrap:anywhere}.zone-details-field[style*="grid-column"]{grid-column:1/-1}
      #zone-details-templates{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.07)}#zone-details-templates-title{margin-bottom:5px;color:#999;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.8px}
      #zone-details-templates-list{display:flex;flex-direction:column;gap:4px}.zone-template-card{padding:6px 7px;background:rgba(255,255,255,.028);border:1px solid rgba(255,255,255,.065);border-radius:8px!important}
      .zone-template-name{color:#d5d5d5;font-size:9px;font-weight:700;line-height:1.2}.zone-template-description{margin-top:2px;color:#777;font-size:8px;line-height:1.25}.zone-template-meta{margin-top:3px;color:#5d5d5d;font:7px Consolas,monospace}
      .zone-template-actions{display:flex;gap:4px;margin-top:5px}.zone-template-actions a,.zone-template-actions button{flex:1;min-width:0;border:1px solid rgba(255,255,255,.10);background:#1b1b1b;color:#aaa;padding:5px 5px;cursor:pointer;font-size:8px;text-align:center;text-decoration:none;border-radius:8px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:4px!important}.zone-template-actions .lc-icon{width:10px!important;height:10px!important}
      .zone-template-actions a:hover,.zone-template-actions button:hover:not(:disabled){background:#282828;color:#fff}.zone-template-actions button:disabled{color:#4f4f4f;cursor:not-allowed;opacity:.7}.zone-templates-message{color:#666;font-size:8px;line-height:1.3}
      #zone-details-actions{display:flex;gap:4px;margin-top:7px}#zone-details-actions button{flex:1;border:1px solid rgba(255,255,255,.10);background:#1d1d1d;color:#bbb;padding:6px 7px;cursor:pointer;font-size:8px;border-radius:8px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important}#zone-details-actions button:hover{background:#292929;color:#fff}#zone-details-actions .lc-icon{width:11px;height:11px}
      @media(max-width:700px){#panel{left:8px!important;top:8px!important;min-width:235px!important;max-width:calc(100vw - 16px)}#zones-tab{left:8px!important;top:130px!important;width:235px!important}#zones-panel{left:8px!important;top:163px!important;width:min(310px,calc(100vw - 16px))!important;max-height:calc(100vh - 180px)!important}#zone-details{top:auto;right:8px;bottom:45px;width:min(310px,calc(100vw - 16px));max-height:calc(100vh - 55px)}}
    `;
    document.head.appendChild(style);

    const panel = document.createElement("aside");panel.id = "zone-details";panel.setAttribute("aria-hidden", "true");panel.innerHTML = `
      <div id="zone-details-head"><span id="zone-details-swatch"></span><div id="zone-details-title"></div><button id="zone-details-close" type="button" aria-label="Fermer">${icon("close")}</button></div>
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
      <div id="zone-details-actions"><button id="zone-details-center" type="button">${icon("center")}<span>Centrer la zone</span></button></div>`;
    document.body.appendChild(panel);

    let templatesRequestToken = 0;
    const categoryName = z => { const t=z.type; return t === "commune" ? "La Commune" : t === "allie" || t === "sympathisant" ? "Allié" : t === "neutre" || t === "allie-neutre" ? "Neutre" : t || "—"; };
    const statusName = s => !s || s === "active" ? "Active" : s === "archived" ? "Archivée" : s;
    const ownerName = z => !z.owner_name ? "Non renseigné" : z.owner_public === false ? "Propriétaire privé" : z.owner_name;
    function updatedName(v){if(!v)return "Non renseignée";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"})}
    function isAllowedWPlaceUrl(v){if(!v)return false;try{const u=new URL(v);return u.protocol==="https:"&&(u.hostname==="wplace.live"||u.hostname.endsWith(".wplace.live"))}catch(e){return false}}

    function renderTemplates(templates){const list=document.getElementById("zone-details-templates-list");if(!list)return;list.innerHTML="";if(!Array.isArray(templates)||!templates.length){const m=document.createElement("div");m.className="zone-templates-message";m.textContent="Aucun template actif pour cette zone.";list.appendChild(m);return}templates.forEach(t=>{const card=document.createElement("div");card.className="zone-template-card";const n=document.createElement("div");n.className="zone-template-name";n.textContent=t.name||t.slug||"Template";card.appendChild(n);if(t.description){const d=document.createElement("div");d.className="zone-template-description";d.textContent=t.description;card.appendChild(d)}const meta=document.createElement("div");meta.className="zone-template-meta";meta.textContent="Version "+(t.version!=null?t.version:"—")+" · Actif";card.appendChild(meta);const actions=document.createElement("div");actions.className="zone-template-actions";const dl=document.createElement("button");dl.type="button";dl.disabled=true;dl.innerHTML=`${icon("download")}<span>Télécharger</span>`;dl.title="Le téléchargement sera disponible après l'activation de R2.";actions.appendChild(dl);if(isAllowedWPlaceUrl(t.wplace_url)){const a=document.createElement("a");a.href=t.wplace_url;a.target="_blank";a.rel="noopener noreferrer";a.innerHTML=`${icon("external")}<span>Ouvrir WPlace</span>`;actions.appendChild(a)}card.appendChild(actions);list.appendChild(card)})}
    async function loadTemplates(zone){const list=document.getElementById("zone-details-templates-list");if(!list||!zone)return;const token=++templatesRequestToken;list.innerHTML="";const loading=document.createElement("div");loading.className="zone-templates-message";loading.textContent="Chargement...";list.appendChild(loading);const id=zone.slug||zone.id;if(!id){renderTemplates([]);return}try{const opts=typeof authFetchOptions==="function"?authFetchOptions():{credentials:"include",cache:"no-store"};const r=await fetch(ZONES_API_URL+"/"+encodeURIComponent(id)+"/templates",opts);if(!r.ok)throw new Error("HTTP "+r.status);const t=await r.json();if(token!==templatesRequestToken)return;renderTemplates(t)}catch(e){console.error("Erreur lors du chargement des templates:",e);if(token!==templatesRequestToken)return;list.innerHTML="";const m=document.createElement("div");m.className="zone-templates-message";m.textContent="Impossible de charger les templates.";list.appendChild(m)}}
    function showZoneDetails(zone){if(!zone)return;document.getElementById("zone-details-title").textContent=zone.name||"Zone";document.getElementById("zone-details-description").textContent=zone.description||"Aucune description.";document.getElementById("zone-details-category").textContent=categoryName(zone);document.getElementById("zone-details-status").textContent=statusName(zone.status);document.getElementById("zone-details-owner").textContent=ownerName(zone);document.getElementById("zone-details-location").textContent=[zone.country,zone.continent].filter(Boolean).join(" · ")||"—";document.getElementById("zone-details-version").textContent=zone.version!=null?"v"+zone.version:"—";document.getElementById("zone-details-perimeter").textContent=(zone.points?zone.points.length:0)+" points";document.getElementById("zone-details-updated").textContent=updatedName(zone.updated_at);const sw=document.getElementById("zone-details-swatch");sw.style.background=typeof zoneColor==="function"?zoneColor(zone):"#888";sw.style.borderColor=(zone.type==="neutre"||zone.type==="allie-neutre")?"#777":sw.style.background;panel.classList.add("open");panel.setAttribute("aria-hidden","false");panel.dataset.zoneId=zone.id||"";loadTemplates(zone)}
    function closeZoneDetails(){templatesRequestToken++;panel.classList.remove("open");panel.setAttribute("aria-hidden","true");delete panel.dataset.zoneId}
    document.getElementById("zone-details-close").addEventListener("click",closeZoneDetails);
    document.getElementById("zone-details-center").addEventListener("click",()=>{const z=Array.isArray(ALLIANCE_ZONES)?ALLIANCE_ZONES.find(x=>x.id===panel.dataset.zoneId):null;if(z&&typeof map!=="undefined")map.flyTo({center:z.center,zoom:z.zoom,duration:700})});
    window.showZoneDetails=showZoneDetails;window.closeZoneDetails=closeZoneDetails;
    function bindZoneCards(){document.querySelectorAll("#zones-list .zone-card").forEach(card=>{if(card.dataset.detailsBound==="true")return;const name=card.querySelector(".zone-name");if(!name)return;const z=Array.isArray(ALLIANCE_ZONES)?ALLIANCE_ZONES.find(x=>x.name===name.textContent):null;if(!z)return;name.style.cursor="pointer";name.title="Afficher les détails";name.addEventListener("click",()=>showZoneDetails(z));card.dataset.detailsBound="true"});decorateInterface()}
    const observer=new MutationObserver(bindZoneCards),list=document.getElementById("zones-list");if(list)observer.observe(list,{childList:true,subtree:true});bindZoneCards();
    let mapEventsBound=false;
    function bindMapEvents(){if(mapEventsBound||typeof map==="undefined")return false;const layers=["alliance-zones-fill","alliance-zones-line","alliance-zones-casing"].filter(id=>map.getLayer(id));if(!layers.length)return false;const handle=event=>{const feature=event.features&&event.features[0];if(!feature)return;const id=feature.properties&&feature.properties.id;const zone=Array.isArray(ALLIANCE_ZONES)?ALLIANCE_ZONES.find(x=>x.id===id):null;if(zone)showZoneDetails(zone)};layers.forEach(id=>map.on("click",id,handle));const fill=map.getLayer("alliance-zones-fill");if(fill){map.on("mouseenter","alliance-zones-fill",()=>map.getCanvas().style.cursor="pointer");map.on("mouseleave","alliance-zones-fill",()=>map.getCanvas().style.cursor="")}mapEventsBound=true;console.log("Zone details : clics carte activés",layers);return true}
    if(typeof map!=="undefined"){if(!bindMapEvents()){const retry=()=>{if(bindMapEvents()){map.off("styledata",retry);map.off("idle",retry)}};map.on("styledata",retry);map.on("idle",retry);setTimeout(bindMapEvents,0);setTimeout(bindMapEvents,100);setTimeout(bindMapEvents,500)}}
    decorateInterface();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installZoneDetails,{once:true});else installZoneDetails();
})();
