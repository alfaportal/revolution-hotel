(function (global) {
  const STORAGE_KEY = "revolution-pos-lang";

  function getLang() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "en" ? "en" : "sq";
  }

  function setLang(nextLang) {
    if (nextLang !== "sq" && nextLang !== "en") return;
    localStorage.setItem(STORAGE_KEY, nextLang);
    document.documentElement.lang = nextLang === "en" ? "en" : "sq";
    applyI18n(nextLang);
    document.dispatchEvent(new CustomEvent("site-lang-change", { detail: { lang: nextLang } }));
  }

  function t(lang, key, strings) {
    return strings[lang]?.[key] ?? strings.sq?.[key] ?? key;
  }

  function applyI18n(lang, strings) {
    const dict = strings || global.SITE_STRINGS;
    if (!dict) return;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const value = t(lang, key, dict);
      if (value !== key) el.textContent = value;
    });

    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      const value = t(lang, key, dict);
      if (value !== key) el.innerHTML = value;
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const value = t(lang, key, dict);
      if (value !== key) el.placeholder = value;
    });

    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.getAttribute("data-i18n-attr").split(";").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        const value = t(lang, key, dict);
        if (value !== key) el.setAttribute(attr, value);
      });
    });

    const titleKey = document.body?.dataset?.i18nTitle;
    if (titleKey) {
      document.title = t(lang, titleKey, dict);
    }

    const metaKey = document.body?.dataset?.i18nMetaDescription;
    if (metaKey) {
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.content = t(lang, metaKey, dict);
    }

    document.querySelectorAll(".lang-switch button[data-lang]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === lang);
    });
  }

  function bindLangSwitch() {
    document.querySelectorAll(".lang-switch button[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.lang !== getLang()) setLang(btn.dataset.lang);
      });
    });
  }

  function initSiteI18n(strings) {
    const lang = getLang();
    document.documentElement.lang = lang === "en" ? "en" : "sq";
    applyI18n(lang, strings);
    bindLangSwitch();
    return lang;
  }

  global.SiteLang = { getLang, setLang, applyI18n, initSiteI18n, t, STORAGE_KEY };
})(window);
