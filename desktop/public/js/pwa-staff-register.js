(function registerHotelStaffServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw-staff.js").catch(function () {
      /* LAN — mos blloko UI */
    });
  });
})();
