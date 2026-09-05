(() => {
  "use strict";
  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  const style = document.createElement("style");
  style.textContent = `
    .lc-geometry-btn{margin-left:auto;border:1px solid rgba(225,6,0,.34);border-radius:7px;background:rgba(225,6,0,.08);color:#ddd;padding:5px 8px;cursor:pointer;font-size:9px}
    .lc-geometry-btn:hover{background:rgba(225,6,0,.18);border-color:rgba(225,6,0,.6);color:#fff}
    .lc-geometry-actions{margin-left:auto;display:flex;align-items:center;gap:5px}
  `;
  document.head.appendChild(style);
  function authOptions(){const token=sessionStorage.getItem("wplace_session");return token?{headers:{Authorization:"Bearer "+token},cache:"no-store"}:{credentials:"include",cache:"no-store"}}
  async function loadZones(){const r=await fetch(API+"/api/admin/zones",authOptions());if(!r.ok)throw new Error("HTTP "+r.status);const data=await r.json();return Array.isArray(data)?data:[]}
  async function init(){try{const zones=await loadZones();const list=document.getElementById("zones-list");if(!list)return;[...list.querySelectorAll(".zone")].forEach((row,index)=>{const zone=zones[index];if(!zone||row.querySelector(".lc-geometry-btn"))return;const actions=document.createElement("div");actions.className="lc-geometry-actions";const button=document.createElement("button");button.type="button";button.className="lc-geometry-btn";button.textContent="Géométrie";button.title="Ouvrir l’éditeur géométrique";button.onclick=()=>{window.location.href="geometry.html?zone="+encodeURIComponent(zone.id)};actions.appendChild(button);row.appendChild(actions)})}catch(error){console.warn("Éditeur géométrique : impossible de charger les zones",error)}}
  const observer=new MutationObserver(init);observer.observe(document.documentElement,{childList:true,subtree:true});init();
})();
