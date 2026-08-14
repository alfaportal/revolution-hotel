const crypto = require("crypto");
const { getSupabase } = require("../db");
const { featuresForTier } = require("./packages");
const { isShopStorefront, storefrontPrefix } = require("./storefront");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateKitchenKey() {
  return crypto.randomBytes(24).toString("hex");
}

function slugifyName(emri) {
  const base = String(emri || "lokal")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || "lokal";
}

function generateKitchenSlug(emri) {
  return `${slugifyName(emri)}-${crypto.randomBytes(3).toString("hex")}`;
}

function extractKitchenKey(req) {
  return String(req.query.key || req.headers["x-kitchen-key"] || "").trim();
}

function maskKeyForLog(s) {
  return s.length <= 12 ? s : `${s.slice(0, 6)}...${s.slice(-6)}`;
}

function firstDiffIndex(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : len;
}

function verifyKitchenKey(client, key) {
  const expected = String(client?.kitchen_key || "").trim();
  if (!expected) return false;
  const provided = String(key || "").trim();
  if (!provided) return false;
  console.log(`[verifyKitchenKey] DEBUG expected=${maskKeyForLog(expected)} provided=${maskKeyForLog(provided)} firstDiffAt=${firstDiffIndex(expected, provided)}`);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return expected === provided;
  }
}

async function getClientBySlugOrId(identifier) {
  const id = String(identifier || "").trim();
  if (!id) return null;

  const db = getSupabase();
  if (UUID_RE.test(id)) {
    const { data, error } = await db.from("clients").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  let { data, error } = await db.from("clients").select("*").eq("kitchen_slug", id).maybeSingle();
  if (error) throw error;
  if (data) return data;

  ({ data, error } = await db.from("clients").select("*").ilike("kitchen_slug", id).maybeSingle());
  if (error) throw error;
  return data;
}

async function ensureKitchenCredentials(client) {
  if (!client?.id) return client;
  if (client.kitchen_slug && client.kitchen_key) return client;

  const { db } = await require("./productSupabase").dbForClientId(client.id);
  const patch = {};
  if (!client.kitchen_key) patch.kitchen_key = generateKitchenKey();
  if (!client.kitchen_slug) patch.kitchen_slug = generateKitchenSlug(client.emri);

  const { data, error } = await db
    .from("clients")
    .update(patch)
    .eq("id", client.id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

function buildKitchenUrl(baseUrl, client, kind) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const slug = client.kitchen_slug || client.id;
  const key = client.kitchen_key || "";
  const path = kind === "waiter"
    ? "waiter"
    : kind === "kiosk"
      ? "kiosk"
      : kind === "bar"
        ? "bar"
        : kind === "kitchen"
          ? "kitchen"
          : "kitchen";
  return `${base}/${path}/${encodeURIComponent(slug)}?key=${encodeURIComponent(key)}`;
}

/** URL publike për skanim QR tavoline — pa key në link */
function buildTableMenuUrl(baseUrl, client, tableNumber) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const slug = client.kitchen_slug || client.id;
  const table = Math.max(1, Number(tableNumber) || 1);
  return `${base}/menu/${encodeURIComponent(slug)}/${table}`;
}

/** Link personal i kamarierit — shto &w=token (çdo kamarier tablet i veçantë) */
function buildWaiterUrl(baseUrl, client, webToken = "") {
  const url = buildKitchenUrl(baseUrl, client, "waiter");
  const t = String(webToken || "").trim();
  if (!url || !t) return url;
  return `${url}&w=${encodeURIComponent(t)}`;
}

/** Link personal i pranimit të porosive (KDS) për një kamarier — /kitchen/...&w=token */
function buildWaiterKitchenUrl(baseUrl, client, webToken = "") {
  const url = buildKitchenUrl(baseUrl, client, "kitchen");
  const t = String(webToken || "").trim();
  if (!url || !t) return "";
  return `${url}&w=${encodeURIComponent(t)}`;
}

/** Shton waiter_url dhe kds_url për secilin kamarier (POS / owner panel). */
function enrichWaitersWithWebLinks(baseUrl, client, waiters = []) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const sharedWaiterUrl = client ? buildWaiterUrl(base, client, "") : "";
  return (waiters || []).map(w => {
    const token = String(w.web_token || "").trim();
    return {
      ...w,
      waiter_url: client && token ? buildWaiterUrl(base, client, token) : sharedWaiterUrl,
      kds_url: client && token ? buildWaiterKitchenUrl(base, client, token) : "",
    };
  });
}

/** Linket web për një lokal — sipas paketës (banak, kuzhinë, kamarier, kiosk, faqe). */
function buildClientWebLinks(baseUrl, client, packageTier) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const features = featuresForTier(packageTier);
  const links = {};
  if (!client?.kitchen_slug && !client?.id) return links;

  if (features.waiter) links.waiter_url = buildKitchenUrl(base, client, "waiter");
  if (features.kds) {
    links.bar_url = buildKitchenUrl(base, client, "bar");
    links.kitchen_url = buildKitchenUrl(base, client, "kitchen");
  }
  if (features.kiosk) links.kiosk_url = buildTableMenuUrl(base, client, 1);
  const slug = client.kitchen_slug || client.id;
  const prefix = storefrontPrefix(client);
  if (features.website) {
    links.public_page_url = `${base}/${prefix}/${encodeURIComponent(slug)}`;
    if (isShopStorefront(client)) {
      links.shop_page_url = links.public_page_url;
    } else {
      links.restaurant_page_url = links.public_page_url;
    }
  }
  if (features.online_orders && slug) {
    links.public_order_url = `${base}/${prefix}/${encodeURIComponent(slug)}/order`;
  }
  return links;
}

module.exports = {
  UUID_RE,
  generateKitchenKey,
  generateKitchenSlug,
  extractKitchenKey,
  verifyKitchenKey,
  getClientBySlugOrId,
  ensureKitchenCredentials,
  buildKitchenUrl,
  buildTableMenuUrl,
  buildWaiterUrl,
  buildWaiterKitchenUrl,
  enrichWaitersWithWebLinks,
  buildClientWebLinks,
};
