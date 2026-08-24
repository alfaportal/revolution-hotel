/**
 * fiscal/fiscal-numbering.js — HAPI 5: numri ditor, NUIKF, SEF identifier.
 * Thirret VETËM kur isFiscalEnabled()=true. Nuk prek raportin Z ekzistues.
 */
const crypto = require("crypto");
const { isFiscalEnabled } = require("./fiscal-config");

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const NUIKF_LEN = 16;
const NUIKF_MAX_TRIES = 32;

function getSqlite() {
  const database = require("../database");
  if (!database || !database.db) {
    throw new Error("Databaza nuk është e gatshme");
  }
  return database.db;
}

function ensureSettingsRow(sqlite) {
  const row = sqlite.prepare("SELECT id FROM fiscal_settings WHERE id = 1").get();
  if (!row) {
    sqlite
      .prepare(
        `INSERT INTO fiscal_settings (id, fiscal_enabled, language, developer_nui, daily_receipt_counter)
         VALUES (1, 0, 'sq', '811314567', 0)`
      )
      .run();
  }
}

function todayLocalYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function assertFiscalOn() {
  if (!isFiscalEnabled()) return false;
  return true;
}

/**
 * Numri i radhës ditor (1, 2, 3...).
 * Rrit daily_receipt_counter; nëse data ≠ last_z_report_date → fillon nga 1.
 * Kur fillon dita e re, përditësohet last_z_report_date=sot që numërimi të vazhdojë 2,3,...
 * (resetDailyCounter e vendos counter=0 + last_z=sot pas raportit Z).
 */
function getNextDailyNumber() {
  if (!assertFiscalOn()) return null;

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);

  const row = sqlite
    .prepare(
      `SELECT daily_receipt_counter, last_z_report_date FROM fiscal_settings WHERE id = 1`
    )
    .get();

  const today = todayLocalYmd();
  const lastZ = row?.last_z_report_date ? String(row.last_z_report_date).slice(0, 10) : "";
  let next;
  let setDate = lastZ;

  if (!lastZ || lastZ !== today) {
    // Ditë e re që nga Z / dita e fundit e numërimit → fillo nga 1
    next = 1;
    setDate = today;
  } else {
    next = (Number(row.daily_receipt_counter) || 0) + 1;
    if (next < 1) next = 1;
  }

  sqlite
    .prepare(
      `UPDATE fiscal_settings SET
        daily_receipt_counter = ?,
        last_z_report_date = ?,
        updated_at = datetime('now','localtime')
      WHERE id = 1`
    )
    .run(next, setDate);

  return next;
}

/**
 * Reseton numrin ditor pas Përmbledhjes Ditore (mbyllja fiskale).
 * Thirret nga onDailySummaryPrinted — vetëm 1× në ditë.
 * NUK prek total_receipt_counter (numri rendor total nuk rifillon kurrë).
 */
function resetDailyCounter() {
  if (!assertFiscalOn()) return false;

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);
  const today = todayLocalYmd();

  sqlite
    .prepare(
      `UPDATE fiscal_settings SET
        daily_receipt_counter = 0,
        last_z_report_date = ?,
        updated_at = datetime('now','localtime')
      WHERE id = 1`
    )
    .run(today);

  return true;
}

/**
 * Numri rendor total i kuponit (1, 2, 3...) — NUK rifillon kurrë (as pas Z).
 */
function getNextTotalNumber() {
  if (!assertFiscalOn()) return null;

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);

  // Siguro kolonën në DB të vjetër
  try {
    sqlite
      .prepare(
        `ALTER TABLE fiscal_settings ADD COLUMN total_receipt_counter INTEGER DEFAULT 0`
      )
      .run();
  } catch {
    /* already exists */
  }

  const row = sqlite
    .prepare(`SELECT total_receipt_counter FROM fiscal_settings WHERE id = 1`)
    .get();
  let next = (Number(row?.total_receipt_counter) || 0) + 1;
  if (next < 1) next = 1;

  sqlite
    .prepare(
      `UPDATE fiscal_settings SET
        total_receipt_counter = ?,
        updated_at = datetime('now','localtime')
      WHERE id = 1`
    )
    .run(next);

  return next;
}

function randomAlphanum(len) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHANUM[bytes[i] % ALPHANUM.length];
  }
  return out;
}

function nuikfExists(sqlite, nuikf) {
  const row = sqlite
    .prepare(`SELECT 1 AS ok FROM fiscal_receipts WHERE nuikf = ? LIMIT 1`)
    .get(nuikf);
  return !!row;
}

/**
 * NUIKF — max 16 karaktere alfanumerike, unik në fiscal_receipts.
 * Format: timestamp(base36) + counter + random → padded/trimmed në 16.
 */
