/**
 * fiscal-payment-modal.js — HAPI 4: zgjedhja e mënyrës së pagesës PARA mbylljes.
 * Tekstet sq/sr vijnë nga /api/fiscal-enabled (fiscal_settings.language).
 */
(function (global) {
  "use strict";

  var METHODS = [
    { id: "cash" },
    { id: "debit_card" },
    { id: "credit_card" },
    { id: "bank_account" },
    { id: "voucher" },
    { id: "check" },
    { id: "sms" },
  ];

  var FALLBACK_LABELS = {
    sq: {
      title: "Mënyra e pagesës",
      sub: "Zgjidhni para printimit të kuponit. Default: Para e gatshme.",
      cancel: "Anulo",
      methods: {
        cash: "Para e gatshme",
        debit_card: "Debit kartelë",
        credit_card: "Kredit kartelë",
        bank_account: "Llogari bankare",
        voucher: "Vauçer",
        check: "Çek",
        sms: "SMS",
      },
    },
    sr: {
      title: "Način plaćanja",
      sub: "Izaberite pre štampanja kupona. Podrazumevano: Gotovina.",
      cancel: "Otkaži",
      methods: {
        cash: "Gotovina",
        debit_card: "Debitna kartica",
        credit_card: "Kreditna kartica",
        bank_account: "Bankarski račun",
        voucher: "Vaučer",
        check: "Ček",
        sms: "SMS",
      },
    },
  };

  var STYLE_ID = "fiscal-payment-modal-styles";
  var ROOT_ID = "fiscal-payment-modal";
  var _fiscalEnabledCache = null;
  var _fiscalEnabledAt = 0;
  var _langCache = "sq";
  var _labelsCache = null;
  var _methodLabelsCache = null;
  var CACHE_MS = 15000;
  var LOG = false;

  function fpmLog() {
    if (!LOG) return;
    try {
      var args = ["[FiscalPaymentModal]"].concat([].slice.call(arguments));
      console.log.apply(console, args);
    } catch (_e) { /* ignore */ }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#" + ROOT_ID + "{" +
      "position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:1rem;" +
      "}" +
      "#" + ROOT_ID + "[hidden]{display:none!important}" +
      "#" + ROOT_ID + " .fpm-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.65)}" +
      "#" + ROOT_ID + " .fpm-card{" +
      "position:relative;width:100%;max-width:360px;background:#1a1a2e;border:1px solid rgba(255,107,53,0.4);" +
      "border-radius:12px;padding:1.25rem;box-shadow:0 12px 40px rgba(0,0,0,0.45);color:#e8e8ef;" +
      "}" +
      "#" + ROOT_ID + " .fpm-title{margin:0 0 0.35rem;font-size:1.1rem;font-weight:700;color:#fff}" +
      "#" + ROOT_ID + " .fpm-sub{margin:0 0 1rem;font-size:0.85rem;color:#a0a0b8}" +
      "#" + ROOT_ID + " .fpm-grid{display:flex;flex-direction:column;gap:0.5rem}" +
      "#" + ROOT_ID + " .fpm-btn{" +
      "display:block;width:100%;padding:0.75rem 1rem;border-radius:8px;border:1px solid #2e2e45;" +
      "background:#12121f;color:#e8e8ef;font-size:0.95rem;font-weight:600;cursor:pointer;text-align:left;" +
      "}" +
      "#" + ROOT_ID + " .fpm-btn:hover,#" + ROOT_ID + " .fpm-btn:focus{border-color:#FF6B35;outline:none}" +
      "#" + ROOT_ID + " .fpm-btn.fpm-default{border-color:#FF6B35;background:rgba(255,107,53,0.15);color:#FF6B35}" +
      "#" + ROOT_ID + " .fpm-cancel{" +
      "margin-top:0.85rem;width:100%;padding:0.65rem;border-radius:8px;border:1px solid #3a3a55;" +
      "background:transparent;color:#a0a0b8;cursor:pointer;font-size:0.9rem" +
      "}";
    document.head.appendChild(style);
  }

  function resolveUiPack(lang, labels, methodLabels) {
    var L = lang === "sr" ? "sr" : "sq";
    var fb = FALLBACK_LABELS[L];
    return {
      lang: L,
      title: (labels && labels.title) || fb.title,
      sub: (labels && labels.sub) || fb.sub,
      cancel: (labels && labels.cancel) || fb.cancel,
      methods: methodLabels || fb.methods,
    };
  }

  function ensureDom() {
    ensureStyles();
    var root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML =
      '<div class="fpm-backdrop" data-fpm="backdrop"></div>' +
      '<div class="fpm-card">' +
      '<h2 class="fpm-title"></h2>' +
      '<p class="fpm-sub"></p>' +
      '<div class="fpm-grid" data-fpm="grid"></div>' +
      '<button type="button" class="fpm-cancel" data-fpm="cancel"></button>' +
      "</div>";
    var grid = root.querySelector('[data-fpm="grid"]');
    METHODS.forEach(function (m) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fpm-btn" + (m.id === "cash" ? " fpm-default" : "");
      btn.setAttribute("data-fpm-method", m.id);
      grid.appendChild(btn);
    });
    document.body.appendChild(root);
    return root;
  }

  function paintLabels(pack) {
    var root = ensureDom();
    var title = root.querySelector(".fpm-title");
    var sub = root.querySelector(".fpm-sub");
    var cancel = root.querySelector('[data-fpm="cancel"]');
    if (title) title.textContent = pack.title;
    if (sub) sub.textContent = pack.sub;
    if (cancel) cancel.textContent = pack.cancel;
    METHODS.forEach(function (m) {
      var btn = root.querySelector('[data-fpm-method="' + m.id + '"]');
      if (!btn) return;
      var label =
        (pack.methods && pack.methods[m.id]) ||
        FALLBACK_LABELS[pack.lang].methods[m.id] ||
        m.id;
      btn.textContent = label;
    });
  }

  function pickPaymentMethod() {
    fpmLog("pickPaymentMethod → hap modalin e pagesës");
    return new Promise(function (resolve) {
      var pack = resolveUiPack(_langCache, _labelsCache, _methodLabelsCache);
      paintLabels(pack);
      var root = ensureDom();
      var settled = false;

      function finish(value) {
        if (settled) return;
        settled = true;
        fpmLog("pickPaymentMethod → zgjedhur:", value);
        root.hidden = true;
        root.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKey);
        resolve(value);
      }

      function onClick(e) {
        var t = e.target;
        if (!t) return;
        if (t.getAttribute("data-fpm") === "cancel") {
          finish(null);
          return;
        }
        if (t.getAttribute("data-fpm") === "backdrop") {
          finish("cash");
          return;
        }
        var method = t.getAttribute("data-fpm-method");
        if (method) finish(method);
      }

      function onKey(e) {
        if (e.key === "Escape") finish("cash");
      }

      root.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey);
      root.hidden = false;
      fpmLog("modal DOM visible, root.hidden=", root.hidden);
    });
  }

  async function fetchFiscalEnabled(apiFn) {
    var now = Date.now();
    if (_fiscalEnabledCache != null && now - _fiscalEnabledAt < CACHE_MS) {
      fpmLog("fetchFiscalEnabled → cache:", _fiscalEnabledCache, _langCache);
      return _fiscalEnabledCache;
    }
    try {
      fpmLog("fetchFiscalEnabled → GET /api/fiscal-enabled …");
      var res = typeof apiFn === "function"
        ? await apiFn("/api/fiscal-enabled")
        : await fetch("/api/fiscal-enabled", { credentials: "same-origin" }).then(function (r) {
            return r.json();
          });
      fpmLog("fetchFiscalEnabled → response:", res);
      _fiscalEnabledCache = !!(res && (res.enabled === true || res.enabled === 1 || res.enabled === "1"));
      _langCache = res && res.language === "sr" ? "sr" : "sq";
      _labelsCache = (res && res.labels) || null;
      _methodLabelsCache = (res && res.method_labels) || null;
      _fiscalEnabledAt = now;
      return _fiscalEnabledCache;
    } catch (err) {
      fpmLog("fetchFiscalEnabled → ERROR (fallback false):", err && err.message ? err.message : err);
      _fiscalEnabledCache = false;
      _fiscalEnabledAt = now;
      return false;
    }
  }

  async function resolvePaymentMethod(apiFn, fallbackMethod) {
    fpmLog("resolvePaymentMethod → fillon, fallback=", fallbackMethod);
    var enabled = await fetchFiscalEnabled(apiFn);
    fpmLog("resolvePaymentMethod → isFiscalEnabled=", enabled, "lang=", _langCache);
    if (!enabled) {
      fpmLog("resolvePaymentMethod → fiscal OFF, kthej fallback pa modal");
      return fallbackMethod || "cash";
    }
    fpmLog("resolvePaymentMethod → fiscal ON, hap modalin");
    return pickPaymentMethod();
  }

  function invalidateCache() {
    _fiscalEnabledCache = null;
    _fiscalEnabledAt = 0;
    _labelsCache = null;
    _methodLabelsCache = null;
  }

  global.FiscalPaymentModal = {
    METHODS: METHODS,
    pickPaymentMethod: pickPaymentMethod,
    fetchFiscalEnabled: fetchFiscalEnabled,
    resolvePaymentMethod: resolvePaymentMethod,
    invalidateCache: invalidateCache,
  };
})(typeof window !== "undefined" ? window : globalThis);
