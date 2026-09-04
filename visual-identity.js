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
    // map can exist as a global lexical binding while still being null during startup.
    if (typeof map === "undefined" || map === null || !map || map.__lcZoneHoverInstalled) return false;

    const fillId = "alliance-zones-fill";
    if (!map.getLayer(fillId)) return false;

    const fillLayer = map.getLayer(fillId);
    const source = fillLayer && fillLayer.source;
    if (!source) return false;

    const sourceLayer = fillLayer.sourceLayer;
    const hoverFillId = "alliance-zones-hover-fill";
    const hoverLineId = "alliance-zones-hover-line";

    // A visible fill + bright outline makes the hover state obvious even on a busy WPlace canvas.
    if (!map.getLayer(hoverFillId)) {
      const layer = {
        id: hoverFillId,
        type: "fill",
        source,
        paint: {
          "fill-color": "#ffffff",
          "fill-opacity": 0.16
        },
        filter: ["==", ["get", "id"], "__none__"]
      };
      if (sourceLayer) layer["source-layer"] = sourceLayer;
      map.addLayer(layer);
    }

    if (!map.getLayer(hoverLineId)) {
      const layer = {
        id: hoverLineId,
        type: "line",
        source,
        paint: {
          "line-color": "#ffffff",
          "line-width": 5,
          "line-opacity": 1,
          "line-blur": 0
        },
        filter: ["==", ["get", "id"], "__none__"]
      };
      if (sourceLayer) layer["source-layer"] = sourceLayer;
      map.addLayer(layer);
    }

    let hoveredId = null;

    const clearHover = () => {
      if (hoveredId === null) return;
      hoveredId = null;
      if (map.getLayer(hoverFillId)) map.setFilter(hoverFillId, ["==", ["get", "id"], "__none__"]);
      if (map.getLayer(hoverLineId)) map.setFilter(hoverLineId, ["==", ["get", "id"], "__none__"]);
      map.getCanvas().style.cursor = "";
    };

    const setHover = event => {
      const features = event.features || [];
      const feature = features[0];
      const id = feature && feature.properties && feature.properties.id;
      if (id == null) return clearHover();

      const nextId = String(id);
      if (hoveredId !== nextId) {
        hoveredId = nextId;
        const filter = ["==", ["get", "id"], hoveredId];
        if (map.getLayer(hoverFillId)) map.setFilter(hoverFillId, filter);
        if (map.getLayer(hoverLineId)) map.setFilter(hoverLineId, filter);
      }
      map.getCanvas().style.cursor = "pointer";
    };

    map.on("mousemove", fillId, setHover);
    map.on("mouseenter", fillId, setHover);
    map.on("mouseleave", fillId, clearHover);

    map.__lcZoneHoverInstalled = true;
    console.log("Zone hover : effet de survol activé");
    return true;
  }

  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(apply, 100);
  setTimeout(apply, 500);
  setTimeout(apply, 1500);

  function retryHover() {
    if (installZoneHover()) {
      if (typeof map !== "undefined" && map) {
        try { map.off("styledata", retryHover); } catch (_) {}
        try { map.off("idle", retryHover); } catch (_) {}
      }
      return true;
    }
    return false;
  }

  if (!retryHover() && typeof map !== "undefined" && map) {
    map.on("styledata", retryHover);
    map.on("idle", retryHover);
  }
  setTimeout(retryHover, 100);
  setTimeout(retryHover, 500);
  setTimeout(retryHover, 1500);
  setTimeout(retryHover, 3000);
})();