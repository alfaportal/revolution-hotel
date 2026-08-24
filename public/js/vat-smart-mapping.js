/**
 * Smart mapping TVSH — lexon data/tvsh-kosove-databaze.json (servuar nga /data/).
 * Propozon letter + rate kur shkruhet emri i produktit.
 */
(function () {
  "use strict";

  let db = null;
  let loadPromise = null;

  function normalizeName(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  const EMPTY_DB = { products: [], categories: [] };

  function loadDatabase() {
    if (db) return Promise.resolve(db);
    if (!loadPromise) {
      const url = "/data/tvsh-kosove-databaze.json";
      loadPromise = fetch(url)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} për ${url}`);
          const text = await r.text();
          if (!String(text || "").trim()) throw new Error("Përgjigje bosh");
          try {
            return JSON.parse(text);
          } catch (parseErr) {
            throw new Error(parseErr?.message || "JSON i pavlefshëm");
          }
        })
        .then((data) => {
          if (!data || typeof data !== "object") throw new Error("JSON i pavlefshëm");
          const products = data.products || [];
          const categories = data.categories || [];
          if (!products.length) {
            throw new Error("Databaza TVSH bosh (products.length=0)");
          }
          db = data;
          console.log(
            "[vat-smart-mapping] ngarkuar:",
            products.length,
            "produkte,",
            categories.length,
            "kategori"
          );
          return db;
        })
        .catch((err) => {
          loadPromise = null;
          db = null;
          console.warn("[vat-smart-mapping] databaza TVSH:", err?.message || err);
          return EMPTY_DB;
        });
    }
    return loadPromise;
  }

  /** Gjen hyrjen me keyword më të gjatë që përputhet. */
  function findBestKeywordEntry(normalized, entries) {
    let bestEntry = null;
    let bestLen = 0;
    for (const entry of entries || []) {
      for (const kw of entry.keywords || []) {
        const k = normalizeName(kw);
        if (!k || !normalized.includes(k)) continue;
        if (k.length > bestLen) {
          bestLen = k.length;
          bestEntry = entry;
        }
      }
    }
    return bestEntry;
  }

  /**
   * @param {string} productName
   * @param {object} database — parsed tvsh-kosove-databaze.json
   * @returns {{ letter: string|null, rate: number|null, disputed: boolean }}
   */
  function resolveVatFromNameSync(productName, database) {
    const normalized = normalizeName(productName);
    if (!normalized) {
      return { letter: "E", rate: 18, disputed: false };
    }

    const products = database?.products || [];
    const categories = database?.categories || [];
    const disputedCat = categories.find((c) => c.id === "disputed_verify");
    const normalCats = categories.filter((c) => c.id !== "disputed_verify");

    const productHit = findBestKeywordEntry(normalized, products);
    if (productHit && productHit.letter != null && productHit.rate != null) {
      return { letter: productHit.letter, rate: productHit.rate, disputed: false };
    }

    const catHit = findBestKeywordEntry(normalized, normalCats);
    if (catHit && catHit.letter != null && catHit.rate != null) {
      return { letter: catHit.letter, rate: catHit.rate, disputed: false };
    }

    if (disputedCat && findBestKeywordEntry(normalized, [disputedCat])) {
      return { letter: null, rate: null, disputed: true };
    }

    return { letter: "E", rate: 18, disputed: false };
  }

  function resolveVatFromName(productName) {
    return loadDatabase()
      .then((database) => resolveVatFromNameSync(productName, database))
      .catch(() => ({ letter: "E", rate: 18, disputed: false }));
  }

  function letterToVatCategory(letter, rate) {
    const r = Number(rate);
    if (letter === "D" || r === 8) return "8";
    if (letter === "A" || letter === "C" || r === 0) return "0";
    return "18";
  }

  function formatVatLabel(letter, rate) {
    if (letter == null || rate == null) return "—";
    return `${letter} · ${rate}%`;
  }

  window.VatSmartMapping = {
    loadDatabase,
    normalizeName,
    resolveVatFromName,
    resolveVatFromNameSync,
    letterToVatCategory,
    formatVatLabel,
  };
})();
