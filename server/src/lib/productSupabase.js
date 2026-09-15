/**
 * Revolution HOTEL server — vetëm Supabase i HOTEL (SUPABASE_URL).
 * Nuk flet me POS dhe as me Security / MARKET.
 */
const { getSupabase } = require("../db");
const { trimEnv } = require("./env");
const { normalizeProductLine } = require("../utils/productLine");

const licenseHome = new Map();

function homeProduct() {
  return normalizeProductLine(trimEnv("PRODUCT_LINE") || "hotel");
}

function isDedicatedProduct(product) {
  const p = normalizeProductLine(product || homeProduct());
  return p === "market" || p === "hotel";
}

function getSupabaseForProduct(product) {
  const p = normalizeProductLine(product || homeProduct());
  if (p === "security") {
    throw new Error("Security nuk përdor këtë server — përdor revolution-security.");
  }
  return getSupabase();
}

function rememberLicenseHome(licenseId, product) {
  const id = String(licenseId || "").trim();
  if (!id) return;
  licenseHome.set(id, normalizeProductLine(product) || homeProduct());
}

function rememberedProduct(licenseId) {
  return licenseHome.get(String(licenseId || "").trim()) || homeProduct();
}

async function findLicenseOnProductDbs(lookup) {
  const product = homeProduct();
  const db = getSupabase();
  try {
    const row = await lookup(db, product);
    if (row) {
      rememberLicenseHome(row.id, product);
      return { row, product, db };
    }
  } catch (e) {
    const msg = String(e.message || e.code || "");
    if (/PGRST205|schema cache|does not exist/i.test(msg)) {
      return { row: null, product: null, db: null };
    }
    throw e;
  }
  return { row: null, product: null, db: null };
}

async function dbForLicenseId(licenseId, productHint) {
  const product = normalizeProductLine(productHint || rememberedProduct(licenseId) || homeProduct());
  if (licenseId) rememberLicenseHome(licenseId, product);
  return { db: getSupabase(), product };
}

async function dbForClientId(clientId, productHint) {
  const product = normalizeProductLine(productHint || homeProduct());
  return { db: getSupabase(), product };
}

function productEnv() {
  const { getSupabaseConfig } = require("./env");
  const { url, key } = getSupabaseConfig();
  return { product: homeProduct(), url, key };
}

module.exports = {
  isDedicatedProduct,
  getSupabaseForProduct,
  rememberLicenseHome,
  rememberedProduct,
  findLicenseOnProductDbs,
  dbForLicenseId,
  dbForClientId,
  productEnv,
  homeProduct,
};
