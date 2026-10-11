"use strict";
/**
 * Përmbledhje ditore për panelin e pronarit — e njëjta logjikë si Admin (getReports / Kontabilisti).
 */
const crypto = require("crypto");
const { buildOwnerReportAnalytics } = require("./owner-report-analytics");
const { buildOwnerPanelSnapshot, departmentLabel } = require("./owner-panel-snapshot");
const { businessYmd } = require("./lib/hotel-business-date");

function fixRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const DAILY_LOG_PAYMENT_TOTALS_SQL = `
      COALESCE(SUM(CASE
        WHEN LOWER(TRIM(COALESCE(payment_method, ''))) = 'room' THEN 0
        WHEN payment_method = 'cash' THEN total
        WHEN payment_method IN ('mixed', 'perzier') THEN COALESCE(cash_amount, 0)
        WHEN payment_method IN ('karte', 'debit_card', 'credit_card') THEN COALESCE(NULLIF(cash_amount, 0), 0)
        WHEN LOWER(TRIM(COALESCE(payment_method, ''))) IN ('para', '') THEN COALESCE(cash_amount, total)
        ELSE COALESCE(cash_amount, 0)
      END), 0) AS cash_total,
      COALESCE(SUM(CASE
        WHEN payment_method IN ('karte', 'debit_card', 'credit_card') THEN total
        WHEN payment_method IN ('mixed', 'perzier') THEN COALESCE(card_amount, 0)
        ELSE COALESCE(NULLIF(card_amount, 0), 0)
      END), 0) AS card_total,
      COALESCE(SUM(CASE
        WHEN LOWER(TRIM(COALESCE(payment_method, ''))) = 'room' THEN total
        WHEN LOWER(TRIM(COALESCE(payment_method, ''))) IN ('mixed', 'perzier') THEN
          MAX(0, total - COALESCE(cash_amount, 0) - COALESCE(card_amount, 0))
        ELSE 0
      END), 0) AS room_total`;

function aggregateRestaurantPaymentsForDay(db, date) {
  const sqlite = db.db;
  if (!sqlite) return { cash: 0, card: 0, ne_dhome: 0 };
  const row = sqlite.prepare(`
    SELECT ${DAILY_LOG_PAYMENT_TOTALS_SQL}
    FROM daily_log
    WHERE status = 'completed'
      AND date(date) = date(?)
      AND NOT (
        UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'CO-%'
        OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'RC-%'
      )
  `).get(date);
  return {
    cash: fixRound(row?.cash_total),
    card: fixRound(row?.card_total),
    ne_dhome: fixRound(row?.room_total),
  };
}

function aggregateRecepsionPaymentsForDay(db, date) {
  const sqlite = db.db;
  if (!sqlite) {
    return { cash: 0, card: 0, ndarje: { dhome: 0, restorant: 0, sherbime: 0 } };
  }
  const rows = sqlite.prepare(`
    SELECT * FROM daily_log
    WHERE status = 'completed'
      AND date(date) = date(?)
      AND (
        UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'CO-%'
        OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'RC-%'
      )
  `).all(date);
  let cash = 0;
  let card = 0;
  let dhome = 0;
  let restorant = 0;
  let sherbime = 0;
  for (const e of rows) {
    const tot = Number(e.total) || 0;
    const pm = String(e.payment_method || "").toLowerCase();
    if (pm === "karte" || pm === "debit_card" || pm === "credit_card") card += tot;
    else cash += tot;
    if (/^CO-/i.test(String(e.receipt_number || ""))) {
      const items = (() => {
        try {
          return JSON.parse(e.items_json || "[]");
        } catch {
          return [];
        }
      })();
      for (const it of items) {
        const amt = (Number(it.quantity) || 1) * (Number(it.price) || 0);
        const name = String(it.name || "");
        if (/^Dhoma\s+/i.test(name)) dhome += amt;
        else if (/^(Ushqim|Pije|Menu)/i.test(name)) restorant += amt;
        else sherbime += amt;
      }
    } else {
      sherbime += tot;
    }
  }
  return {
    cash: fixRound(cash),
    card: fixRound(card),
    ndarje: {
      dhome: fixRound(dhome),
      restorant: fixRound(restorant),
      sherbime: fixRound(sherbime),
    },
  };
}

function vatByRateFromBook(vatBook) {
  const t = vatBook?.totals || {};
  return {
    rate_18: { vat: fixRound(t.boxK1 || 0), gross_base: fixRound(t.box12 || 0) },
    rate_8: { vat: fixRound(t.boxK2 || 0), gross_base: fixRound(t.box10 || 0) },
    rate_0: { vat: 0, gross_base: fixRound(t.boxA || 0) },
    output_total: fixRound(t.box30 || fixRound((t.boxK1 || 0) + (t.boxK2 || 0))),
  };
}

