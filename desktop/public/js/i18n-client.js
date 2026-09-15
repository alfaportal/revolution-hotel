/** Client i18n — FR: exact match only (no substring mangling). */
(function () {
  let LOCALE = { locale: "sq", isFrench: false, map: {}, htmlLang: "sq", appName: "" };

  function t(text) {
    if (!LOCALE.isFrench) return text;
    const raw = String(text ?? "");
    if (!raw) return raw;
    if (Object.prototype.hasOwnProperty.call(LOCALE.map, raw)) return LOCALE.map[raw];
    const trimmed = raw.trim();
    if (trimmed !== raw && Object.prototype.hasOwnProperty.call(LOCALE.map, trimmed)) {
      return raw.replace(trimmed, LOCALE.map[trimmed]);
    }
    return raw;
  }

  function translateNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (parent && (parent.tagName === "SCRIPT" || parent.tagName === "STYLE")) return;
    const v = node.nodeValue;
    if (!v || !v.trim()) return;
    const next = t(v);
    if (next !== v) node.nodeValue = next;
  }

  function walk(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(translateNode);
    root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach((el) => {
      ["placeholder", "title", "aria-label"].forEach((attr) => {
        if (!el.hasAttribute(attr)) return;
        const cur = el.getAttribute(attr);
        const next = t(cur);
        if (next !== cur) el.setAttribute(attr, next);
      });
    });
  }

  function applyLocale() {
    if (!LOCALE.isFrench) return;
    document.documentElement.lang = LOCALE.htmlLang || "fr";
    if (document.title) document.title = t(document.title);
    walk(document.body);
  }

  async function boot() {
    try {
      const res = await fetch("/api/locale");
      LOCALE = await res.json();
      window.__I18N__ = LOCALE;
      window.t = t;
      applyLocale();
      const obs = new MutationObserver((muts) => {
        if (!LOCALE.isFrench) return;
        for (const m of muts) {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) translateNode(node);
            else if (node.nodeType === Node.ELEMENT_NODE) walk(node);
          });
          if (m.type === "characterData" && m.target) translateNode(m.target);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) {
      console.warn("i18n:", e.message);
    }
  }

  window.t = t;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  const patchApi = () => {
    if (typeof window.api !== "function" || window.api.__i18nPatched) return;
    const orig = window.api;
    window.api = async function (...args) {
      try {
        return await orig.apply(this, args);
      } catch (err) {
        if (err && err.message) err.message = t(err.message);
        throw err;
      }
    };
    window.api.__i18nPatched = true;
  };
  setTimeout(patchApi, 0);
  setTimeout(patchApi, 500);
})();
