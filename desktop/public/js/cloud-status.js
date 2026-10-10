/**
 * Revolution HOTEL — tregues lidhjeje (polling).
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
      el.setAttribute("aria-label", menuOk ? "I lidhur" : "I lidhur — kontrolloni menunë");
      el.title = msg || (menuOk
        ? "Programi është i lidhur me internetin."
        : "I lidhur — kontrolloni menunë nëse mungon online.");
      el.textContent = "☁ Online";
    } else if (offline) {
      el.setAttribute("aria-label", "Jashtë linje");
      el.title = msg || "Pa internet — programi vazhdon normalisht në hotel.";
      el.textContent = "☁ Jashtë linje";
    } else if (syncing) {
      el.setAttribute("aria-label", "Duke u lidhur");
      el.title = msg || "Duke kontrolluar licencën…";
      el.textContent = "☁ Duke u lidhur";
    } else if (reachable && !data.configured) {
      el.setAttribute("aria-label", "Licenca mungon");
      el.title = msg || "Vendosni çelësin e licencës te Cilësimet.";
      el.textContent = "☁ Online";
    } else {
      el.setAttribute("aria-label", "Jo i lidhur");
      el.title = msg || "Nuk jeni të lidhur me internetin.";
      el.textContent = "☁ Online";
    }
  }

  window.initCloudStatusIndicator = function initCloudStatusIndicator(elementId, opts) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const delayMs = Number(opts && opts.delayMs) || 0;
    const poll = opts && opts.poll === false ? false : true;

    const tick = async () => {
      if (tick._busy) return;
      tick._busy = true;
      try {
        applyCloudStatus(el, await fetchCloudStatus());
      } catch {
        applyCloudStatus(el, { offline: true, message: "Pa përgjigje — hoteli punon normalisht." });
      } finally {
        tick._busy = false;
      }
    };

    if (delayMs > 0) setTimeout(tick, delayMs);
    else tick();
    if (poll) setInterval(tick, POLL_MS);
  };
})();