function generateNUIKF() {
  if (!assertFiscalOn()) return null;

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);

  const counterRow = sqlite
    .prepare(`SELECT daily_receipt_counter FROM fiscal_settings WHERE id = 1`)
    .get();
  const counter = Number(counterRow?.daily_receipt_counter) || 0;

  for (let attempt = 0; attempt < NUIKF_MAX_TRIES; attempt++) {
    const ts = Date.now().toString(36).toUpperCase(); // ~8–9 chars
    const ctr = counter.toString(36).toUpperCase().padStart(2, "0");
    const rnd = randomAlphanum(8);
    // timestamp + counter + random, pastaj trim/pad në 16
    let candidate = (ts + ctr + rnd).replace(/[^A-Z0-9]/g, "");
    if (candidate.length > NUIKF_LEN) {
      candidate = candidate.slice(0, NUIKF_LEN);
    } else if (candidate.length < NUIKF_LEN) {
      candidate = (candidate + randomAlphanum(NUIKF_LEN)).slice(0, NUIKF_LEN);
    }

    if (!nuikfExists(sqlite, candidate)) {
      return candidate;
    }
  }

  throw new Error("Nuk u gjenerua NUIKF unik pas disa përpjekjeve");
}

/**
 * Nr. Identifikues SEF (ATK Neni 25): [Numri i Njësisë ARBK]-[NUI]-[PosID]
 * p.sh. "5130484-812345678-11"
 * JO NUI-NUI-PosID.
 */
function getSefIdentifier() {
  if (!assertFiscalOn()) return null;

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);

  // Siguro kolonën unit_number në DB të vjetër
  try {
    sqlite
      .prepare(`ALTER TABLE fiscal_settings ADD COLUMN unit_number TEXT`)
      .run();
  } catch {
    /* already exists */
  }

  let row;
  try {
    row = sqlite
      .prepare(
        `SELECT unit_number, business_unit_number, taxpayer_nui, developer_nui, pos_id
         FROM fiscal_settings WHERE id = 1`
      )
      .get();
  } catch {
    row = sqlite
      .prepare(
        `SELECT business_unit_number, taxpayer_nui, developer_nui, pos_id
         FROM fiscal_settings WHERE id = 1`
      )
      .get();
  }

  const unitNumber = String(
    (row && row.unit_number) ||
      (row && row.business_unit_number) ||
      ""
  )
    .trim()
    .replace(/[^\d]/g, "");

  const nui = String(
    (row?.taxpayer_nui && String(row.taxpayer_nui).trim()) ||
      (row?.developer_nui && String(row.developer_nui).trim()) ||
      ""
  ).replace(/[^\d]/g, "");

  if (!unitNumber || !nui) {
    return null;
  }

  let posId = row?.pos_id != null ? String(row.pos_id).trim() : "";
  if (!posId) posId = "01";
  // Normë e shkurtër për POS (p.sh. 1 → 01) — shembulli ATK lejon edhe "11"
  if (/^\d+$/.test(posId) && posId.length === 1) {
    posId = posId.padStart(2, "0");
  }

  return `${unitNumber}-${nui}-${posId}`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Akumulimi ditor i kuponëve fiskalë (lexim — pa reset, pa mbyllje).
 * TVSH = shuma e vat_breakdown të ruajtur (residual tashmë në çdo kupon).
 */
function getDailyFiscalAccumulated(dateYmd) {
  if (!assertFiscalOn()) return null;

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);
  const day = dateYmd || todayLocalYmd();

  const rows = sqlite
    .prepare(
      `SELECT total_amount, total_without_tax, vat_breakdown_json, is_offline
       FROM fiscal_receipts
       WHERE date(created_at) = date(?)`
    )
    .all(day);

  const vat_breakdown = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let coupon_count = 0;
  let total_amount = 0;
  let total_without_tax = 0;
  let offline_count = 0;

  for (const r of rows) {
    coupon_count += 1;
    total_amount += Number(r.total_amount) || 0;
    total_without_tax += Number(r.total_without_tax) || 0;
    if (Number(r.is_offline) === 1) offline_count += 1;
    let vb = {};
    try {
      vb =
        typeof r.vat_breakdown_json === "string"
          ? JSON.parse(r.vat_breakdown_json || "{}")
          : r.vat_breakdown_json || {};
    } catch {
      vb = {};
    }
    for (const L of ["A", "B", "C", "D", "E"]) {
      vat_breakdown[L] += Number(vb[L] ?? vb[L.toLowerCase()] ?? 0) || 0;
    }
  }

  for (const L of ["A", "B", "C", "D", "E"]) {
    vat_breakdown[L] = round2(vat_breakdown[L]);
  }

  return {
    date: day,
    coupon_count,
    total_amount: round2(total_amount),
    total_without_tax: round2(total_without_tax),
    vat_breakdown,
    offline_count,
  };
}

/**
 * Raport periodik — akumulim mes dy datave (YYYY-MM-DD), pa reset / pa mbyllje.
 */
