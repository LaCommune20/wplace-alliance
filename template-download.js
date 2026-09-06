(() => {
  "use strict";

  const API = "https://wplace-commune-api-dev.mathieu-peter.workers.dev";
  let lastZone = null;
  let loading = false;

  function authOptions() {
    if (typeof authFetchOptions === "function") return authFetchOptions();
    const token = sessionStorage.getItem("wplace_session");
    return token
      ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      : { credentials: "include", cache: "no-store" };
  }

  function filenameFromDisposition(value, fallback) {
    if (!value) return fallback;
    const utf = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf) {
      try { return decodeURIComponent(utf[1].replace(/^"|"$/g, "")); } catch (_) {}
    }
    const plain = value.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1] : fallback;
  }

  async function downloadTemplate(zone, template, button) {
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span>Téléchargement…</span>';

    try {
      const response = await fetch(
        `${API}/api/zones/${encodeURIComponent(zone)}/templates/${encodeURIComponent(template.slug || template.id)}/download`,
        authOptions()
      );

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch (_) {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const fallback = `${template.name || template.slug || "template"}.wplace`;
      const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), fallback);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      console.error("Téléchargement du template impossible :", error);
      button.title = `Téléchargement impossible : ${error.message || error}`;
      button.innerHTML = '<span>Indisponible</span>';
      setTimeout(() => {
        button.title = "Télécharger le fichier .wplace";
        button.innerHTML = original;
        button.disabled = false;
      }, 1800);
      return;
    }

    button.innerHTML = original;
    button.disabled = false;
  }

  async function enhance() {
    const list = document.getElementById("zone-details-templates-list");
    const panel = document.getElementById("zone-details");
    if (!list || !panel || !panel.classList.contains("open")) return;

    const zone = panel.dataset.zoneId;
    if (!zone || (zone === lastZone && list.dataset.downloadReady === "1")) return;
    if (loading) return;
    loading = true;

    try {
      const response = await fetch(
        `${API}/api/zones/${encodeURIComponent(zone)}/templates`,
        authOptions()
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const templates = await response.json();
      if (!Array.isArray(templates)) return;

      const byName = new Map(templates.map(t => [String(t.name || t.slug || ""), t]));
      const cards = list.querySelectorAll(".zone-template-card");
      cards.forEach(card => {
        const name = card.querySelector(".zone-template-name")?.textContent?.trim();
        const template = byName.get(name);
        const button = card.querySelector(".zone-template-actions button");
        if (!template || !button) return;

        button.disabled = false;
        button.title = "Télécharger le fichier .wplace";
        button.dataset.downloadBound = "1";
        button.onclick = () => downloadTemplate(zone, template, button);
      });

      lastZone = zone;
      list.dataset.downloadReady = "1";
    } catch (error) {
      console.error("Impossible de préparer les téléchargements de templates :", error);
    } finally {
      loading = false;
    }
  }

  function init() {
    const list = document.getElementById("zone-details-templates-list");
    if (!list || list.dataset.downloadObserver === "1") return false;

    list.dataset.downloadObserver = "1";
    const observer = new MutationObserver(() => {
      list.dataset.downloadReady = "";
      setTimeout(enhance, 0);
    });
    observer.observe(list, { childList: true, subtree: true });

    const panel = document.getElementById("zone-details");
    if (panel) {
      const panelObserver = new MutationObserver(() => {
        if (!panel.classList.contains("open")) {
          lastZone = null;
          list.dataset.downloadReady = "";
          return;
        }
        setTimeout(enhance, 0);
      });
      panelObserver.observe(panel, { attributes: true, attributeFilter: ["class", "data-zone-id"] });
    }

    enhance();
    return true;
  }

  if (init()) return;
  const retry = setInterval(() => {
    if (init()) clearInterval(retry);
  }, 250);
  setTimeout(() => clearInterval(retry), 10000);
})();
