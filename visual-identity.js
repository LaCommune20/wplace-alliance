(() => {
  "use strict";

  const BRAND_MARK = `
    <span class="lc-brand-mark-v2" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="img">
        <path d="M3 3h26v26H3z" fill="#090909"/>
        <path d="M3 3h26L3 29z" fill="#e10600"/>
        <path d="M8 7h5.2c5.8 0 10.8 4.2 10.8 9.5S19 26 13.2 26H8V7Zm4.8 4.2v10.6h.4c3.3 0 5.9-2.3 5.9-5.3s-2.6-5.3-5.9-5.3h-.4Z" fill="#fff" opacity=".96"/>
        <path d="M18.8 10.2c2.1 1.5 3.5 3.7 3.5 6.3 0 2.6-1.4 4.8-3.5 6.3 1.9-1.8 2.9-4 2.9-6.3s-1-4.5-2.9-6.3Z" fill="#090909"/>
      </svg>
    </span>`;

  const ZONES_MARK = `
    <span class="lc-zones-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
    </span>`;

  const style = document.createElement("style");
  style.id = "lc-visual-identity-v2";
  style.textContent = `
    .lc-brand-mark-v2{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#090909;border:1px solid rgba(255,255,255,.12)}
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

  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(apply, 100);
  setTimeout(apply, 500);
  setTimeout(apply, 1500);
})();
