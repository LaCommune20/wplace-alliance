(() => {
  "use strict";

  const BRAND_MARK = `
    <span class="lc-brand-mark-v2" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="img">
        <path d="M0 0h32v32H0z" fill="#080808"/>
        <path d="M0 0h32L0 32z" fill="#e10600"/>
      </svg>
    </span>`;

  const ZONES_MARK = `
    <span class="lc-zones-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
    </span>`;

  const style = document.createElement("style");
  style.id = "lc-visual-identity-v3";
  style.textContent = `
    .lc-brand-mark-v2{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#080808;border:1px solid rgba(255,255,255,.12)}
    .lc-brand-mark-v2 svg{width:100%;height:100%;display:block}
    #title .lc-brand-mark:not(.lc-brand-mark-v2){display:none!important}
    #panel{min-width:270px!important;padding:8px 11px!important;position:relative!important}
    #title{display:flex!important;align-items:center!important;gap:7px!important;font-size:15px!important;line-height:1.15!important;padding-right:58px!important}
    .lc-brand-text{display:flex;flex-direction:column;min-width:0;line-height:1.05}
    .lc-brand-name{font-size:15px;font-weight:700;color:#fff;white-space:nowrap}
    .lc-brand-credit{display:block;margin-top:3px;color:#777;font-size:7px;font-weight:400;letter-spacing:.15px;line-height:1}
    #subtitle{margin-top:4px!important;font-size:9px!important}
    #info{margin-top:5px!important;padding-top:5px!important;font-size:8px!important;line-height:1.25!important;max-height:38px;overflow:hidden;opacity:.48}
    #zones-tab{top:112px!important;width:150px!important;padding:7px 10px!important;border-radius:10px!important;cursor:pointer!important}
    #zones-tab .lc-icon{display:none!important}
    .lc-zones-mark{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:#e10600}
    .lc-zones-mark svg{width:100%;height:100%;display:block}
    #zones-tab{gap:6px!important}
    #zones-panel{top:148px!important;width:270px!important}
    #lc-admin-link{display:none;position:absolute;top:7px;right:8px;z-index:2;align-items:center;justify-content:center;padding:5px 8px;border:1px solid rgba(225,6,0,.32);border-radius:7px;background:rgba(225,6,0,.08);color:#bbb;text-decoration:none;font-size:8px;font-weight:bold;letter-spacing:.2px}
    #lc-admin-link:hover{background:rgba(225,6,0,.16);border-color:rgba(225,6,0,.6);color:#fff}
    @media(max-width:700px){#title{padding-right:52px!important}.lc-brand-name{font-size:14px}#zones-tab{top:106px!important;width:150px!important}#zones-panel{top:142px!important}#lc-admin-link{top:6px;right:7px;padding:5px 7px}}
  `;
  document.head.appendChild(style);

  async function canAccessAdmin() {
    try {
      const options = typeof authFetchOptions === "function" ? authFetchOptions() : {credentials:"include",cache:"no-store"};
      const response = await fetch(AUTH_ME_URL, options);
      if (!response.ok) return false;
      const data = await response.json();
      return ["admin", "moderator"].includes(data?.access);
    } catch (_) { return false; }
  }

  function apply() {
    const title = document.getElementById("title");
    if (title && !title.dataset.brandV3) {
      title.dataset.brandV3 = "1";
      title.innerHTML = `${BRAND_MARK}<span class="lc-brand-text"><span class="lc-brand-name">WPlace La Commune</span><span class="lc-brand-credit">made by bergamottto</span></span>`;
    }

    const panel = document.getElementById("panel");
    if (panel && !document.getElementById("lc-admin-link")) {
      const link = document.createElement("a");
      link.id = "lc-admin-link";
      link.href = "commune/index.html";
      link.textContent = "Admin";
      link.title = "Administration";
      panel.appendChild(link);
      canAccessAdmin().then(allowed => { if (allowed) link.style.display = "inline-flex"; });
    }

    const tab = document.getElementById("zones-tab");
    if (tab && !tab.dataset.brandV3) {
      tab.dataset.brandV3 = "1";
      const text = tab.textContent.trim().replace(/^\s*[◇◈▢□]+\s*/, "");
      tab.innerHTML = `${ZONES_MARK}<span>${text || "ZONES"}</span>`;
    }
  }

  function installZoneHover() {
    if (typeof map === "undefined" || map === null || !map || map.__lcZoneHoverInstalled) return false;
    const fillId = "alliance-zones-fill";
    if (!map.getLayer(fillId)) return false;
    const fillLayer = map.getLayer(fillId);
    const source = fillLayer && fillLayer.source;
    if (!source) return false;
    const sourceLayer = fillLayer.sourceLayer;
    const hoverFillId = "alliance-zones-hover-fill";
    const hoverLineId = "alliance-zones-hover-line";
    if (!map.getLayer(hoverFillId)) {
      const layer = {id:hoverFillId,type:"fill",source,paint:{"fill-color":"#ffffff","fill-opacity":0.16},filter:["==",["get","id"],"__none__"]};
      if (sourceLayer) layer["source-layer"] = sourceLayer;
      map.addLayer(layer);
    }
    if (!map.getLayer(hoverLineId)) {
      const layer = {id:hoverLineId,type:"line",source,paint:{"line-color":"#ffffff","line-width":5,"line-opacity":1,"line-blur":0},filter:["==",["get","id"],"__none__"]};
      if (sourceLayer) layer["source-layer"] = sourceLayer;
      map.addLayer(layer);
    }
    let hoveredId = null;
    const clearHover = () => {
      if (hoveredId === null) return;
      hoveredId = null;
      if (map.getLayer(hoverFillId)) map.setFilter(hoverFillId,["==",["get","id"],"__none__"]);
      if (map.getLayer(hoverLineId)) map.setFilter(hoverLineId,["==",["get","id"],"__none__"]);
      map.getCanvas().style.cursor = "";
    };
    const setHover = event => {
      const feature = (event.features || [])[0];
      const id = feature && feature.properties && feature.properties.id;
      if (id == null) return clearHover();
      const nextId = String(id);
      if (hoveredId !== nextId) {
        hoveredId = nextId;
        const filter = ["==",["get","id"],hoveredId];
        if (map.getLayer(hoverFillId)) map.setFilter(hoverFillId,filter);
        if (map.getLayer(hoverLineId)) map.setFilter(hoverLineId,filter);
      }
      map.getCanvas().style.cursor = "pointer";
    };
    map.on("mousemove",fillId,setHover);
    map.on("mouseenter",fillId,setHover);
    map.on("mouseleave",fillId,clearHover);
    map.__lcZoneHoverInstalled = true;
    console.log("Zone hover : effet de survol activé");
    return true;
  }

  function loadTemplateDownload() {
    if (document.querySelector('script[data-lc-template-download="1"]')) return;
    const script = document.createElement("script");
    script.src = "template-download.js";
    script.dataset.lcTemplateDownload = "1";
    document.body.appendChild(script);
  }

  apply();
  loadTemplateDownload();
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(apply,100);
  setTimeout(apply,500);
  setTimeout(apply,1500);

  function retryHover() {
    if (installZoneHover()) {
      if (typeof map !== "undefined" && map) {
        try { map.off("styledata",retryHover); } catch (_) {}
        try { map.off("idle",retryHover); } catch (_) {}
      }
      return true;
    }
    return false;
  }
  if (!retryHover() && typeof map !== "undefined" && map) {
    map.on("styledata",retryHover);
    map.on("idle",retryHover);
  }
  setTimeout(retryHover,100);
  setTimeout(retryHover,500);
  setTimeout(retryHover,1500);
  setTimeout(retryHover,3000);
})();
