(() => {
  "use strict";

  // Marque rouge/noir volontairement simple : pas de "D", pas d'emoji,
  // et une diagonale qui reprend directement la DA du projet.
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
  style.id = "lc-visual-identity-v2";
  style.textContent = `
    .lc-brand-mark-v2{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#080808;border:1px solid rgba(255,255,255,.12)}
    .lc-brand-mark-v2 svg{width:100%;height:100%;display:block}
    #title .lc-brand-mark:not(.lc-brand-mark-v2){display:none!important}
    #panel{min-width:270px!important;padding:8px 11px!important}
    #title{gap:7px!important;font-size:15px!important}
    #subtitle{margin-top:2px!important;font-size:9px!important}
    #info{margin-top:5px!important;padding-top:5px!important;font-size:8px!important;line-height:1.3!important;max-height:48px;overflow:hidden;opacity:.52}
    #zones-tab{top:128px!important;width:150px!important;padding:7px 10px!important;border-radius:10px!important;cursor:pointer!important}
    #zones-tab .lc-icon{display:none!important}
    .lc-zones-mark{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:#e10600}
    .lc-zones-mark svg{width:100%;height:100%;display:block}
    #zones-tab{gap:6px!important}
    #zones-panel{top:164px!important;width:270px!important}
    @media(max-width:700px){#zones-tab{top:119px!important;width:150px!important}#zones-panel{top:154px!important}}
  `;
  document.head.appendChild(style);

  function apply() {
    const title = document.getElementById("title");
    if (title) {
      const old = title.querySelector(".lc-brand-mark");
      if (old) old.remove();
      if (!title.querySelector(".lc-brand-mark-v2")) title.insertAdjacentHTML("afterbegin", BRAND_MARK);
    }

    const tab = document.getElementById("zones-tab");
    if (tab && !tab.dataset.brandV2) {
      tab.dataset.brandV2 = "1";
      const text = tab.textContent.trim().replace(/^\s*[◇◈▢□]+\s*/, "").replace(/^(FERMER|ZONES)$/i, "ZONES");
      tab.innerHTML = `${ZONES_MARK}<span>${text === "FERMER" ? "FERMER" : "ZONES"}</span>`;
    }
  }

  function installZoneHover() {
    if (typeof map === "undefined" || !map || map.__lcZoneHoverInstalled) return false;
    const fillId = "alliance-zones-fill";
    const lineId = "alliance-zones-line";
    if (!map.getLayer(fillId)) return false;

    const source = map.getLayer(fillId).source;
    if (!source) return false;

    const hoverId = "alliance-zones-hover";
    if (!map.getLayer(hoverId)) {
      const sourceLayer = map.getLayer(fillId).sourceLayer;
      const layer = {
        id: hoverId,
        type: "line",
        source,
        paint: {
          "line-color": "#ffffff",
          "line-width": 3,
          "line-opacity": 0.95,
          "line-blur": 0.2
        },
        filter: ["==", ["get", "id"], "__none__"]
      };
      if (sourceLayer) layer["source-layer"] = sourceLayer;
      map.addLayer(layer);
    }

    let hoveredId = null;
    const setHover = event => {
      const feature = event.features && event.features[0];
      const id = feature && feature.properties && feature.properties.id;
      if (id == null) return;
      hoveredId = String(id);
      map.setFilter(hoverId, ["==", ["get", "id"], hoveredId]);
      map.getCanvas().style.cursor = "pointer";
    };
    const clearHover = () => {
      hoveredId = null;
      if (map.getLayer(hoverId)) map.setFilter(hoverId, ["==", ["get", "id"], "__none__"]);
      map.getCanvas().style.cursor = "";
    };

    map.on("mouseenter", fillId, setHover);
    map.on("mousemove", fillId, setHover);
    map.on("mouseleave", fillId, clearHover);
    map.__lcZoneHoverInstalled = true;
    return true;
  }

  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(apply, 100);
  setTimeout(apply, 500);
  setTimeout(apply, 1500);

  if (!installZoneHover()) {
    const retryHover = () => {
      if (installZoneHover() && typeof map !== "undefined") {
        map.off("styledata", retryHover);
        map.off("idle", retryHover);
      }
    };
    if (typeof map !== "undefined") {
      map.on("styledata", retryHover);
      map.on("idle", retryHover);
    }
    setTimeout(installZoneHover, 100);
    setTimeout(installZoneHover, 500);
    setTimeout(installZoneHover, 1500);
  }
})();
