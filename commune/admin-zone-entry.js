(() => {
  "use strict";

  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  const list = document.getElementById("zones-list");
  if (!list) return;

  const style = document.createElement("style");
  style.textContent = `.lc-zone-entry{margin-left:auto;flex:0 0 auto;border:1px solid rgba(225,6,0,.32);border-radius:7px;background:rgba(225,6,0,.07);color:#ddd;padding:5px 8px;cursor:pointer;font-size:9px}.lc-zone-entry:hover{background:rgba(225,6,0,.16);border-color:rgba(225,6,0,.55);color:#fff}.lc-zone-entry-wrap{margin-left:auto;display:flex;align-items:center;gap:5px}`;
  document.head.appendChild(style);

  function authOptions() {
    const token = sessionStorage.getItem("wplace_session");
    return token ? { headers: { Authorization: "Bearer " + token }, cache: "no-store" } : { credentials: "include", cache: "no-store" };
  }

  async function loadZones() {
    const response = await fetch(API + "/api/admin/zones", authOptions());
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error("HTTP " + response.status);
    return Array.isArray(data) ? data : (Array.isArray(data?.zones) ? data.zones : []);
  }

  function addButtons(zones) {
    const rows = [...list.querySelectorAll(".zone")];
    rows.forEach((row, index) => {
      if (row.querySelector(".lc-zone-entry")) return;
      const name = row.querySelector(".zone-name")?.textContent?.trim();
      const zone = zones.find(z => String(z.name || "").trim() === name) || zones[index];
      if (!zone) return;
      const wrap = document.createElement("div");
      wrap.className = "lc-zone-entry-wrap";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lc-zone-entry";
      button.textContent = "Modifier";
      button.title = "Modifier les métadonnées de cette zone";
      button.addEventListener("click", () => {
        window.location.href = "zone-editor.html?zone=" + encodeURIComponent(zone.id);
      }, { once: true });
      wrap.appendChild(button);
      row.appendChild(wrap);
    });
  }

  async function init() {
    try {
      const zones = await loadZones();
      let attempts = 0;
      const check = () => {
        addButtons(zones);
        attempts += 1;
        if (attempts < 30 && list.querySelectorAll(".zone").length < zones.length) setTimeout(check, 100);
      };
      check();
    } catch (error) {
      console.warn("Entrée éditeur de zones : impossible de charger les zones", error);
    }
  }

  init();
})();
