/**
 * Revolution HOTEL — cloud status pill (polling si KAFENE).
 */
(function () {
  const POLL_MS = 10000;

  async function fetchCloudStatus() {
    const res = await fetch("/api/cloud/status");
    const data = await res.json().catch(() => ({}));
    return data;
  }

  function applyCloudStatus(el, data) {
    if (!el) return;
    const offline = !!data.offline || data.mode === "offline";
    const linked = !!data.connected || !!data.operational;
    const reachable = !!data.reachable || (data.mode === "online" && !offline);
    const syncing = !!data.syncing && !linked;
    const menuOk = !!data.catalog_ok;

    el.classList.toggle("cloud-status-ok", linked);
    el.classList.toggle("cloud-status-bad", !offline && !linked && (syncing || reachable));
    el.classList.toggle("cloud-status-offline", offline);
    el.setAttribute("aria-live", "polite");

    const msg = data.message || data.owner_message || "";
    if (linked) {
      el.setAttribute("aria-label", menuOk ? "Cloud i lidhur" : "Cloud i lidhur — katalog duhet sync");
      el.title = msg || (menuOk
        ? "Licenca dhe cloud hotel janë aktiv."
        : "Cloud i lidhur. Kontrolloni sinkronizimin e katalogut nëse mungon online.");
      el.textContent = "☁ Cloud";
    } else if (offline) {
      el.setAttribute("aria-label", "Cloud offline");
      el.title = msg || "Pa internet — cloud hotel offline; POS punon lokalisht.";
      el.textContent = "☁ Offline";
    } else if (syncing) {
      el.setAttribute("aria-label", "Duke u lidhur me cloud");
      el.title = msg || "Duke validuar licencën…";
      el.textContent = "☁ Sync";
    } else if (reachable && !data.configured) {
      el.setAttribute("aria-label", "Licenca mungon");
      el.title = msg || "Aktivizoni licencën për cloud hotel.";
      el.textContent = "☁ Cloud";
    } else {
      el.setAttribute("aria-label", "Cloud jo i lidhur");
      el.title = msg || "Cloud jo i lidhur";
      el.textContent = "☁ Cloud";
    }
  }

  window.initCloudStatusIndicator = function initCloudStatusIndicator(elementId, opts) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const delayMs = Number(opts && opts.delayMs) || 0;

    const tick = async () => {
      if (tick._busy) return;
      tick._busy = true;
      try {
        applyCloudStatus(el, await fetchCloudStatus());
      } catch {
        applyCloudStatus(el, { offline: true, message: "Pa përgjigje — hotel lokalisht." });
      } finally {
        tick._busy = false;
      }
    };

    if (delayMs > 0) setTimeout(tick, delayMs);
    else tick();
    setInterval(tick, POLL_MS);
  };
})();
