const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { getSupabase } = require("../db");
const {
  getSupabaseForProduct,
  findLicenseOnProductDbs,
  dbForLicenseId,
  dbForClientId,
  rememberLicenseHome,
  isDedicatedProduct,
} = require("../lib/productSupabase");
const { formatError, logRouteError } = require("../lib/errors");
const { normalizePackageTier } = require("../lib/packages");
const { generateKitchenKey, generateKitchenSlug, ensureKitchenCredentials, buildKitchenUrl, buildTableMenuUrl, buildClientWebLinks } = require("../lib/kitchenAccess");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const { featuresForTier } = require("../lib/packages");
const { todayISO, isExpired, addMonthsISO, addMonthsTimestamp } = require("../lib/licenseDates");
const { isLicenseUsable } = require("../lib/licenseEnforcement");
const { seedPosSettingsForClient, syncPosSettingsFromClient } = require("./receiptService");
const {
  resolveTerminalAccess,
  getTerminalSummaryForLicense,
  clearAllTerminals,
  countLicensesOverTerminalLimit,
  calcLicenseTotalPrice,
  insertTerminal,
  normalizeDeviceId,
} = require("./licenseTerminalService");

function pickLatestTerminal(terminals) {
  if (!Array.isArray(terminals) || !terminals.length) return null;
  return [...terminals].sort(
    (a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime(),
  )[0];
}

function enrichLicenseRowWithTerminals(lic, summary) {
  const latest = pickLatestTerminal(summary.terminals);
  const displayDeviceId =
    normalizeDeviceId(lic.device_id) || (latest?.device_id ? normalizeDeviceId(latest.device_id) : "");
  const hardware_id = resolveLicenseHardwareId(lic);
  return {
    ...lic,
    hardware_id,
    active_terminal_count: summary.active_terminal_count,
    max_terminals: summary.max_terminals,
    terminal_limit_reached: summary.limit_reached,
    terminal_over_limit: summary.over_limit,
    terminal_in_grace: summary.in_grace,
    terminal_grace_until: summary.grace_until,
    total_price: summary.total_price,
    terminals: summary.terminals,
    display_device_id: displayDeviceId,
    display_device_ids: (summary.terminals || []).map(t => t.device_id).filter(Boolean),
    device_hostname: lic.device_hostname || latest?.device_hostname || "",
    last_ip: lic.last_ip || latest?.last_ip || "",
    last_activated_at: lic.last_activated_at || latest?.last_seen_at || null,
  };
}

async function syncLicenseDeviceFromTerminals(licenseId, lic, summary) {
  const latest = pickLatestTerminal(summary.terminals);
  const deviceId = normalizeDeviceId(lic.device_id) || (latest ? normalizeDeviceId(latest.device_id) : "");
  if (!deviceId || normalizeDeviceId(lic.device_id) === deviceId) return;
  const hwKeep = resolveLicenseHardwareId(lic);
  const patch = {
    device_id: deviceId,
    last_validation_error: hwKeep ? encodeHwMeta(hwKeep) : "",
    ...(latest?.device_hostname ? { device_hostname: latest.device_hostname } : {}),
    ...(latest?.last_ip ? { last_ip: latest.last_ip } : {}),
    ...(latest?.last_seen_at ? { last_activated_at: latest.last_seen_at } : {}),
  };
  try {
    await patchLicenseMeta(licenseId, patch);
  } catch {
    /* best effort */
  }
}

function normalizeKey(key) {
  const raw = String(key || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(raw)) return raw;

  const parts = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  if (parts.length === 5 && parts[0] === parts[1] && parts.every(p => p.length === 4)) {
    return [parts[0], parts[2], parts[3], parts[4]].join("-");
  }
  if (parts.length === 4 && parts.every(p => p.length === 4)) return parts.join("-");

  const alnum = raw.replace(/[^A-Z0-9]/g, "");
  if (alnum.length === 16) return alnum.match(/.{1,4}/g).join("-");
  if (alnum.length >= 20) {
    const groups = alnum.match(/.{1,4}/g) || [];
    if (groups.length === 5 && groups[0] === groups[1]) {
      return [groups[0], groups[2], groups[3], groups[4]].join("-");
    }
  }
  return raw;
}

function compactKey(key) {
  return normalizeKey(key).replace(/-/g, "");
}

/** Shkronja të ngatërruara shpesh në çelësin e licencës (0/O, 1/I, …). */
function charsEquivalent(a, b) {
  if (a === b) return true;
  const pairs = [
    ["O", "0"],
    ["0", "O"],
    ["I", "1"],
    ["1", "I"],
    ["S", "5"],
    ["5", "S"],
  ];
  return pairs.some(([x, y]) => a === x && b === y);
}

function licenseKeysEquivalent(a, b) {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (compactKey(na) === compactKey(nb)) return true;
  const sa = na.split("-");
  const sb = nb.split("-");
  if (sa.length !== 4 || sb.length !== 4) return false;
  return sa.every((seg, i) => {
    if (seg.length !== sb[i].length) return false;
    return [...seg].every((ch, j) => charsEquivalent(ch, sb[i][j]));
  });
}

function licenseAppType(license) {
  if (license.app_type) return license.app_type;
  const clientTipi = license.clients?.tipi;
  if (clientTipi && clientTipi !== "tjeter") return clientTipi;
  return "restorant";
}

function generateLicenseKey() {
  const part = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).padEnd(4, "X");
  return `${part()}-${part()}-${part()}-${part()}`;
}

function generateDeviceId() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

async function provisionLicenseDevice(id, opts = {}) {
  const { db } = await dbForLicenseId(id);
  const force = opts.force === true;
  const { data: lic, error } = await db
    .from("licenses")
    .select("id, celesi, device_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!lic) throw new Error("Liçenca nuk u gjet.");

  const existing = normalizeDeviceId(lic.device_id);
  // Super Admin: force=true → gjenero ID të ri edhe nëse ekziston
  if (existing && !force) {
    return { celesi: lic.celesi, device_id: existing, created: false };
  }

  const deviceId = generateDeviceId();
  await updateLicense(id, { device_id: deviceId });
  return { celesi: lic.celesi, device_id: deviceId, created: true };
}

const LICENSE_WITH_CLIENT_SELECT =
  "*, clients(id, emri, adresa, telefoni, email, tipi, package_tier, kitchen_slug, kitchen_key)";

async function findLicenseByDeviceIdOnDb(db, id) {
  const { data: byPrimary, error } = await db
    .from("licenses")
    .select(LICENSE_WITH_CLIENT_SELECT)
    .eq("device_id", id)
    .order("last_activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (byPrimary) return byPrimary;

  const { data: term, error: termErr } = await db
    .from("license_terminals")
    .select("license_id")
    .eq("device_id", id)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (termErr || !term?.license_id) return null;
  const { data: lic } = await db
    .from("licenses")
    .select(LICENSE_WITH_CLIENT_SELECT)
    .eq("id", term.license_id)
    .maybeSingle();
  return lic || null;
}

async function findLicenseByDeviceId(deviceId) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return null;
  const found = await findLicenseOnProductDbs((db) => findLicenseByDeviceIdOnDb(db, id));
  return found.row;
}

async function findLicenseByKeyOnDb(db, normalized) {
  const { data, error } = await db
    .from("licenses")
    .select(LICENSE_WITH_CLIENT_SELECT)
    .eq("celesi", normalized)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: ilikeRows, error: ilikeErr } = await db
    .from("licenses")
    .select(LICENSE_WITH_CLIENT_SELECT)
    .ilike("celesi", normalized);
  if (ilikeErr) throw ilikeErr;
  if (ilikeRows?.length === 1) return ilikeRows[0];

  const { data: allRows, error: allErr } = await db.from("licenses").select(LICENSE_WITH_CLIENT_SELECT);
  if (allErr) throw allErr;
  const rows = allRows || [];

  const compact = compactKey(normalized);
  if (compact.length >= 8) {
    const exact = rows.find((row) => compactKey(row.celesi) === compact);
    if (exact) return exact;
  }

  const fuzzy = rows.filter((row) => licenseKeysEquivalent(normalized, row.celesi));
  if (fuzzy.length === 1) return fuzzy[0];
  return null;
}

