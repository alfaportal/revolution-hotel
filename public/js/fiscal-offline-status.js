/**
 * fiscal-offline-status.js — indikator FIS (jeshil/kuq) kur fiscal ON.
 * Jeshile = ka internet + fiskal aktiv
 * E kuqe = pa internet (offline mode)
 */
(function (global) {
  "use strict";

  var STYLE_ID = "fiscal-net-indicator-styles";
  var POLL_MS = 5000;
  var _pill = null;
  var _timer = null;
  var _busy = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".fiscal-net-pill{" +
      "display:inline-flex;align-items:center;gap:0.35rem;padding:0.2rem 0.55rem;" +
      "border-radius:999px;font-size:0.72rem;font-weight:700;letter-spacing:0.02em;" +
      "background:#1a1a2e;border:1px solid #2e2e45;color:#a0a0b8;cursor:default;" +
      "user-select:none;vertical-align:middle" +
      "}" +
      ".fiscal-net-pill[hidden]{display:none!important}" +
      ".fiscal-net-dot{" +
      "width:8px;height:8px;border-radius:50%;background:#64748b;flex-shrink:0" +
      "}" +
      ".fiscal-net-pill.fiscal-net-online{border-color:rgba(34,197,94,0.55)!important;color:#86efac!important}" +
      ".fiscal-net-pill.fiscal-net-online .fiscal-net-dot{background:#22c55e!important;box-shadow:0 0 6px #22c55e}" +
      ".fiscal-net-pill.fiscal-net-offline{border-color:rgba(239,68,68,0.55)!important;color:#fca5a5!important}" +
      ".fiscal-net-pill.fiscal-net-offline .fiscal-net-dot{background:#ef4444!important;box-shadow:0 0 6px #ef4444}" +
      ".fiscal-net-pill .fiscal-net-label{white-space:nowrap}";
    document.head.appendChild(style);
  }

  function ensurePill(anchorId) {
    ensureStyles();
    var existing = document.getElementById("fiscal-net-pill");
    if (existing) return existing;

    var pill = document.createElement("span");
    pill.id = "fiscal-net-pill";
    pill.className = "fiscal-net-pill";
    pill.hidden = true;
    pill.setAttribute("role", "status");
    pill.innerHTML =
      '<span class="fiscal-net-dot" aria-hidden="true"></span>' +
      '<span class="fiscal-net-label">FIS</span>';

    var anchor = anchorId ? document.getElementById(anchorId) : null;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(pill, anchor.nextSibling);
    } else {
      document.body.appendChild(pill);
    }
    return pill;
  }

  function applyStatus(pill, data) {
    if (!pill) return;
    if (!data || !data.enabled) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    pill.classList.remove("fiscal-net-online", "fiscal-net-offline", "fiscal-net-warn");

    // online: true nga server = jeshile; false = kuqe
    // Nëse mungon fusha, përdor navigator.onLine
    var online =
      data.online === true
        ? true
        : data.online === false
          ? false
          : typeof navigator === "undefined" || navigator.onLine !== false;

    var pending = Number(data.pending_count) || 0;
    var total = Number(data.receipt_count) || 0;
    var label = pill.querySelector(".fiscal-net-label");
    var fisNum = total > 0 ? total : pending;

    if (!online) {
      pill.classList.add("fiscal-net-offline");
      if (label) label.textContent = fisNum ? "FIS OFF · " + fisNum : "FIS OFF";
      pill.title = data.warning || "Pa internet — kuponët ruhen offline";
      pill.setAttribute("aria-label", "Fiskal offline");
    } else {
      // Internet OK → gjithmonë jeshile (pending/warning vetëm në title)
      pill.classList.add("fiscal-net-online");
      if (label) label.textContent = fisNum ? "FIS · " + fisNum : "FIS ON";
      pill.title =
        data.warning ||
        (total
          ? total + " kupon(ë) fiskalë" + (pending ? " (" + pending + " pa dërgu)" : "")
          : "Internet OK — fiskalizimi aktiv");
      pill.setAttribute("aria-label", "Fiskal online");
    }
  }

  async function fetchStatus() {
    try {
      var headers = { Accept: "application/json" };
      try {
        var raw = localStorage.getItem("sesioni") || sessionStorage.getItem("sesioni");
        if (raw) {
          var u = JSON.parse(raw);
          if (u && u.token) headers["X-Session-Token"] = u.token;
        }
      } catch (_e) { /* */ }

      if (typeof global.api === "function") {
        return await global.api("/api/fiscal-offline/status");
      }

      var res = await fetch("/api/fiscal-offline/status", {
        credentials: "same-origin",
        headers: headers,
      });
      if (!res.ok) {
        return { enabled: false, online: false };
      }
      return await res.json();
    } catch (_e) {
      // Lidhja me POS lokal dështoi — trajto si offline nëse pill është aktiv
      return { enabled: false, online: false, _fetch_failed: true };
    }
  }

  async function tick() {
    if (_busy) return;
    _busy = true;
    try {
      var pill = _pill || document.getElementById("fiscal-net-pill");
      if (!pill) return;
      var data = await fetchStatus();
      // Nëse fetch dështoi por pill ishte i dukshëm, mbaj NUI + enabled dhe shëno offline
      if (data && data._fetch_failed && !pill.hidden) {
        applyStatus(pill, {
          enabled: true,
          online: false,
          receipt_count: 0,
          pending_count: 0,
          warning: "Pa lidhje me serverin lokal",
        });
        return;
      }
      applyStatus(pill, data);
    } finally {
      _busy = false;
    }
  }

  function refreshFiscalNetIndicator() {
    return tick();
  }

  function initFiscalNetIndicator(anchorId) {
    _pill = ensurePill(anchorId || "cloud-status-pill");
    tick();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(tick, POLL_MS);

    if (!global.__fiscalNetListenersBound) {
      global.__fiscalNetListenersBound = true;
      global.addEventListener("online", function () { tick(); });
      global.addEventListener("offline", function () { tick(); });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") tick();
      });
      // Pas mbylljes së porosisë / kuponit fiskal
      global.addEventListener("fiscal-receipt-created", function () { tick(); });
      global.addEventListener("pos-order-closed", function () { tick(); });
    }
  }

  global.initFiscalNetIndicator = initFiscalNetIndicator;
  global.refreshFiscalNetIndicator = refreshFiscalNetIndicator;
})(typeof window !== "undefined" ? window : globalThis);