function getPeriodicFiscalReport(fromDate, toDate, operatorName, operatorId) {
  if (!assertFiscalOn()) return null;

  const from = String(fromDate || "").slice(0, 10);
  const to = String(toDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Datat duhet YYYY-MM-DD");
  }
  if (from > to) throw new Error("Data Nga duhet ≤ Deri");

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);

  const rows = sqlite
    .prepare(
      `SELECT total_amount, total_without_tax, vat_breakdown_json, is_offline
       FROM fiscal_receipts
       WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`
    )
    .all(from, to);

  const vat_breakdown = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let coupon_count = 0;
  let total_amount = 0;
  let total_without_tax = 0;
  let offline_count = 0;

  for (const r of rows) {
    coupon_count += 1;
    total_amount += Number(r.total_amount) || 0;
    total_without_tax += Number(r.total_without_tax) || 0;
    if (Number(r.is_offline) === 1) offline_count += 1;
    let vb = {};
    try {
      vb =
        typeof r.vat_breakdown_json === "string"
          ? JSON.parse(r.vat_breakdown_json || "{}")
          : r.vat_breakdown_json || {};
    } catch {
      vb = {};
    }
    for (const L of ["A", "B", "C", "D", "E"]) {
      vat_breakdown[L] += Number(vb[L] ?? vb[L.toLowerCase()] ?? 0) || 0;
    }
  }
  for (const L of ["A", "B", "C", "D", "E"]) {
    vat_breakdown[L] = round2(vat_breakdown[L]);
  }

  const details = {
    source: "periodic_report",
    mode: "PERIODIC",
    from_date: from,
    to_date: to,
    date: `${from} → ${to}`,
    coupon_count,
    total_amount: round2(total_amount),
    total_without_tax: round2(total_without_tax),
    vat_breakdown,
    offline_count,
    reset_applied: false,
    official_close: false,
  };

  try {
    const { logFiscalAction } = require("./fiscal-audit");
    logFiscalAction(
      "periodic_report",
      details,
      operatorName != null ? String(operatorName) : "Admin",
      operatorId != null ? String(operatorId) : "ADMIN"
    );
  } catch {
    /* */
  }

  return details;
}

/**
 * Modi X (Neni 10 / 3.1) — gjendja aktuale e ditës, pa reset numri ditor.
 * Mund të thirret shumë herë. Nuk shënon mbyllje zyrtare.
 */
function getXReportSnapshot(operatorName, operatorId) {
  if (!assertFiscalOn()) return null;

  const acc = getDailyFiscalAccumulated();
  if (!acc) return null;

  const details = {
    source: "x_report",
    mode: "X",
    ...acc,
    reset_applied: false,
    official_close: false,
  };

  try {
    const { logFiscalAction } = require("./fiscal-audit");
    logFiscalAction(
      "x_report",
      details,
      operatorName != null ? String(operatorName) : "Admin",
      operatorId != null ? String(operatorId) : "ADMIN"
    );
  } catch {
    /* audit opsional — nuk bllokon printimin X */
  }

  return details;
}

/**
 * Pas Përmbledhjes Ditore (mbyllja fiskale ditore ATK).
 * - Logon stats në fiscal_audit_log (action=z_report)
 * - Reseton numrin ditor VETËM 1× në ditë (last_z_report_date !== sot)
 * Kur fiscal OFF → null (asnjë efekt).
 */
function onDailySummaryPrinted(operatorName, operatorId) {
  if (!assertFiscalOn()) return null;

  const sqlite = getSqlite();
  ensureSettingsRow(sqlite);
  const today = todayLocalYmd();

  const settingsRow = sqlite
    .prepare(
      `SELECT last_z_report_date, daily_receipt_counter FROM fiscal_settings WHERE id = 1`
    )
    .get();
  const lastZ = settingsRow?.last_z_report_date
    ? String(settingsRow.last_z_report_date).slice(0, 10)
    : "";
  const alreadyClosedToday = lastZ === today;

  const acc = getDailyFiscalAccumulated(today) || {
    date: today,
    coupon_count: 0,
    total_amount: 0,
    total_without_tax: 0,
    vat_breakdown: { A: 0, B: 0, C: 0, D: 0, E: 0 },
    offline_count: 0,
  };

  const details = {
    source: "daily_summary",
    mode: "Z",
    ...acc,
    daily_receipt_counter_before: Number(settingsRow?.daily_receipt_counter) || 0,
    reset_applied: false,
    official_close: true,
  };

  let resetApplied = false;
  if (!alreadyClosedToday) {
    resetApplied = !!resetDailyCounter();
  }
  details.reset_applied = resetApplied;

  const { logFiscalAction } = require("./fiscal-audit");
  logFiscalAction(
    "z_report",
    details,
    operatorName != null ? String(operatorName) : "Admin",
    operatorId != null ? String(operatorId) : "ADMIN"
  );

  return details;
}

module.exports = {
  getNextDailyNumber,
  getNextTotalNumber,
  resetDailyCounter,
  generateNUIKF,
  getSefIdentifier,
  getDailyFiscalAccumulated,
  getXReportSnapshot,
  getPeriodicFiscalReport,
  onDailySummaryPrinted,
};