async function findLicenseByKey(celesi) {
  const normalized = normalizeKey(celesi);
  if (!normalized) return null;
  const found = await findLicenseOnProductDbs((db) => findLicenseByKeyOnDb(db, normalized));
  return found.row;
}

function sanitizeClientIp(ip) {
  return String(ip || "").trim().split(",")[0].trim().slice(0, 64);
}

function sanitizeHostname(hostname) {
  return String(hostname || "").trim().slice(0, 128);
}

const OPTIONAL_LICENSE_META = [
  "device_hostname",
  "last_activated_at",
  "last_validation_at",
  "last_validation_error",
  "last_ip",
  "hardware_id",
  "activation_email",
];

function normalizeContactEmail(input) {
  const e = String(input || "").trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  return e.slice(0, 200);
}

async function saveActivationEmail(license, email) {
  const e = normalizeContactEmail(email);
  if (!e || !license?.id) return;
  try {
    await patchLicenseMeta(license.id, { activation_email: e });
  } catch {
    /* kolona mund të mungojë para migrimit */
  }
  if (license.client_id) {
    try {
      const { db } = await dbForClientId(license.client_id);
      const { data: client } = await db
        .from("clients")
        .select("id, email")
        .eq("id", license.client_id)
        .maybeSingle();
      if (client && !String(client.email || "").trim()) {
        await db.from("clients").update({ email: e }).eq("id", client.id);
      }
    } catch {
      /* ignore */
    }
  }
}

async function patchLicenseMeta(licenseId, patch) {
  const { db } = await dbForLicenseId(licenseId);
  let { error } = await db.from("licenses").update(patch).eq("id", licenseId);
  if (!error) return;

  const msg = String(error.message || error.details || "");
  /* Kolona hardware_id mungon — ruaj HW në last_validation_error si meta sync */
  if (/hardware_id|schema cache/i.test(msg) && patch.hardware_id != null) {
    const withMeta = { ...patch };
    delete withMeta.hardware_id;
    const existingErr = String(withMeta.last_validation_error || "");
    if (!existingErr || existingErr.startsWith(HW_META_PREFIX)) {
      withMeta.last_validation_error =
        encodeHwMeta(patch.hardware_id) || existingErr || "";
    }
    const retryHw = await db.from("licenses").update(withMeta).eq("id", licenseId);
    if (!retryHw.error) return;
    error = retryHw.error;
  }

  const optionalInPatch = OPTIONAL_LICENSE_META.filter((k) => k in patch);
  if (!optionalInPatch.length) throw error;

  const fallback = { ...patch };
  for (const k of optionalInPatch) delete fallback[k];
  /* Mos humb HW kur heqim hardware_id nga retry */
  if (patch.hardware_id && !("last_validation_error" in fallback)) {
    fallback.last_validation_error = encodeHwMeta(patch.hardware_id);
  }
  if (!Object.keys(fallback).length) {
    if (patch.hardware_id) {
      const onlyMeta = { last_validation_error: encodeHwMeta(patch.hardware_id) };
      const metaOnly = await db.from("licenses").update(onlyMeta).eq("id", licenseId);
      if (metaOnly.error) throw metaOnly.error;
      return;
    }
    return;
  }

  const retry = await db.from("licenses").update(fallback).eq("id", licenseId);
  if (retry.error) throw retry.error;
}

async function recordValidationFailure(license, code, message, client_ip) {
  const ip = sanitizeClientIp(client_ip);
  await patchLicenseMeta(license.id, {
    last_validation_at: new Date().toISOString(),
    last_validation_error: `${code}: ${message}`,
    ...(ip ? { last_ip: ip } : {}),
  });
}

