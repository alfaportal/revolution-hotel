"use strict";

/**
 * Kujtesë Raporti Z — dita fiskale = kalendarike Europe/Belgrade (00:00–23:59).
 * Para ditës së re: last_z_report_date duhet të mbulojë të paktën dje.
 */

const bizDate = require("../lib/hotel-business-date");
const { isFiscalEnabled } = require("./fiscal-config");

function getSqlite() {
  const database = require("../database");
  return database?.db || null;
}

function getLastZReportDate(sqlite) {
  try {
    const row = sqlite
      .prepare("SELECT last_z_report_date FROM fiscal_settings WHERE id = 1")
      .get();
    return row?.last_z_report_date ? String(row.last_z_report_date).slice(0, 10) : "";
  } catch {
    return "";
  }
}

function formatSqDate(ymd) {
  const p = String(ymd || "").slice(0, 10).split("-");
  if (p.length !== 3) return ymd;
  return `${p[2]}.${p[1]}.${p[0]}`;
}

/** Ditët D ku last_z < D <= throughYmd (p.sh. dje) pa Raport Z. */
function listPendingZDays(sqlite, lastZ, throughYmd) {
  const end = String(throughYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];

  let start;
  if (lastZ && /^\d{4}-\d{2}-\d{2}$/.test(lastZ)) {
    start = bizDate.addBusinessDays(lastZ, 1);
  } else {
    try {
      const minRow = sqlite
        .prepare(
          `SELECT date(created_at) AS d FROM fiscal_receipts ORDER BY datetime(created_at) ASC LIMIT 1`,
        )
        .get();
      start = minRow?.d ? String(minRow.d).slice(0, 10) : "";
    } catch {
      start = "";
    }
    if (!start) return [];
  }

  const out = [];
  for (let d = start; d && d <= end; d = bizDate.addBusinessDays(d, 1)) {
    out.push(d);
  }
  return out;
}

function getZReportReminderStatus() {
  const business_today = bizDate.businessYmd();
  const business_yesterday = bizDate.businessYesterdayYmd();
  const day_window = {
    timezone: bizDate.BUSINESS_TZ,
    from: "00:00",
    to: "23:59",
    label: "Dita fiskale: 00:00–23:59 (ora e Kosovës / Europe-Belgrade)",
  };
  const tz_warning = bizDate.pcTimezoneMismatchWarning();

  const base = {
    ok: true,
    needed: false,
    fiscal_enabled: false,
    business_today,
    business_yesterday,
    last_z_date: null,
    pending_days: [],
    pending_date: null,
    pending_coupon_count: 0,
    day_window,
    timezone_warning: tz_warning,
    message: "",
  };

  if (!isFiscalEnabled()) return base;

  const sqlite = getSqlite();
  if (!sqlite) return { ...base, ok: false, message: "Databaza nuk është gati." };

  const last_z_date = getLastZReportDate(sqlite) || null;
  base.fiscal_enabled = true;
  base.last_z_date = last_z_date;

  if (last_z_date && last_z_date >= business_yesterday) {
    return base;
  }

  const pending_days = listPendingZDays(sqlite, last_z_date || "", business_yesterday);
  if (!pending_days.length) {
    const anyReceipt = sqlite.prepare("SELECT COUNT(*) AS c FROM fiscal_receipts").get()?.c || 0;
    if (!anyReceipt) return base;
    pending_days.push(business_yesterday);
  }

  const { getDailyFiscalAccumulated } = require("./fiscal-numbering");
  let couponTotal = 0;
  const day_summaries = pending_days.map((date) => {
    const acc = getDailyFiscalAccumulated(date) || {
      date,
      coupon_count: 0,
      total_amount: 0,
    };
    couponTotal += Number(acc.coupon_count) || 0;
    return {
      date,
      coupon_count: acc.coupon_count || 0,
      total_amount: acc.total_amount || 0,
    };
  });

  const pending_date = pending_days[pending_days.length - 1];
  const dateLabel =
    pending_days.length === 1
      ? formatSqDate(pending_date)
      : `${formatSqDate(pending_days[0])} – ${formatSqDate(pending_date)}`;

  let message =
    `Nuk u bë Raporti Z për ditën fiskale ${dateLabel}. ` +
    "Printoni / dërgoni Raportin Z para se të vazhdoni ditën e re.";
  if (couponTotal > 0) {
    message += ` (${couponTotal} kuponë fiskalë pa mbyllur ditore.)`;
  }
  if (tz_warning) {
    message += ` ${tz_warning}`;
  }

  return {
    ...base,
    needed: true,
    pending_days,
    pending_date,
    pending_coupon_count: couponTotal,
    day_summaries,
    message,
  };
}

function mergeOwnerAndFiscalReminders(local, owner) {
  const fiscal = local || {};
  const own = owner && owner.ok !== false ? owner : null;
  const fiscal_z_needed = !!fiscal.needed && !!fiscal.fiscal_enabled;
  const owner_z_needed = !!own?.needed;
  const needed = fiscal_z_needed || owner_z_needed;

  const parts = [];
  if (owner_z_needed && own?.message) parts.push(own.message);
  if (fiscal_z_needed) {
    if (local.message) parts.push(local.message);
    if (!owner_z_needed) {
      parts.push(
        "Hapi tjetër te lokal: Admin → Fiskalizimi → Printo Raportin Z (ATK / printeri fiskal).",
      );
    } else {
      parts.push("Kur të jeni te lokal, printoni edhe Raportin Z fiskal në arkë.");
    }
  }

  return {
    ...fiscal,
    needed,
    fiscal_z_needed,
    owner_z_needed,
    owner_z: own
      ? {
          pending_days: own.pending_days || [],
          pending_date: own.pending_date || null,
          last_closed_date: own.last_closed_date || null,
          message: own.message || "",
        }
      : null,
    message: parts.filter(Boolean).join(" "),
  };
}

async function getZReportReminderStatusAsync(db) {
  const local = getZReportReminderStatus();
  let owner = null;
  if (db) {
    try {
      const cloudSync = require("../cloud-sync");
      if (typeof cloudSync.fetchOwnerDailyZReminder === "function") {
        owner = await cloudSync.fetchOwnerDailyZReminder(db);
      }
    } catch {
      owner = null;
    }
  }
  return mergeOwnerAndFiscalReminders(local, owner);
}

module.exports = {
  getZReportReminderStatus,
  getZReportReminderStatusAsync,
  mergeOwnerAndFiscalReminders,
  formatSqDate,
  listPendingZDays,
};
