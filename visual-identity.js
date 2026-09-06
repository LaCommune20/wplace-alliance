(() => {
  "use strict";

  const BRAND_MARK = `<span class="lc-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M0 0h32v32H0z" fill="#080808"/><path d="M0 0h32L0 32z" fill="#e10600"/></svg></span>`;
  const ZONES_MARK = `<span class="lc-zones-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></span>`;

  const style = document.createElement("style");
  style.id = "lc-visual-identity-clean";
  style.textContent = `
    #panel{position:absolute!important;top:10px!important;left:10px!important;z-index:1000!important;min-width:270px!important;padding:8px 11px!important;border-radius:11px!important}
    #title{display:flex!important;align-items:center!important;gap:7px!important;font-size:15px!important;line-height:1.15!important;padding-right:58px!important}
    .lc-brand-mark{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#080808;border:1px solid rgba(255,255,255,.12)}
    .lc-brand-mark svg{width:100%;height:100%;display:block}
    .lc-brand-text{display:flex;flex-direction:column;min-width:0;line-height:1.05}
    .lc-brand-name{font-size:15px;font-weight:700;color:#fff;white-space:nowrap}
    .lc-brand-credit{display:block;margin-top:3px;color:#777;font-size:7px;font-weight:400;letter-spacing:.15px;line-height:1}
    #subtitle{margin-top:4px!important;font-size:9px!important}
    #info{margin-top:5px!important;padding-top:5px!important;font-size:8px!important;line-height:1.25!important;max-height:38px;overflow:hidden;opacity:.48}
    #zones-tab{position:absolute!important;top:112px!important;left:10px!important;z-index:1001!important;width:150px!important;padding:7px 10px!important;border-radius:10px!important;display:flex!important;align-items:center!important;gap:6px!important}
    #zones-tab .lc-icon{display:none!important}
    .lc-zones-mark{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:#e10600}
    .lc-zones-mark svg{width:100%;height:100%;display:block}
    #zones-panel{position:absolute!important;top:148px!important;left:10px!important;width:270px!important;z-index:1000!important}
    #lc-admin-link{display:none;position:absolute;top:7px;right:8px;z-index:2;align-items:center;justify-content:center;padding:5px 8px;border:1px solid rgba(225,6,0,.32);border-radius:7px;background:rgba(225,6,0,.08);color:#bbb;text-decoration:none;font-size:8px;font-weight:700;letter-spacing:.2px}
    #lc-admin-link:hover{background:rgba(225,6,0,.16);border-color:rgba(225,6,0,.6);color:#fff}
    @media(max-width:700px){#title{padding-right:52px!important}.lc-brand-name{font-size:14px}#zones-tab{top:106px!important;width:150px!important}#zones-panel{top:142px!important}#lc-admin-link{top:6px;right:7px;padding:5px 7px}}
  `;
  document.head.appendChild(style);

  function applyBranding() {
    const title = document.getElementById("title");
    if (title && !title.dataset.lcBrand) {
      title.dataset.lcBrand = "1";
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
      try {
        const options = typeof authFetchOptions === "function" ? authFetchOptions() : {credentials:"include",cache:"no-store"};
        fetch(AUTH_ME_URL, options).then(r => r.ok ? r.json() : null).then(data => {
          if (["admin","moderator"].includes(data?.access)) link.style.display = "inline-flex";
        }).catch(() => {});
      } catch (_) {}
    }

    const tab = document.getElementById("zones-tab");
    if (tab && !tab.dataset.lcBrand) {
      tab.dataset.lcBrand = "1";
      const text = tab.textContent.trim().replace(/^[◇◈▢□]+\s*/, "");
      tab.innerHTML = `${ZONES_MARK}<span>${text || "ZONES"}</span>`;
    }
  }

  function keepZonesOpenOnMapClicks() {
    const mapElement = document.getElementById("map");
    if (!mapElement || mapElement.dataset.lcStopZoneClose) return;
    mapElement.dataset.lcStopZoneClose = "1";
    mapElement.addEventListener("click", event => {
      event.stopPropagation();
    });
  }

  function installZoneHover() {
    if (typeof map === "undefined" || !map || map.__lcZoneHoverInstalled) return false;
    const fillId = "alliance-zones-fill";
    if (!map.getLayer(fillId)) return false;
    const source = map.getLayer(fillId)?.source;
    if (!source) return false;
    const fillHover = "alliance-zones-hover-fill";
    const lineHover = "alliance-zones-hover-line";
    if (!map.getLayer(fillHover)) map.addLayer({id:fillHover,type:"fill",source,paint:{"fill-color":"#fff","fill-opacity":.16},filter:["==",["get","id"],"__none__"]});
    if (!map.getLayer(lineHover)) map.addLayer({id:lineHover,type:"line",source,paint:{"line-color":"#fff","line-width":5,"line-opacity":1},filter:["==",["get","id"],"__none__"]});
    let hovered = null;
    const clear = () => { if (hovered === null) return; hovered = null; if (map.getLayer(fillHover)) map.setFilter(fillHover,["==",["get","id"],"__none__"]); if (map.getLayer(lineHover)) map.setFilter(lineHover,["==",["get","id"],"__none__"]); map.getCanvas().style.cursor=""; };
    const hover = e => { const id=e.features?.[0]?.properties?.id; if(id==null)return clear(); hovered=String(id); const f=["==",["get","id"],hovered]; if(map.getLayer(fillHover))map.setFilter(fillHover,f); if(map.getLayer(lineHover))map.setFilter(lineHover,f); map.getCanvas().style.cursor="pointer"; };
    map.on("mousemove",fillId,hover); map.on("mouseleave",fillId,clear); map.__lcZoneHoverInstalled=true;
    console.log("Zone hover : effet de survol activé");
    return true;
  }

  function loadTemplateDownload() {
    if (document.querySelector('script[data-lc-template-download="1"]')) return;
    const s=document.createElement("script"); s.src="template-download.js"; s.dataset.lcTemplateDownload="1"; document.body.appendChild(s);
  }

  applyBranding();
  keepZonesOpenOnMapClicks();
  loadTemplateDownload();
  installZoneHover();
  if (typeof map !== "undefined" && map) {
    map.on("idle", installZoneHover);
    map.on("styledata", installZoneHover);
  }
})();