function normalizeHardwareIdStored(input) {
  const hex = String(input || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase()
    .slice(0, 16);
  if (hex.length !== 16) return "";
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

const HW_META_PREFIX = "__LIC_HW__:";

function encodeHwMeta(hw) {
  const n = normalizeHardwareIdStored(hw);
  return n ? `${HW_META_PREFIX}${n}` : "";
}

function decodeHwMeta(raw) {
  const s = String(raw || "");
  if (!s.startsWith(HW_META_PREFIX)) return "";
  return normalizeHardwareIdStored(s.slice(HW_META_PREFIX.length));
}

/** ID 16 për licencë — nga kolona ose meta (kur kolona mungon). */
function resolveLicenseHardwareId(lic) {
  return (
    normalizeHardwareIdStored(lic?.hardware_id || "") ||
    decodeHwMeta(lic?.last_validation_error) ||
    ""
  );
}

/** Ruaj Hardware ID 16 nga POS (sipas device_id) — për admin Gjenero një shtypje. */
async function reportHardwareId({ device_id, hardware_id, celesi, contact_email, activation_email }) {
  const { ensureLicenseHardwareSchema } = require("../lib/ensureLicenseHardwareSchema");
  await ensureLicenseHardwareSchema();
  const hw = normalizeHardwareIdStored(hardware_id);
  if (!hw) {
    throw new Error("Hardware ID duhet 16 shenja hex (XXXX-XXXX-XXXX-XXXX).");
  }
  let license = null;
  const key = String(celesi || "").trim();
  if (key) {
    license = await findLicenseByKey(key);
  }
  if (!license && device_id) {
    license = await findLicenseByDeviceId(device_id);
  }
  if (!license) {
    return { ok: false, code: "NOT_FOUND", message: "Licenca nuk u gjet për këtë pajisje." };
  }
  try {
    await patchLicenseMeta(license.id, { hardware_id: hw });
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (!/hardware_id|schema cache/i.test(msg)) throw err;
    /* Kolona ende nuk ekziston — ruaj si meta që admin të shohë të njëjtën ID */
    await patchLicenseMeta(license.id, { last_validation_error: encodeHwMeta(hw) });
    await saveActivationEmail(license, contact_email || activation_email);
    return { ok: true, license_id: license.id, hardware_id: hw, stored: false };
  }
  await saveActivationEmail(license, contact_email || activation_email);
  return { ok: true, license_id: license.id, hardware_id: hw, stored: true };
}

async function validateLicense({
  celesi,
  device_id,
  app_type,
  hostname,
  client_ip,
  hardware_id,
  contact_email,
  activation_email,
}) {
  const license = await findLicenseByKey(celesi);
  if (!license) {
    return {
      valid: false,
      code: "NOT_FOUND",
      message: "Liçenca nuk u gjet. Kontrolloni çelësin (0 = numër, O = shkronjë).",
      force_logout: true,
      force_factory_reset: true,
    };
  }

  const REVOKED_MSG = "Licenca është çaktivizuar. Kontaktoni Revolution Invest.";
  const hwForCheck = normalizeHardwareIdStored(hardware_id) || resolveLicenseHardwareId(license);
  const hwControl = await getHardwareControl(license.id, hwForCheck);
  const wipePending =
    Boolean(license.force_factory_reset_at) || Boolean(hwControl?.wipe_requested_at);
  const FACTORY_RESET_CODES = new Set(["NOT_FOUND", "REVOKED", "EXPIRED"]);

  const fail = async (code, message) => {
    await recordValidationFailure(license, code, message, client_ip);
    const forceLogout = ["REVOKED", "SUSPENDED", "EXPIRED", "DEVICE_MISMATCH", "TERMINAL_LIMIT_EXCEEDED"].includes(code);
    return {
      valid: false,
      code,
      message,
      force_logout: forceLogout,
      force_factory_reset: wipePending || FACTORY_RESET_CODES.has(code),
      force_factory_reset_at: license.force_factory_reset_at || hwControl?.wipe_requested_at || null,
    };
  };

  if (license.statusi === "revokuar") {
    return fail("REVOKED", REVOKED_MSG);
  }
  if (hwControl?.revoked_at) {
    return fail("REVOKED", REVOKED_MSG);
  }
  if (license.statusi === "pezulluar") {
    return fail("SUSPENDED", "Liçenca është pezulluar.");
  }

  const usable = isLicenseUsable(license);
  if (!usable.ok) {
    return fail(usable.code, usable.message);
  }

  // app_type (kafene / restorant / bar / …) NUK bllokon më aktivizimin —
  // klienti zgjedh tipin e biznesit pa lidhje me app_type të liçencës.
  // (Ishin WRONG_APP kur app_type ≠ license.app_type)

  const deviceId = String(device_id || "").trim().toUpperCase();
  const host = sanitizeHostname(hostname);
  const ip = sanitizeClientIp(client_ip);
  const now = new Date().toISOString();

  const terminalAccess = await resolveTerminalAccess(license, deviceId, host, ip);
  if (!terminalAccess.allowed) {
    return fail(
      terminalAccess.code || "TERMINAL_LIMIT_EXCEEDED",
      terminalAccess.message || "Kontaktoni Revolution Invest për të shtuar terminale.",
    );
  }

  const hwStored = hwForCheck;
  const successPatch = {
    last_activated_at: now,
    last_validation_at: now,
    last_validation_error: hwStored && !normalizeHardwareIdStored(license.hardware_id || "")
      ? encodeHwMeta(hwStored)
      : "",
    ...(ip ? { last_ip: ip } : {}),
    ...(host ? { device_hostname: host } : {}),
    ...(normalizeHardwareIdStored(hardware_id) ? { hardware_id: normalizeHardwareIdStored(hardware_id) } : {}),
  };
  if (deviceId) {
    successPatch.device_id = deviceId;
  }

  await patchLicenseMeta(license.id, successPatch);
  if (deviceId) license.device_id = deviceId;
  if (host) license.device_hostname = host;

  const contactEmail = normalizeContactEmail(contact_email || activation_email);
  if (contactEmail) {
    await saveActivationEmail(license, contactEmail);
  }

  const terminalSummary = await getTerminalSummaryForLicense(license);
  const warning = Boolean(terminalAccess.warning);
  const message = warning ? terminalAccess.message : "Liçenca është aktive.";

  let kitchenSlug = license.clients?.kitchen_slug || "";
  let kitchenKey = license.clients?.kitchen_key || "";
  if (license.client_id) {
    try {
      const client = await ensureKitchenCredentials(
        license.clients || { id: license.client_id, emri: license.clients?.emri || "" },
      );
      kitchenSlug = client?.kitchen_slug || kitchenSlug;
      kitchenKey = client?.kitchen_key || kitchenKey;
    } catch (e) {
      logRouteError("validateLicense.ensureKitchenCredentials", e);
    }
  }

  return {
    valid: true,
    license_id: license.id,
    celesi: license.celesi,
    client_id: license.client_id,
    client_name: license.clients?.emri || "",
    kitchen_slug: kitchenSlug,
    kitchen_key: kitchenKey,
    package_tier: normalizePackageTier(license.clients?.package_tier),
    client_type: licenseAppType(license),
    device_id: license.device_id,
    device_hostname: license.device_hostname || host,
    last_activated_at: now,
    last_ip: ip,
    trial_active: Boolean(license.trial_ends_at && new Date(license.trial_ends_at) > new Date()),
    trial_ends_at: license.trial_ends_at || null,
    status: license.statusi,
    valid_from: license.data_fillimit,
    valid_until: license.data_skadimit,
    message,
    force_factory_reset: Boolean(license.force_factory_reset_at) || Boolean(hwControl?.wipe_requested_at),
    force_factory_reset_at: license.force_factory_reset_at || hwControl?.wipe_requested_at || null,
    terminal_warning: warning,
    terminal_code: terminalAccess.code || null,
    terminals_active: terminalSummary.active_terminal_count,
    terminals_max: terminalSummary.max_terminals,
    grace_until: terminalAccess.grace_until || terminalSummary.grace_until || null,
    ...buildClientWebLinks(getPublicAppOrigin(), {
      id: license.client_id,
      kitchen_slug: kitchenSlug,
      kitchen_key: kitchenKey,
    }, normalizePackageTier(license.clients?.package_tier)),
    features: featuresForTier(normalizePackageTier(license.clients?.package_tier)),
  };
}

async function getLicenseAccessLinks({ celesi, device_id, app_type, hostname, client_ip }) {
  const result = await validateLicense({
    celesi,
    device_id,
    app_type,
    hostname,
    client_ip,
  });
  if (!result.valid) {
    return {
      ok: false,
      valid: false,
      code: result.code,
      message: result.message,
    };
  }

  const slug = result.kitchen_slug || result.client_id || "";
  const key = result.kitchen_key || "";
  const client = { id: result.client_id, kitchen_slug: slug, kitchen_key: key };
  const links = buildClientWebLinks(getPublicAppOrigin(), client, result.package_tier);

  return {
    ok: true,
    valid: true,
    client_id: result.client_id,
    client_name: result.client_name,
    kitchen_slug: slug,
    kitchen_key: key,
    package_tier: result.package_tier,
    ...links,
  };
}

function normalizeClientRow(row) {
  if (!row) return row;
  return { ...row, package_tier: normalizePackageTier(row.package_tier) };
}

async function listClients(opts = {}) {
  const { normalizeProductLine } = require("../utils/productLine");
  const product = normalizeProductLine(opts.product || "kafene");
  const db = getSupabaseForProduct(product);
  let { data, error } = await db
    .from("clients")
    .select("*, licenses(count)")
    .order("created_at", { ascending: false });
  if (error) {
    const fallback = await db.from("clients").select("*").order("created_at", { ascending: false });
    if (fallback.error) throw fallback.error;
    data = fallback.data;
  }
  return (data || []).map(normalizeClientRow);
}

async function listLicenses(opts = {}) {
  const { normalizeProductLine } = require("../utils/productLine");
  const product = normalizeProductLine(opts.product || "kafene");
  const db = getSupabaseForProduct(product);
  const { data, error } = await db
    .from("licenses")
    .select("*, clients(id, emri, tipi, email, product_line)")
    .order("created_at", { ascending: false });
  if (error) {
    const fallback = await db
      .from("licenses")
      .select("*, clients(id, emri, tipi, email)")
      .order("created_at", { ascending: false });
    if (fallback.error) throw error;
    const rowsFb = fallback.data || [];
    return Promise.all(
      rowsFb.map(async (lic) => {
        try {
          const summary = await getTerminalSummaryForLicense(lic);
          await syncLicenseDeviceFromTerminals(lic.id, lic, summary);
          const merged = {
            ...lic,
            device_id: normalizeDeviceId(lic.device_id) || pickLatestTerminal(summary.terminals)?.device_id || lic.device_id,
          };
          return enrichLicenseRowWithTerminals(merged, summary);
        } catch {
          return {
            ...lic,
            hardware_id: resolveLicenseHardwareId(lic),
            active_terminal_count: lic.device_id ? 1 : 0,
            max_terminals: Number(lic.max_terminals) || 1,
            terminal_limit_reached: false,
            terminals: [],
            display_device_id: normalizeDeviceId(lic.device_id) || "",
            display_device_ids: lic.device_id ? [normalizeDeviceId(lic.device_id)] : [],
          };
        }
      }),
    );
  }

  const rows = data || [];
  const enriched = await Promise.all(
    rows.map(async lic => {
      try {
        const summary = await getTerminalSummaryForLicense(lic);
        await syncLicenseDeviceFromTerminals(lic.id, lic, summary);
        const merged = {
          ...lic,
          device_id: normalizeDeviceId(lic.device_id) || pickLatestTerminal(summary.terminals)?.device_id || lic.device_id,
        };
        return enrichLicenseRowWithTerminals(merged, summary);
      } catch {
        return {
          ...lic,
          hardware_id: resolveLicenseHardwareId(lic),
          active_terminal_count: lic.device_id ? 1 : 0,
          max_terminals: Number(lic.max_terminals) || 1,
          terminal_limit_reached: false,
          terminals: [],
          display_device_id: normalizeDeviceId(lic.device_id) || "",
          display_device_ids: lic.device_id ? [normalizeDeviceId(lic.device_id)] : [],
        };
      }
    }),
  );
  return enriched;
}

async function createClient(body) {
  const { assertClientTipi } = require("../utils/businessTipi");
  const { normalizeProductLine, toDbProductLine } = require("../utils/productLine");
  const requestedLine = normalizeProductLine(
    body.product_line || body.industry_type || body.product_category,
  );
  if (requestedLine === "security") {
    const err = new Error("Klientët Security regjistrohen vetëm në Supabase e Security, jo në POS.");
    err.code = "WRONG_SUPABASE";
    throw err;
  }
  const db = getSupabaseForProduct(requestedLine);
  const productLine = isDedicatedProduct(requestedLine)
    ? requestedLine
    : toDbProductLine(requestedLine);
  const row = {
    emri: String(body.emri || "").trim(),
    adresa: String(body.adresa || "").trim(),
    telefoni: String(body.telefoni || "").trim(),
    email: String(body.email || "").trim(),
    tipi: assertClientTipi(body.tipi || "restorant"),
    package_tier: normalizePackageTier(body.package_tier),
    kitchen_slug: generateKitchenSlug(body.emri || "lokal"),
    kitchen_key: generateKitchenKey(),
    product_line: productLine,
  };
  if (!row.emri) throw new Error("Emri i klientit është i detyrueshëm.");

  let { data, error } = await db.from("clients").insert(row).select().single();
  if (error && /product_line/i.test(error.message || "")) {
    delete row.product_line;
    ({ data, error } = await db.from("clients").insert(row).select().single());
  }
  if (error) {
    logRouteError("createClient", error, { row });
    if (String(error.message || "").includes("clients_package_tier_check")) {
      throw new Error(
        "Pakoja e zgjedhur nuk lejohet në DB. Ekzekutoni supabase/migrations/036_fix_clients_package_tier_check.sql.",
      );
    }
    throw error;
  }
  try {
    if (!isDedicatedProduct(requestedLine)) {
      await seedPosSettingsForClient(data);
    }
  } catch (seedErr) {
    console.warn("[createClient] pos_settings seed failed:", seedErr.message);
  }
  return data;
}

async function updateClient(id, body) {
  const hint = body.product_line || body.industry_type || body.product_category;
  const { db, product } = await dbForClientId(id, hint);
  const patch = {};
  if (body.emri != null) {
    patch.emri = String(body.emri).trim();
    if (!patch.emri) throw new Error("Emri i klientit është i detyrueshëm.");
  }
  if (body.tipi != null && String(body.tipi).trim() !== "") {
    const { assertClientTipi } = require("../utils/businessTipi");
    patch.tipi = assertClientTipi(body.tipi);
  }
  if (
    body.product_line != null
    || body.industry_type != null
    || body.product_category != null
  ) {
    const { normalizeProductLine } = require("../utils/productLine");
    const pl = normalizeProductLine(
      body.product_line || body.industry_type || body.product_category,
    );
    if (isDedicatedProduct(product) && (pl === "market" || pl === "hotel")) {
      patch.product_line = product;
    } else if (pl === "kafene" || pl === "security") {
      patch.product_line = pl;
    }
  }
  const tel = body.telefoni != null ? body.telefoni : body.telefon;
  if (tel != null) patch.telefoni = String(tel).trim();
  if (body.email != null) patch.email = String(body.email).trim().toLowerCase();
  if (body.adresa != null) patch.adresa = String(body.adresa).trim();
  if (typeof body.aktiv === "boolean") patch.aktiv = body.aktiv;
  if (Object.prototype.hasOwnProperty.call(body, "package_tier") && body.package_tier != null && body.package_tier !== "") {
    patch.package_tier = normalizePackageTier(body.package_tier);
  }
  if (Object.prototype.hasOwnProperty.call(body, "owner_group_id")) {
    const gid = body.owner_group_id;
    patch.owner_group_id = gid ? String(gid).trim() : null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "ai_monthly_token_limit")) {
    const raw = body.ai_monthly_token_limit;
    if (raw === null || raw === "" || raw === undefined) {
      patch.ai_monthly_token_limit = null;
    } else {
      const limit = Math.floor(Number(raw));
      if (!Number.isFinite(limit) || limit < 0) {
        throw new Error("Limiti mujor i tokenëve duhet të jetë numër ≥ 0 ose bosh (pa limit).");
      }
      patch.ai_monthly_token_limit = limit;
    }
  }

  if (!Object.keys(patch).length) {
    throw new Error("Nuk ka fusha për përditësim.");
  }

  async function doUpdate(p) {
    return db.from("clients").update(p).eq("id", id).select("*").single();
  }

  let { data, error } = await doUpdate(patch);

  // Kolona opsionale mund të mungojë para migrimit — hiqi dhe riprovo
  const optionalCols = ["product_line", "aktiv", "owner_group_id", "ai_monthly_token_limit", "package_tier"];
  let guard = 0;
  while (error && guard < 5) {
    guard += 1;
    const msg = String(error.message || error.details || "");
    const missing = optionalCols.find((col) => msg.includes(col));
    if (!missing || patch[missing] === undefined) break;
    delete patch[missing];
    if (!Object.keys(patch).length) break;
    ({ data, error } = await doUpdate(patch));
  }

  if (error) {
    if (String(error.message || "").includes("clients_package_tier_check")) {
      throw new Error(
        "Pakoja e zgjedhur nuk lejohet në DB. Ekzekutoni supabase/migrations/036_fix_clients_package_tier_check.sql.",
      );
    }
    if (String(error.message || "").includes("package_tier")) {
      throw new Error(
        "Kolona package_tier mungon në DB. Ekzekutoni migrimin supabase/migrations/009_saas_features.sql.",
      );
    }
    throw error;
  }
  if (!data) throw new Error("Klienti nuk u gjet.");
  try {
    if (!isDedicatedProduct(product)) {
      await syncPosSettingsFromClient(id);
    }
  } catch (syncErr) {
    console.warn("[updateClient] pos_settings sync failed:", syncErr.message);
  }
  return normalizeClientRow(data);
}

/** Fshin rreshta që mund të bllokojnë DELETE te clients (FK pa CASCADE në prod). */
async function deleteClientDependentRows(db, clientId) {
  const targets = [
    ["ai_usage_logs", "restaurant_id"],
    ["ingredients", "restaurant_id"],
    ["reservations", "restaurant_id"],
  ];
  for (const [table, column] of targets) {
    const { error } = await db.from(table).delete().eq(column, clientId);
    if (!error) continue;
    const msg = String(error.message || "");
    const missingTable = error.code === "42P01" || /does not exist/i.test(msg);
    if (!missingTable) throw error;
  }
}

async function deleteClient(id, productHint) {
  const { db } = await dbForClientId(id, productHint);
  await deleteClientDependentRows(db, id);
  // Urdhër wipe PARA fshirjes — heartbeat i fundit e merr force_factory_reset.
  try {
    await requestFactoryResetForClient(id);
  } catch (err) {
    console.warn("[deleteClient] factory reset flag:", err?.message || err);
  }
  // Licencat e klientit — fshi para rreshtit të klientit (FK)
  const { error: licErr } = await db.from("licenses").delete().eq("client_id", id);
  if (licErr) {
    const msg = String(licErr.message || "");
    const missingTable = licErr.code === "42P01" || /does not exist/i.test(msg);
    if (!missingTable) throw licErr;
  }
  await db.from("users").delete().eq("client_id", id).eq("roli", "client_admin");
  const { error } = await db.from("clients").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

async function regenerateKitchenAccess(id, productHint) {
  const { db } = await dbForClientId(id, productHint);
  const { data: client, error: findErr } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (findErr) throw findErr;
  if (!client) throw new Error("Klienti nuk u gjet.");

  const patch = {
    kitchen_slug: generateKitchenSlug(client.emri),
    kitchen_key: generateKitchenKey(),
  };

  const { data, error } = await db.from("clients").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

async function createClientOnboard(body, baseUrl) {
  const { createOwner } = require("./userService");

  const ownerEmri = String(body.owner_emri ?? "").trim();
  const ownerEmail = String(body.owner_email ?? "").trim().toLowerCase();
  const ownerPassword = String(body.owner_password ?? "").trim();

  if (!ownerEmri) throw new Error("Emri i pronarit është i detyrueshëm.");
  if (!ownerEmail) throw new Error("Email i pronarit është i detyrueshëm.");
  if (!ownerPassword || ownerPassword.length < 6) {
    throw new Error("Fjalëkalimi i pronarit min. 6 karaktere.");
  }

  let client = null;
  let license = null;
  try {
    client = await createClient({
      emri: body.emri,
      tipi: body.tipi,
      package_tier: body.package_tier,
      telefoni: body.telefoni,
      email: body.email,
      adresa: body.adresa,
    });

    license = await createLicense({
      client_id: client.id,
      app_type: body.app_type,
      muaj: body.muaj ?? 12,
      device_id: body.device_id || "",
      max_terminals: body.max_terminals,
      base_price: body.base_price,
      terminal_price: body.terminal_price,
    });

    const owner = await createOwner(
      {
        client_id: client.id,
        emri: ownerEmri,
        email: ownerEmail,
        password: ownerPassword,
      },
      baseUrl,
    );

    return { client, license, owner };
  } catch (e) {
    if (license?.id) {
      try {
        await deleteLicense(license.id);
      } catch {
        /* best effort */
      }
    }
    if (client?.id) {
      try {
        await deleteClient(client.id);
      } catch {
        /* best effort */
      }
    }
    throw e;
  }
}

async function createLicense(body) {
  if (!body.client_id) throw new Error("client_id mungon.");
  const { db, product } = await dbForClientId(body.client_id, body.product_line);
  const months = Number(body.muaj) || 12;
  const start = body.data_fillimit || todayISO();

  const { appTypeFromClientTipi } = require("../utils/businessTipi");
  const { normalizeProductLine, appTypeForProductLine } = require("../utils/productLine");
  let appType = body.app_type ? String(body.app_type).trim().toLowerCase() : "";
  const allowedApp = ["restorant", "kafene", "sekurim", "market"];
  const { data: client } = await db
    .from("clients")
    .select("tipi, product_line")
    .eq("id", body.client_id)
    .maybeSingle();
  const productLine = isDedicatedProduct(product)
    ? product
    : normalizeProductLine(
      body.product_line || client?.product_line || (appType === "sekurim" ? "security" : "kafene"),
    );
  if (!allowedApp.includes(appType)) {
    appType = appTypeForProductLine(productLine, client?.tipi)
      || (client?.tipi ? appTypeFromClientTipi(client.tipi) : "restorant");
  }

  const rawKey = String(body.celesi || "").trim();
  const celesi = rawKey
    ? normalizeKey(rawKey) || rawKey.toUpperCase().replace(/\s+/g, "")
    : generateLicenseKey();

  const hwRaw = body.hardware_id || body.hardwareId || "";
  const hwNorm = normalizeHardwareIdStored(hwRaw);
  // Nëse dërgohet HW 16 si device_id, ruaje si hardware_id (jo device_id 12)
  let deviceId = String(body.device_id || "").trim().toUpperCase().replace(/\s+/g, "");
  const deviceHex = deviceId.replace(/[^A-F0-9]/g, "");
  if (!hwNorm && deviceHex.length === 16) {
    deviceId = "";
  }

  const licenseType = String(body.license_type || body.licenseType || "").toLowerCase();
  const isTrial = licenseType === "trial";
  let trialEndsAt = null;
  if (body.trial_ends_at != null && String(body.trial_ends_at).trim() !== "") {
    trialEndsAt = body.trial_ends_at;
  } else if (isTrial) {
    // Trial i vërtetë: 7 ditë (jo 3 muaj default i vjetër)
    const d = new Date(`${start}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    trialEndsAt = d.toISOString();
  }
  // Licencë vjetore/e paguar: trial_ends_at = null (mos i numëro si trial)

  const row = {
    client_id: body.client_id,
    app_type: appType,
    product_line: productLine,
    celesi,
    device_id: deviceHex.length === 16 ? "" : deviceId,
    statusi: body.statusi || "aktive",
    data_fillimit: start,
    data_skadimit:
      body.data_skadimit
      || (isTrial && trialEndsAt ? String(trialEndsAt).slice(0, 10) : addMonthsISO(start, months)),
    trial_ends_at: trialEndsAt,
    max_terminals: Math.max(1, Number(body.max_terminals) || 1),
    terminal_price: Math.max(0, Number(body.terminal_price) || 0),
    base_price: Math.max(0, Number(body.base_price) || 0),
  };
  const hwToStore = hwNorm || (deviceHex.length === 16 ? normalizeHardwareIdStored(deviceHex) : "");
  if (hwToStore) row.hardware_id = hwToStore;

  let { data, error } = await db.from("licenses").insert(row).select("*, clients(emri, tipi)").single();
  if (error && /product_line/i.test(error.message || "")) {
    delete row.product_line;
    ({ data, error } = await db.from("licenses").insert(row).select("*, clients(emri, tipi)").single());
  }
  if (error && /hardware_id/i.test(error.message || "") && row.hardware_id) {
    row.last_validation_error = encodeHwMeta(row.hardware_id);
    delete row.hardware_id;
    ({ data, error } = await db.from("licenses").insert(row).select("*, clients(emri, tipi)").single());
  }
  if (error) throw error;
  if (data?.id) rememberLicenseHome(data.id, product);
  return data;
}

async function updateLicense(id, body) {
  const { db, product } = await dbForLicenseId(id, body.product_line);
  if (!isDedicatedProduct(product)) {
    const { ensureLicenseHardwareSchema } = require("../lib/ensureLicenseHardwareSchema");
    await ensureLicenseHardwareSchema().catch(() => false);
  }

  const patch = {};
  if (body.data_skadimit != null) patch.data_skadimit = String(body.data_skadimit).slice(0, 10);
  if (body.statusi != null) {
    const allowed = ["aktive", "skaduar", "revokuar", "pezulluar"];
    if (!allowed.includes(body.statusi)) throw new Error("Status i pavlefshëm.");
    patch.statusi = body.statusi;
  }
  if (body.device_id != null) {
    // Super Admin: çdo vlerë e lirë (pa limit gjatësie / formati)
    // Vetëm device_id 12 (terminale) — mos ruaj Hardware ID 16 këtu
    const rawDev = String(body.device_id).trim().toUpperCase().replace(/\s+/g, "");
    const hexDev = rawDev.replace(/[^A-F0-9]/g, "");
    if (hexDev.length === 16) {
      patch.hardware_id = normalizeHardwareIdStored(hexDev);
    } else {
      patch.device_id = rawDev;
      /* Mos fshi __LIC_HW__ meta — përndryshe panel↔telefon humbin ID 16 */
      if (patch.device_id) {
        patch.last_activated_at = new Date().toISOString();
      }
    }
  }
  if (body.hardware_id != null) {
    const hw = normalizeHardwareIdStored(body.hardware_id);
    if (String(body.hardware_id).trim() && !hw) {
      throw new Error("Hardware ID duhet 16 shenja (XXXX-XXXX-XXXX-XXXX).");
    }
    patch.hardware_id = hw;
  }
  if (body.celesi != null) {
    // Super Admin: çelës i plotë i editueshëm — pa regex / pa format të detyruar
    const raw = String(body.celesi || "").trim();
    if (!raw) throw new Error("Çelësi i licencës nuk mund të jetë bosh.");
    const celesi = normalizeKey(raw) || raw.toUpperCase().replace(/\s+/g, "");
    const dup = await findLicenseByKey(celesi);
    if (dup && dup.id !== id) {
      throw new Error("Ky kod licencë përdoret tashmë nga një klient tjetër.");
    }
    patch.celesi = celesi;
  }
  if (body.app_type != null) {
    const allowedApp = ["restorant", "kafene", "sekurim", "market"];
    const appType = String(body.app_type).trim().toLowerCase();
    if (!allowedApp.includes(appType)) throw new Error(`Tipi i aplikacionit i pavlefshëm: ${body.app_type}`);
    patch.app_type = appType;
  }
  if (body.product_line != null) {
    const { normalizeProductLine } = require("../utils/productLine");
    const pl = normalizeProductLine(body.product_line);
    patch.product_line = isDedicatedProduct(product)
      ? product
      : (pl === "security" ? "security" : "kafene");
  }
  if (body.max_terminals != null) {
    patch.max_terminals = Math.max(1, Math.min(99, Number(body.max_terminals) || 1));
  }
  if (body.terminal_price != null) {
    patch.terminal_price = Math.max(0, Number(body.terminal_price) || 0);
  }
  if (body.base_price != null) {
    patch.base_price = Math.max(0, Number(body.base_price) || 0);
  }
  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  async function doUpdate(p) {
    return db.from("licenses").update(p).eq("id", id).select("*, clients(emri, tipi)").single();
  }

  let { data, error } = await doUpdate(patch);

  /* Kolona hardware_id mund të mungojë ende — ruaj çelësin + meta HW për sync panel↔telefon */
  if (error && patch.hardware_id != null) {
    const msg = String(error.message || error.details || "");
    if (/hardware_id|schema cache/i.test(msg)) {
      const fallback = { ...patch };
      delete fallback.hardware_id;
      fallback.last_validation_error = encodeHwMeta(patch.hardware_id);
      if (Object.keys(fallback).length) {
        ({ data, error } = await doUpdate(fallback));
      }
    }
  }

  if (error) throw error;
  if (!data) throw new Error("Liçenca nuk u gjet.");
  if (data && !data.hardware_id && patch.hardware_id) {
    data.hardware_id = patch.hardware_id;
  } else if (data) {
    data.hardware_id = resolveLicenseHardwareId(data);
  }

  if (patch.device_id) {
    try {
      await insertTerminal(id, patch.device_id, { now: patch.last_activated_at });
    } catch (termErr) {
      console.warn("[updateLicense] terminal sync:", termErr.message);
    }
  }

  return data;
}

async function deleteLicense(id) {
  const { db } = await dbForLicenseId(id);
  const { error } = await db.from("licenses").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

async function updateLicenseStatus(id, statusi) {
  const { db } = await dbForLicenseId(id);
  const now = new Date().toISOString();
  const patch = { statusi, updated_at: now };

  if (statusi === "pezulluar" || statusi === "revokuar" || statusi === "skaduar") {
    patch.force_logout_at = now;
    patch.blocked_at = now;
  } else if (statusi === "aktive") {
    patch.blocked_at = null;
  }

  const { data, error } = await db
    .from("licenses")
    .update(patch)
    .eq("id", id)
    .select("*, clients(emri, tipi)")
    .single();
  if (error) throw error;
  return data;
}

async function blockLicense(id) {
  return updateLicenseStatus(id, "pezulluar");
}

async function unblockLicense(id) {
  return updateLicenseStatus(id, "aktive");
}

async function resetLicenseDevice(id) {
  const licenseId = String(id || "").trim();
  if (!licenseId) throw new Error("ID e liçencës mungon.");

  await clearAllTerminals(licenseId);

  const { db } = await dbForLicenseId(licenseId);
  const patch = {
    device_id: "",
    device_hostname: "",
    last_ip: "",
    last_validation_error: "",
    last_activated_at: null,
    terminal_limit_grace_at: null,
  };
  const { data, error } = await db
    .from("licenses")
    .update(patch)
    .eq("id", licenseId)
    .select("*, clients(emri, tipi)")
    .single();
  if (error) {
    const { data: fallback, error: err2 } = await db
      .from("licenses")
      .update({ device_id: "", last_validation_error: "" })
      .eq("id", licenseId)
      .select("*, clients(emri, tipi)")
      .single();
    if (err2) throw err2;
    if (!fallback) throw new Error("Liçenca nuk u gjet.");
    return fallback;
  }
  if (!data) throw new Error("Liçenca nuk u gjet.");
  return data;
}

/** Super Admin: urdhëron POS që të bëjë Rivendos si të re (lokalisht). */
async function requestFactoryResetForClient(clientId, productHint) {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("ID e klientit mungon.");
  const { db } = await dbForClientId(id, productHint);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("licenses")
    .update({ force_factory_reset_at: now, updated_at: now })
    .eq("client_id", id)
    .select("id, celesi");
  if (error) throw error;
  return { ok: true, licenses_flagged: (data || []).length, at: now };
}

async function getHardwareControl(licenseId, hardwareId) {
  const hw = normalizeHardwareIdStored(hardwareId);
  if (!licenseId || !hw) return null;
  const { db } = await dbForLicenseId(licenseId);
  const { data, error } = await db
    .from("license_hardware_controls")
    .select("id, license_id, hardware_id, revoked_at, wipe_requested_at, reason")
    .eq("license_id", licenseId)
    .eq("hardware_id", hw)
    .maybeSingle();
  if (error) {
    if (/license_hardware_controls|schema cache|does not exist/i.test(String(error.message || ""))) {
      return null;
    }
    throw error;
  }
  return data || null;
}

async function upsertHardwareControl(licenseId, hardwareId, patch) {
  const hw = normalizeHardwareIdStored(hardwareId);
  if (!licenseId || !hw) throw new Error("Hardware ID mungon.");
  const { db } = await dbForLicenseId(licenseId);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("license_hardware_controls")
    .upsert(
      {
        license_id: licenseId,
        hardware_id: hw,
        ...patch,
        updated_at: now,
      },
      { onConflict: "license_id,hardware_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function writeRemoteAudit({ licenseId, hardwareId, action, reason, actor }) {
  const { db } = licenseId ? await dbForLicenseId(licenseId) : { db: getSupabase() };
  const { error } = await db.from("license_remote_audit").insert({
    license_id: licenseId || null,
    hardware_id: normalizeHardwareIdStored(hardwareId) || null,
    action: String(action || "").trim(),
    reason: String(reason || "").trim(),
    actor_user_id: actor?.id || null,
    actor_email: actor?.email || null,
  });
  if (error && !/license_remote_audit|schema cache|does not exist/i.test(String(error.message || ""))) {
    throw error;
  }
}

async function loadLicenseForRemoteControl(licenseId) {
  const id = String(licenseId || "").trim();
  if (!id) throw new Error("ID e liçencës mungon.");
  try {
    const { ensureLicenseHardwareSchema } = require("../lib/ensureLicenseHardwareSchema");
    await ensureLicenseHardwareSchema();
  } catch {
    /* ignore — vazhdo edhe pa kolonën hardware_id */
  }
  const { db } = await dbForLicenseId(id);
  let { data: lic, error } = await db
    .from("licenses")
    .select("id, celesi, hardware_id, statusi, last_validation_error")
    .eq("id", id)
    .maybeSingle();
  if (error && /hardware_id|schema cache/i.test(String(error.message || ""))) {
    const retry = await db
      .from("licenses")
      .select("id, celesi, statusi, last_validation_error")
      .eq("id", id)
      .maybeSingle();
    lic = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  if (!lic) throw new Error("Liçenca nuk u gjet.");
  return lic;
}

/**
 * Çaktivizo menjëherë — license-wide dhe/ose Hardware ID specifik.
 * Heartbeat → POS force_logout me REVOKED.
 */
async function revokeLicenseRemote(licenseId, { hardwareId, reason, actor } = {}) {
  const lic = await loadLicenseForRemoteControl(licenseId);
  const id = lic.id;
  const hw = normalizeHardwareIdStored(hardwareId) || resolveLicenseHardwareId(lic);
  const now = new Date().toISOString();
  const why = String(reason || "").trim();

  /* Së pari statusi — kjo e mbyll POS edhe nëse tabela per-HW dështon */
  const license = await updateLicenseStatus(id, "revokuar");

  if (hw) {
    try {
      await upsertHardwareControl(id, hw, {
        revoked_at: now,
        reason: why,
      });
    } catch (err) {
      console.warn("[revokeLicenseRemote] hardware control:", err?.message || err);
    }
  }

  await writeRemoteAudit({
    licenseId: id,
    hardwareId: hw,
    action: "revoke",
    reason: why,
    actor,
  });
  return { ok: true, license, hardware_id: hw || null };
}

/** Riaktivizo pas çaktivizimit. */
async function reactivateLicenseRemote(licenseId, { hardwareId, reason, actor } = {}) {
  const lic = await loadLicenseForRemoteControl(licenseId);
  const id = lic.id;
  const { db } = await dbForLicenseId(id);
  const hw = normalizeHardwareIdStored(hardwareId) || resolveLicenseHardwareId(lic);
  const why = String(reason || "").trim();

  const license = await updateLicenseStatus(id, "aktive");

  try {
    if (hw) {
      await upsertHardwareControl(id, hw, {
        revoked_at: null,
        reason: why,
      });
    } else {
      await db
        .from("license_hardware_controls")
        .update({ revoked_at: null, updated_at: new Date().toISOString() })
        .eq("license_id", id);
    }
  } catch (err) {
    console.warn("[reactivateLicenseRemote] hardware control:", err?.message || err);
  }

  await writeRemoteAudit({
    licenseId: id,
    hardwareId: hw,
    action: "reactivate",
    reason: why,
    actor,
  });
  return { ok: true, license, hardware_id: hw || null };
}

/**
 * Fshi të dhënat lokale (factory reset) — NUK çaktivizon licencën.
 * Kërkon confirm === "FSHI TE DHENAT".
 */
async function requestWipeDataForLicense(licenseId, { hardwareId, reason, confirm, actor } = {}) {
  const confirmOk = String(confirm || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (confirmOk !== "FSHI TE DHENAT") {
    throw new Error('Shkruani FSHI TE DHENAT për të konfirmuar.');
  }
  const lic = await loadLicenseForRemoteControl(licenseId);
  const id = lic.id;
  const now = new Date().toISOString();
  const hw = normalizeHardwareIdStored(hardwareId) || resolveLicenseHardwareId(lic);
  const why = String(reason || "").trim();

  await patchLicenseMeta(id, { force_factory_reset_at: now });
  if (hw) {
    try {
      await upsertHardwareControl(id, hw, {
        wipe_requested_at: now,
        reason: why,
      });
    } catch (err) {
      console.warn("[requestWipeDataForLicense] hardware control:", err?.message || err);
    }
  }

  await writeRemoteAudit({
    licenseId: id,
    hardwareId: hw,
    action: "wipe_data",
    reason: why,
    actor,
  });
  return { ok: true, license_id: id, hardware_id: hw || null, force_factory_reset_at: now };
}

/** POS: pas urdhrit, pastro flag-un që të mos përsëritet. */
async function ackFactoryResetByKey(celesi, hardwareId) {
  const license = await findLicenseByKey(celesi);
  if (!license) throw new Error("Liçenca nuk u gjet.");
  await patchLicenseMeta(license.id, { force_factory_reset_at: null });
  const hw = normalizeHardwareIdStored(hardwareId) || resolveLicenseHardwareId(license);
  if (hw) {
    try {
      await upsertHardwareControl(license.id, hw, { wipe_requested_at: null });
    } catch {
      /* ignore if migration not applied */
    }
  }
  return { ok: true, license_id: license.id };
}

async function findUserByEmail(email) {
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("email", String(email).trim().toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function verifyUserPassword(user, password) {
  if (!user?.passwordi) return false;
  return bcrypt.compare(password, user.passwordi);
}

async function ensureSuperAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || "admin@revolutioninvest.com").toLowerCase();
  const existing = await findUserByEmail(email);
  if (existing) return existing;

  const password = process.env.SUPER_ADMIN_PASSWORD || "Revolution2026!";
  const hash = await bcrypt.hash(password, 12);
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .insert({
      client_id: null,
      emri: process.env.SUPER_ADMIN_NAME || "Super Admin",
      email,
      passwordi: hash,
      roli: "super_admin",
      aktiv: true,
    })
    .select()
    .single();

  if (error) throw error;
  console.log(`  👤 Super Admin u krijua: ${email}`);
  return data;
}

async function listLicensesForClient(clientId, productHint) {
  const { db } = await dbForClientId(clientId, productHint);
  const { data, error } = await db
    .from("licenses")
    .select(
      "id, celesi, device_id, device_hostname, statusi, app_type, data_fillimit, data_skadimit, last_activated_at, last_validation_error",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function collectOwnerLicenseClientIds(clientId, userId) {
  const ids = [];
  const push = id => {
    const v = String(id || "").trim();
    if (v && !ids.includes(v)) ids.push(v);
  };
  push(clientId);
  if (!userId) return ids;

  try {
    const { listLocationsForUser, getUserRow } = require("./ownerGroupService");
    const { locations } = await listLocationsForUser(userId, clientId);
    for (const loc of locations || []) push(loc.id);

    const user = await getUserRow(userId);
    const email = String(user?.email || "").trim().toLowerCase();
    if (email) {
      const db = getSupabase();
      const { data: byEmail } = await db
        .from("clients")
        .select("id")
        .eq("email", email);
      for (const row of byEmail || []) push(row.id);
    }
  } catch {
    /* ignore */
  }
  return ids;
}

function emptyOwnerLicenseView(message) {
  return {
    activated: false,
    machine_id: "",
    has_license: false,
    license_key: "",
    message: message || "Nuk ka licencë për lokalin tuaj. Kontaktoni administratorin.",
    terminals: [],
    active_terminal_count: 0,
    max_terminals: 1,
  };
}

async function buildOwnerLicenseViewFromPrimary(primary, licenseClientId) {
  const fullLicense = await findLicenseByKey(primary.celesi);
  const terminalSummary = fullLicense
    ? await getTerminalSummaryForLicense(fullLicense)
    : {
        terminals: [],
        active_terminal_count: primary.device_id ? 1 : 0,
        max_terminals: 1,
        limit_reached: false,
        over_limit: false,
        in_grace: false,
        grace_until: null,
        total_price: 0,
      };

  const expired = isExpired(primary.data_skadimit);
  const revoked = primary.statusi === "revokuar" || primary.statusi === "pezulluar";
  const deviceId = String(primary.device_id || "").trim().toUpperCase();
  const hasActiveTerminal = terminalSummary.active_terminal_count > 0;
  const activated = primary.statusi === "aktive" && !expired && !revoked && hasActiveTerminal;

  let message = "Licenca nuk është aktive.";
  if (revoked) message = primary.statusi === "revokuar" ? "Licenca është revokuar." : "Licenca është pezulluar.";
  else if (expired) message = "Licenca ka skaduar.";
  else if (!hasActiveTerminal) {
    message = "Vendosni çelësin në kompjuterin POS (Admin → Licenca). Terminalet shfaqen këtu pas aktivizimit.";
  } else if (terminalSummary.over_limit && terminalSummary.in_grace) {
    message = "Keni arritur limitin e terminaleve — periodë prove 24 orë. Kontaktoni Revolution Invest.";
  } else if (terminalSummary.limit_reached) {
    message = "Keni arritur limitin e terminaleve. Kontaktoni Revolution Invest për terminale shtesë.";
  } else if (activated) {
    message = "Licenca është aktive për pajisjet POS.";
  }

  return {
    activated,
    machine_id: deviceId,
    has_license: true,
    license_key: primary.celesi,
    license_client_id: licenseClientId,
    statusi: primary.statusi,
    app_type: primary.app_type,
    valid_until: primary.data_skadimit,
    last_activated_at: primary.last_activated_at,
    message,
    terminals: terminalSummary.terminals,
    active_terminal_count: terminalSummary.active_terminal_count,
    max_terminals: terminalSummary.max_terminals,
    terminal_limit_reached: terminalSummary.limit_reached,
    terminal_over_limit: terminalSummary.over_limit,
    terminal_in_grace: terminalSummary.in_grace,
    terminal_grace_until: terminalSummary.grace_until,
    base_price: terminalSummary.base_price,
    terminal_price: terminalSummary.terminal_price,
    total_price: terminalSummary.total_price,
  };
}

async function getOwnerLicenseView(clientId, { userId } = {}) {
  const candidateIds = await collectOwnerLicenseClientIds(clientId, userId);

  for (const cid of candidateIds) {
    const licenses = await listLicensesForClient(cid);
    const primary = licenses.find(l => l.statusi === "aktive") || licenses[0];
    if (primary) {
      return buildOwnerLicenseViewFromPrimary(primary, cid);
    }
  }

  return emptyOwnerLicenseView();
}

async function verifyOwnerLicenseKey(clientId, licenseKey, { userId } = {}) {
  const normalized = normalizeKey(licenseKey);
  if (!normalized) throw new Error("Shkruani çelësin e licencës.");
  const license = await findLicenseByKey(normalized);
  if (!license) throw new Error("Çelësi i licencës nuk u gjet.");

  const candidateIds = await collectOwnerLicenseClientIds(clientId, userId);
  if (!candidateIds.includes(license.client_id)) {
    throw new Error("Ky çelës nuk i përket lokalit tuaj.");
  }

  return getOwnerLicenseView(license.client_id, { userId });
}

async function getDashboardStats() {
  const db = getSupabase();
  const [clients, licenses] = await Promise.all([
    db.from("clients").select("id", { count: "exact", head: true }),
    db.from("licenses").select("id, statusi"),
  ]);
  const lic = licenses.data || [];
  let terminal_limit_clients = 0;
  try {
    terminal_limit_clients = await countLicensesOverTerminalLimit();
  } catch {
    terminal_limit_clients = 0;
  }
  return {
    clients_total: clients.count || 0,
    licenses_total: lic.length,
    licenses_active: lic.filter(l => l.statusi === "aktive").length,
    licenses_expired: lic.filter(l => l.statusi === "skaduar").length,
    licenses_revoked: lic.filter(l => l.statusi === "revokuar").length,
    terminal_limit_clients,
  };
}

module.exports = {
  normalizeKey,
  findLicenseByKey,
  findLicenseByDeviceId,
  generateLicenseKey,
  generateDeviceId,
  provisionLicenseDevice,
  validateLicense,
  reportHardwareId,
  normalizeHardwareIdStored,
  resolveLicenseHardwareId,
  getLicenseAccessLinks,
  listClients,
  listLicenses,
  createClient,
  createClientOnboard,
  updateClient,
  deleteClient,
  regenerateKitchenAccess,
  createLicense,
  updateLicense,
  deleteLicense,
  updateLicenseStatus,
  blockLicense,
  unblockLicense,
  resetLicenseDevice,
  requestFactoryResetForClient,
  requestWipeDataForLicense,
  revokeLicenseRemote,
  reactivateLicenseRemote,
  ackFactoryResetByKey,
  findUserByEmail,
  verifyUserPassword,
  todayISO,
  isExpired,
  ensureSuperAdmin,
  getDashboardStats,
  listLicensesForClient,
  getOwnerLicenseView,
  verifyOwnerLicenseKey,
  calcLicenseTotalPrice,
};
