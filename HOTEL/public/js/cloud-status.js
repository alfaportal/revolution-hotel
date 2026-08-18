/**
 * Revolution HOTEL — cloud status pill.
 * Hoteli NUK ka server cloud: gjithmonë Offline (jo jeshile "Cloud").
 */
(function () {
  function applyHotelOffline(el) {
    if (!el) return;
    el.classList.remove("cloud-status-ok", "cloud-status-bad");
    el.classList.add("cloud-status-offline");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", "Offline — pa cloud");
    el.title = "Hoteli punon vetëm lokalisht (SQLite). Cloud do të aktivizohet kur të ketë serverin e vet.";
    el.textContent = "☁ Offline";
  }

  window.initCloudStatusIndicator = function initCloudStatusIndicator(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    applyHotelOffline(el);
    /* Pa polling te /api/cloud — zero lidhje me cloud kafene. */
  };
})();