function listClosedShiftsForDay(db, date) {
  const sqlite = db.db;
  if (!sqlite) return [];
  const rows = sqlite.prepare(`
    SELECT ws.id, ws.waiter_name, ws.staff_id, ws.opened_at, ws.closed_at,
      ws.opening_cash, ws.closing_cash_actual, ws.expected_closing_cash,
      ws.cash_sales_total, ws.card_sales_total, ws.total_sales, ws.cash_difference,
      s.staff_role
    FROM waiter_shifts ws
    LEFT JOIN staff s ON s.id = ws.staff_id
    WHERE ws.closed_at IS NOT NULL AND TRIM(COALESCE(ws.closed_at, '')) != ''
      AND date(ws.closed_at) = date(?)
    ORDER BY ws.closed_at ASC
  `).all(date);
  return rows.map((r) => {
    const staffRole = r.staff_role || "";
    const dept = departmentLabel(staffRole);
    const sessionRole =
      String(staffRole || "").toLowerCase() === "recepsion" ? "recepsion" : "kamarier";
    let pay = {
      cash_total: fixRound(r.cash_sales_total),
      card_total: fixRound(r.card_sales_total),
      room_total: 0,
    };
    if (typeof db.computeShiftTotals === "function") {
      const t = db.computeShiftTotals(r.id, r.staff_id, r.waiter_name, sessionRole);
      pay = {
        cash_total: fixRound(t.cash_total),
        card_total: fixRound(t.card_total),
        room_total: fixRound(t.room_total),
      };
    }
    return {
      shift_id: r.id,
      waiter_name: r.waiter_name,
      staff_role: staffRole,
      department: dept,
      opened_at: r.opened_at,
      closed_at: r.closed_at,
      opening_cash: fixRound(r.opening_cash),
      closing_cash_actual: fixRound(r.closing_cash_actual),
      expected_closing_cash: fixRound(r.expected_closing_cash),
      cash_sales_total: pay.cash_total,
      card_sales_total: pay.card_total,
      room_total: pay.room_total,
      total_sales: fixRound(r.total_sales),
      cash_difference: fixRound(r.cash_difference),
    };
  });
}

function snapshotFingerprint(body) {
  const clone = { ...body };
  delete clone.computed_at;
  delete clone.fingerprint;
  return crypto.createHash("sha256").update(JSON.stringify(clone)).digest("hex");
}

function buildOwnerDailySnapshot(db, reportDate) {
  const date = String(reportDate || businessYmd()).slice(0, 10);
  const rep = db.getReports(date, date);
  const bilanc = db.getKontabilistiBilanc({ from: date, to: date });
  const vatBook = db.getAtkSalesVatBook({ from: date, to: date });
  const restorantReg = aggregateRestaurantPaymentsForDay(db, date);
  const recepsionReg = aggregateRecepsionPaymentsForDay(db, date);

  const dhome = fixRound(rep.hotelNights || 0);
  const restorant = fixRound(rep.restaurantSales || 0);
  const sherbime = fixRound(rep.hotelServices || 0);
  const b2b = fixRound(bilanc.sales_b2b || 0);
  const totalDept = fixRound(dhome + restorant + sherbime + b2b);

  const payloadCore = {
    report_date: date,
    revenue_by_department: {
      dhome,
      restorant,
      sherbime,
      b2b,
      total: totalDept,
    },
    cash_by_register: {
      restorant: {
        cash: restorantReg.cash,
        card: restorantReg.card,
        ne_dhome: restorantReg.ne_dhome,
      },
      recepsion: {
        cash: recepsionReg.cash,
        card: recepsionReg.card,
        ndarje: recepsionReg.ndarje,
      },
    },
    vat_by_rate: vatByRateFromBook(vatBook),
    purchases: fixRound(bilanc.purchases_total || 0),
    expenses: fixRound(bilanc.expenses_total || 0),
    gross_profit: fixRound(bilanc.gross_profit || 0),
    net_profit: fixRound(bilanc.profit || 0),
    closed_shifts: listClosedShiftsForDay(db, date),
    breakage_loss:
      typeof db.summarizeStockBreakageLoss === "function"
        ? db.summarizeStockBreakageLoss({ from: date, to: date })
        : null,
    top_items: (rep.topItems || []).slice(0, 10),
    reception_collected: rep.reception_collected || null,
    by_source: rep.by_source || null,
    pc_analytics: buildOwnerReportAnalytics(db, date),
    owner_panel: buildOwnerPanelSnapshot(db),
  };

  const computed_at = new Date().toISOString();
  const fingerprint = snapshotFingerprint(payloadCore);
  return {
    ...payloadCore,
    computed_at,
    fingerprint,
  };
}

module.exports = {
  buildOwnerDailySnapshot,
  snapshotFingerprint,
  fixRound,
};
