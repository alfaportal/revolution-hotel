/**
 * Open Food Facts — lookup produkti sipas barkodit (EAN/UPC).
 * Përdoret nga admin (USB scanner = tastierë: numra + Enter).
 */

function normalizeBarcode(raw) {
  return String(raw || "")
    .trim()
    .replace(/[\s_-]+/g, "");
}

/**
 * @param {string} barcode
 * @returns {Promise<{ found: boolean, barcode: string, name: string, source: string }>}
 */
async function lookupOpenFoodFacts(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code || code.length < 4) {
    return { found: false, barcode: code, name: "", source: "openfoodfacts" };
  }
  if (!/^[0-9A-Za-z]{4,32}$/.test(code)) {
    return { found: false, barcode: code, name: "", source: "openfoodfacts" };
  }

  const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RevolutionHOTEL/1.0 (menu barcode lookup)",
    },
  });
  if (!res.ok) {
    const err = new Error(`Open Food Facts HTTP ${res.status}`);
    err.code = "OFF_HTTP";
    throw err;
  }
  const data = await res.json();
  if (Number(data?.status) !== 1 || !data?.product) {
    return { found: false, barcode: code, name: "", source: "openfoodfacts" };
  }
  const p = data.product;
  const name = String(
    p.product_name ||
      p.product_name_en ||
      p.product_name_sq ||
      p.generic_name ||
      p.name ||
      "",
  ).trim();
  return {
    found: Boolean(name),
    barcode: code,
    name,
    source: "openfoodfacts",
  };
}

module.exports = {
  normalizeBarcode,
  lookupOpenFoodFacts,
};
