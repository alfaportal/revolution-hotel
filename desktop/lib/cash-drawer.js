"use strict";

const printer = require("../printer");

/** ESC p — drawer kick (pin 2 / pin 5). */
const DRAWER_KICK_PIN2 = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0x19]);
const DRAWER_KICK_PIN5 = Buffer.from([0x1b, 0x70, 0x01, 0x19, 0x19]);

function normalizePayMethod(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "mixed") return "mixed";
  if (v === "cash") return "cash";
  if (["karte", "kartë", "card", "debit_card", "credit_card"].includes(v)) return "karte";
  return v;
}

/** True when checkout includes any cash (single cash, mixed, or split with cash line). */
function paymentIncludesCash({ payment_method, payment_splits, order } = {}) {
  let splits = payment_splits;
  if (!Array.isArray(splits) || !splits.length) {
    if (Array.isArray(order?.payment_splits) && order.payment_splits.length) {
      splits = order.payment_splits;
    } else if (order?.payment_splits_json) {
      try {
        const parsed = JSON.parse(order.payment_splits_json);
        if (Array.isArray(parsed) && parsed.length) splits = parsed;
      } catch {
        /* ignore */
      }
    }
  }
  if (Array.isArray(splits) && splits.length) {
    return splits.some((sp) => normalizePayMethod(sp.method ?? sp.payment_method) === "cash");
  }
  const pm = normalizePayMethod(payment_method || order?.payment_method);
  return pm === "cash" || pm === "mixed";
}

/**
 * Opens the cash drawer via the same thermal receipt printer (bar station).
 * Fails silently (warn log) if printer missing or kick fails — never throws to caller.
 */
async function openCashDrawer(db, station = "bar") {
  if (!db) {
    console.warn("[cash-drawer] db mungon — skip");
    return { ok: false, skipped: true };
  }
  try {
    const target = await printer.ensureReceiptPrinter(db, station);
    const dispatchTarget = {
      printerName: target.printerName,
      ip_address: target.ip_address,
      port: target.port,
    };
    if (!String(dispatchTarget.printerName || "").trim() && !String(dispatchTarget.ip_address || "").trim()) {
      console.warn("[cash-drawer] Nuk ka printer termik — skip kick");
      return { ok: false, skipped: true, reason: "no_printer" };
    }
    try {
      await printer.dispatchRawEscPos(DRAWER_KICK_PIN2, dispatchTarget);
      console.log("[cash-drawer] Kick OK (pin 2)");
      return { ok: true, pin: 2 };
    } catch (e1) {
      console.warn("[cash-drawer] Pin 2 dështoi:", e1.message);
      try {
        await printer.dispatchRawEscPos(DRAWER_KICK_PIN5, dispatchTarget);
        console.log("[cash-drawer] Kick OK (pin 5)");
        return { ok: true, pin: 5 };
      } catch (e2) {
        console.warn("[cash-drawer] Pin 5 dështoi:", e2.message);
        return { ok: false, error: e2.message };
      }
    }
  } catch (err) {
    console.warn("[cash-drawer]", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  openCashDrawer,
  paymentIncludesCash,
  DRAWER_KICK_PIN2,
  DRAWER_KICK_PIN5,
};
