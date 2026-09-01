(() => {
  "use strict";

  function installZoneDetails() {
    if (document.getElementById("zone-details")) return;

    const style = document.createElement("style");
    style.id = "zone-details-style";
    style.textContent = `
      #zone-details {
        position:absolute;
        top:15px;
        right:15px;
        z-index:1100;
        width:320px;
        max-width:calc(100vw - 30px);
        padding:16px;
        border-radius:9px;
        background:rgba(15,15,15,.96);
        border:1px solid rgba(255,255,255,.15);
        box-shadow:0 5px 25px rgba(0,0,0,.5);
        color:#fff;
        display:none;
      }
      #zone-details.open { display:block; }
      #zone-details-head { display:flex; align-items:flex-start; gap:10px; margin-bottom:14px; }
      #zone-details-swatch { width:12px; height:12px; margin-top:4px; border-radius:50%; border:1px solid #777; flex:0 0 auto; }
      #zone-details-title { flex:1; min-width:0; font-size:16px; font-weight:bold; line-height:1.25; }
      #zone-details-close { border:0; background:transparent; color:#888; font-size:20px; line-height:1; padding:0 2px; cursor:pointer; }
      #zone-details-close:hover { color:#fff; }
      #zone-details-description { margin-bottom:14px; color:#aaa; font-size:11px; line-height:1.5; }
      .zone-details-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .zone-details-field { min-width:0; padding:9px; border-radius:6px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); }
      .zone-details-label { margin-bottom:4px; color:#777; font-size:9px; text-transform:uppercase; letter-spacing:.6px; }
      .zone-details-value { color:#ddd; font-size:11px; line-height:1.3; overflow-wrap:anywhere; }
      #zone-details-actions { display:flex; gap:7px; margin-top:12px; }
      #zone-details-actions button { flex:1; border:1px solid rgba(255,255,255,.12); background:#202020; color:#ccc; border-radius:5px; padding:8px; cursor:pointer; font-size:10px; }
      #zone-details-actions button:hover { background:#2b2b2b; color:#fff; }
      @media(max-width:700px) { #zone-details { top:auto; right:15px; bottom:55px; width:min(320px,calc(100vw - 30px)); } }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("aside");
    panel.id = "zone-details";
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <div id="zone-details-head">
        <span id="zone-details-swatch"></span>
        <div id="zone-details-title"></div>
        <button id="zone-details-close" type="button" aria-label="Fermer">×</button>
      </div>
      <div id="zone-details-description"></div>
      <div class="zone-details-grid">
        <div class="zone-details-field"><div class="zone-details-label">Catégorie</div><div class="zone-details-value" id="zone-details-category">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Statut</div><div class="zone-details-value" id="zone-details-status">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Propriétaire</div><div class="zone-details-value" id="zone-details-owner">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Localisation</div><div class="zone-details-value" id="zone-details-location">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Version</div><div class="zone-details-value" id="zone-details-version">—</div></div>
        <div class="zone-details-field"><div class="zone-details-label">Périmètre</div><div class="zone-details-value" id="zone-details-perimeter">—</div></div>
        <div class="zone-details-field" style="grid-column:1 / -1"><div class="zone-details-label">Dernière modification</div><div class="zone-details-value" id="zone-details-updated">—</div></div>
      </div>
      <div id="zone-details-actions"><button id="zone-details-center" type="button">CENTRER LA ZONE</button></div>
    `;
    document.body.appendChild(panel);

    function categoryName(zone) {
      if (zone.type === "commune") return "La Commune";
      if (zone.type === "sympathisant") return "Allié sympathisant";
      if (zone.type === "allie-neutre") return "Allié neutre";
      return zone.type || "—";
    }

    function statusName(status) {
      if (!status || status === "active") return "Active";
      if (status === "archived") return "Archivée";
      return status;
    }

    function ownerName(zone) {
      if (!zone.owner_name) return "Non renseigné";
      if (zone.owner_public === false) return "Propriétaire privé";
      return zone.owner_name;
    }

    function updatedName(value) {
      if (!value) return "Non renseignée";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    }

    function showZoneDetails(zone) {
      if (!zone) return;
      document.getElementById("zone-details-title").textContent = zone.name || "Zone";
      document.getElementById("zone-details-description").textContent = zone.description || "Aucune description.";
      document.getElementById("zone-details-category").textContent = categoryName(zone);
      document.getElementById("zone-details-status").textContent = statusName(zone.status);
      document.getElementById("zone-details-owner").textContent = ownerName(zone);
      document.getElementById("zone-details-location").textContent = [zone.country, zone.continent].filter(Boolean).join(" · ") || "—";
      document.getElementById("zone-details-version").textContent = zone.version != null ? "v" + zone.version : "—";
      document.getElementById("zone-details-perimeter").textContent = (zone.points ? zone.points.length : 0) + " points";
      document.getElementById("zone-details-updated").textContent = updatedName(zone.updated_at);

      const swatch = document.getElementById("zone-details-swatch");
      swatch.style.background = typeof zoneColor === "function" ? zoneColor(zone) : "#888";
      swatch.style.borderColor = zone.type === "allie-neutre" ? "#777" : swatch.style.background;

      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
      panel.dataset.zoneId = zone.id || "";
    }

    function closeZoneDetails() {
      panel.classList.remove("open");
      panel.setAttribute("aria-hidden", "true");
      delete panel.dataset.zoneId;
    }

    document.getElementById("zone-details-close").addEventListener("click", closeZoneDetails);

    document.getElementById("zone-details-center").addEventListener("click", function () {
      const zoneId = panel.dataset.zoneId;
      const zone = Array.isArray(ALLIANCE_ZONES) ? ALLIANCE_ZONES.find(function (item) { return item.id === zoneId; }) : null;
      if (!zone || typeof map === "undefined") return;
      map.flyTo({ center: zone.center, zoom: zone.zoom, duration: 700 });
    });

    window.showZoneDetails = showZoneDetails;
    window.closeZoneDetails = closeZoneDetails;

    function bindZoneCards() {
      const cards = document.querySelectorAll("#zones-list .zone-card");
      cards.forEach(function (card) {
        if (card.dataset.detailsBound === "true") return;
        const name = card.querySelector(".zone-name");
        if (!name) return;
        const zone = Array.isArray(ALLIANCE_ZONES) ? ALLIANCE_ZONES.find(function (item) { return item.name === name.textContent; }) : null;
        if (!zone) return;
        name.style.cursor = "pointer";
        name.title = "Afficher les détails";
        name.addEventListener("click", function () { showZoneDetails(zone); });
        card.dataset.detailsBound = "true";
      });
    }

    const observer = new MutationObserver(bindZoneCards);
    const list = document.getElementById("zones-list");
    if (list) observer.observe(list, { childList: true, subtree: true });
    bindZoneCards();

    function bindMapEvents() {
      if (typeof map === "undefined") return;
      if (!map.getLayer("alliance-zones-fill")) return;

      map.on("click", "alliance-zones-fill", function (event) {
        if (!event.features || !event.features.length) return;
        const id = event.features[0].properties && event.features[0].properties.id;
        const zone = Array.isArray(ALLIANCE_ZONES) ? ALLIANCE_ZONES.find(function (item) { return item.id === id; }) : null;
        if (zone) showZoneDetails(zone);
      });

      map.on("mouseenter", "alliance-zones-fill", function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "alliance-zones-fill", function () { map.getCanvas().style.cursor = ""; });
    }

    if (typeof map !== "undefined") {
      if (map.isStyleLoaded()) bindMapEvents();
      else map.once("load", bindMapEvents);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installZoneDetails, { once: true });
  } else {
    installZoneDetails();
  }
})();
