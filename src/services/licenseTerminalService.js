const { dbForLicenseId, getSupabaseForProduct } = require("../lib/productSupabase");

/** Pa shtim terminali të ri gjatë grace — vetëm mesazh. Overflow i ri = bllokim. */
const TERMINAL_GRACE_MS = 2 * 60 * 60 * 1000;

function normalizeDeviceId(deviceId) {
  return String(deviceId || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isMissingRelation(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || error?.details || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache|Could not find the table/i.test(msg)
  );
}

function getMaxTerminals(license) {
  return Math.max(1, Number(license?.max_terminals) || 1);
}

function getGraceState(license) {
  const raw = license?.terminal_limit_grace_at;
  if (!raw) return { started: false, withinGrace: false, graceUntil: null };
  const startedAt = new Date(raw).getTime();
  if (!Number.isFinite(startedAt)) return { started: false, withinGrace: false, graceUntil: null };
  const graceUntil = startedAt + TERMINAL_GRACE_MS;
  return {
    started: true,
    withinGrace: Date.now() < graceUntil,
    graceUntil: new Date(graceUntil).toISOString(),
  };
}

function terminalLimitMessage(graceUntil) {
  const until = graceUntil
    ? new Date(graceUntil).toLocaleString("sq-AL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return until
    ? `Keni arritur limitin e terminaleve. Kontaktoni Revolution Invest për të shtuar terminale. Perioda e provës deri më ${until}.`
    : "Keni arritur limitin e terminaleve. Kontaktoni Revolution Invest për të shtuar terminale.";
}

function mapTerminalRow(row) {
  return {
    id: row.id,
    device_id: row.device_id,
    device_hostname: row.device_hostname || "",
    last_ip: row.last_ip || "",
    first_activated_at: row.first_activated_at,
    last_seen_at: row.last_seen_at,
  };
}

async function dbOf(licenseId) {
  const { db } = await dbForLicenseId(licenseId);
  return db;
}

async function listTerminalsOrdered(licenseId) {
  const db = await dbOf(licenseId);
  const { data, error } = await db
    .from("license_terminals")
    .select("id, device_id, device_hostname, last_ip, first_activated_at, last_seen_at")
    .eq("license_id", licenseId)
    .order("first_activated_at", { ascending: true });
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data || []).map(mapTerminalRow);
}

async function migrateLegacyTerminal(license) {
  const deviceId = normalizeDeviceId(license.device_id);
  if (!deviceId) return;

  const db = await dbOf(license.id);
  const { count, error: countErr } = await db
    .from("license_terminals")
    .select("id", { count: "exact", head: true })
    .eq("license_id", license.id);
  if (countErr) throw countErr;
  if ((count || 0) > 0) return;

  const now = license.last_activated_at || new Date().toISOString();
  await db.from("license_terminals").insert({
    license_id: license.id,
    device_id: deviceId,
    device_hostname: license.device_hostname || "",
    last_ip: license.last_ip || "",
    first_activated_at: now,
    last_seen_at: license.last_validation_at || now,
  });
}

async function touchTerminal(licenseId, deviceId, { hostname = "", ip = "", now = null } = {}) {
  const db = await dbOf(licenseId);
  const ts = now || new Date().toISOString();
  const id = normalizeDeviceId(deviceId);
  const { error } = await db
    .from("license_terminals")
    .update({
      last_seen_at: ts,
      ...(hostname ? { device_hostname: String(hostname).trim().slice(0, 128) } : {}),
      ...(ip ? { last_ip: String(ip).trim().slice(0, 64) } : {}),
    })
    .eq("license_id", licenseId)
    .eq("device_id", id);
  if (error) throw error;
}

async function insertTerminal(licenseId, deviceId, { hostname = "", ip = "", now = null } = {}) {
  const db = await dbOf(licenseId);
  const ts = now || new Date().toISOString();
  const id = normalizeDeviceId(deviceId);
  const { error } = await db.from("license_terminals").upsert(
    {
      license_id: licenseId,
      device_id: id,
      device_hostname: String(hostname || "").trim().slice(0, 128),
      last_ip: String(ip || "").trim().slice(0, 64),
      first_activated_at: ts,
      last_seen_at: ts,
    },
    { onConflict: "license_id,device_id" },
  );
  if (error) throw error;
}

async function clearTerminalLimitGrace(licenseId) {
  const db = await dbOf(licenseId);
  await db.from("licenses").update({ terminal_limit_grace_at: null }).eq("id", licenseId);
}

async function startTerminalLimitGrace(licenseId) {
  const db = await dbOf(licenseId);
  const now = new Date().toISOString();
  const { data } = await db
    .from("licenses")
    .select("terminal_limit_grace_at")
    .eq("id", licenseId)
    .maybeSingle();
  if (!data?.terminal_limit_grace_at) {
    await db.from("licenses").update({ terminal_limit_grace_at: now }).eq("id", licenseId);
    return now;
  }
  return data.terminal_limit_grace_at;
}

async function clearAllTerminals(licenseId) {
  const db = await dbOf(licenseId);
  const { error } = await db.from("license_terminals").delete().eq("license_id", licenseId);
  if (error && !isMissingRelation(error)) throw error;
  await clearTerminalLimitGrace(licenseId);
}

function blockedResult(activeCount, maxTerminals) {
  return {
    allowed: false,
    code: "TERMINAL_LIMIT_EXCEEDED",
    message: "Kontaktoni Revolution Invest për të shtuar terminale.",
    force_logout: true,
    active_count: activeCount,
    max_terminals: maxTerminals,
  };
}

async function resolveTerminalAccess(license, deviceId, hostname, ip, hardwareId) {
  const id = normalizeDeviceId(deviceId);
  /* 1 PC = 1 çelës: pa device_id → refuzo (mos anashkalo) */
  if (!id) {
    return {
      allowed: false,
      code: "DEVICE_REQUIRED",
      message: "Mungon ID e pajisjes. Riaktivizoni licencën.",
      force_logout: true,
      active_count: 0,
      max_terminals: getMaxTerminals(license),
    };
  }

  const maxTerminals = getMaxTerminals(license);
  let terminals = await listTerminalsOrdered(license.id);
  let slotIndex = terminals.findIndex((t) => t.device_id === id);

  if (slotIndex < 0 && terminals.length === 0 && normalizeDeviceId(license.device_id) === id) {
    await migrateLegacyTerminal(license);
    terminals = await listTerminalsOrdered(license.id);
    slotIndex = terminals.findIndex((t) => t.device_id === id);
  }

  if (slotIndex >= 0) {
    await touchTerminal(license.id, id, { hostname, ip });
    terminals = await listTerminalsOrdered(license.id);
    slotIndex = terminals.findIndex((t) => t.device_id === id);
    if (terminals.length <= maxTerminals) await clearTerminalLimitGrace(license.id);

    const overSlot = slotIndex >= maxTerminals;
    return {
      allowed: true,
      active_count: terminals.length,
      max_terminals: maxTerminals,
      slot: slotIndex + 1,
      ...(overSlot
        ? {
            warning: true,
            code: "TERMINAL_OVERFLOW",
            message:
              "Terminali juaj është i regjistruar. Kontaktoni Revolution Invest nëse duhen më shumë pajisje.",
          }
        : {}),
    };
  }

  const hwReq = String(hardwareId || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase().slice(0, 16);
  const hwLic = String(license.hardware_id || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase().slice(0, 16);
  const sameHardware = hwReq.length === 16 && hwLic.length === 16 && hwReq === hwLic;
  const takeOver =
    maxTerminals <= 1
    || !normalizeDeviceId(license.device_id)
    || sameHardware;

  if (terminals.length >= maxTerminals && takeOver) {
    await clearAllTerminals(license.id);
    await insertTerminal(license.id, id, { hostname, ip });
    return {
      allowed: true,
      is_new: true,
      active_count: 1,
      max_terminals: maxTerminals,
    };
  }

  if (terminals.length < maxTerminals) {
    await insertTerminal(license.id, id, { hostname, ip });
    await clearTerminalLimitGrace(license.id);
    return {
      allowed: true,
      is_new: true,
      active_count: terminals.length + 1,
      max_terminals: maxTerminals,
    };
  }

  await startTerminalLimitGrace(license.id);
  return blockedResult(terminals.length, maxTerminals);
}

async function getTerminalSummaryForLicense(license) {
  await migrateLegacyTerminal(license);
  const terminals = await listTerminalsOrdered(license.id);
  const maxTerminals = getMaxTerminals(license);
  const activeCount = terminals.length;
  const grace = getGraceState(license);
  const limitReached = activeCount >= maxTerminals;
  const overLimit = activeCount > maxTerminals;

  return {
    max_terminals: maxTerminals,
    active_terminal_count: activeCount,
    terminal_price: Number(license.terminal_price) || 0,
    base_price: Number(license.base_price) || 0,
    total_price:
      (Number(license.base_price) || 0) +
      Math.max(0, maxTerminals - 1) * (Number(license.terminal_price) || 0),
    limit_reached: limitReached,
    over_limit: overLimit,
    in_grace: overLimit && grace.withinGrace,
    grace_until: grace.graceUntil,
    terminals,
  };
}

async function countOverLimitOnDb(db) {
  const { data: licenses, error } = await db
    .from("licenses")
    .select("id, max_terminals, terminal_limit_grace_at, statusi");
  if (error) throw error;

  let count = 0;
  for (const lic of licenses || []) {
    if (lic.statusi !== "aktive") continue;
    const { count: terminalCount, error: tErr } = await db
      .from("license_terminals")
      .select("id", { count: "exact", head: true })
      .eq("license_id", lic.id);
    if (tErr) continue;
    const max = getMaxTerminals(lic);
    if ((terminalCount || 0) >= max) count += 1;
  }
  return count;
}

async function countLicensesOverTerminalLimit() {
  let total = 0;
  for (const product of ["kafene", "market", "hotel"]) {
    try {
      total += await countOverLimitOnDb(getSupabaseForProduct(product));
    } catch {
      /* produkti mund të mos jetë i konfiguruar */
    }
  }
  return total;
}

module.exports = {
  TERMINAL_GRACE_MS,
  normalizeDeviceId,
  getMaxTerminals,
  listTerminalsOrdered,
  migrateLegacyTerminal,
  resolveTerminalAccess,
  getTerminalSummaryForLicense,
  clearAllTerminals,
  countLicensesOverTerminalLimit,
  calcLicenseTotalPrice(basePrice, maxTerminals, terminalPrice) {
    const base = Number(basePrice) || 0;
    const max = Math.max(1, Number(maxTerminals) || 1);
    const extra = Math.max(0, max - 1);
    return base + extra * (Number(terminalPrice) || 0);
  },
  insertTerminal,
};
