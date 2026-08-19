const receiptPrint = require("./receipt-print");
const { buildReceiptHtml } = require("./receipt-html");
const printer = require("./printer");

function normalizeCouponType(raw) {
  const v = String(raw || "thermal").trim().toLowerCase();
  return v === "fiscal" ? "fiscal" : "thermal";
}

async function printClosedTableReceipt(db, {
  order,
  receipt,
  tableNumber = 0,
  couponType = "thermal",
}) {
  const fiscal = db.getFiscalSettings();
  const settings = typeof db.getSettings === "function" ? db.getSettings() : {};
  const bizDisplayName =
    String(fiscal.biz_name || "").trim()
    || String(settings.restaurant_name || settings.business_name || "").trim()
    || "Hotel";
  const totals = db.calcFiscalTotals(
    order.total,
    fiscal.tvsh_enabled,
    fiscal.tvsh_percent,
  );
  const parsedItems = JSON.parse(order.items_json || "[]");
  const closedAt = receipt.printed_at || new Date().toISOString();
  const kind = normalizeCouponType(couponType);
  const discountTotal = Number(order.discount_total) || 0;
  const promotionName = order.promotion_name || "";
  const subtotalBeforeDiscount = order.subtotal != null ? order.subtotal : null;

  if (kind === "fiscal") {
    const html = buildReceiptHtml({
      tableNumber,
      waiterName: order.waiter_name,
      items: parsedItems,
      fiscal,
      receiptNumber: receipt.receipt_number,
      totals,
      restaurantName: bizDisplayName,
      paymentMethod: order.payment_method,
      closedAt,
      discountTotal,
      promotionName,
      subtotalBeforeDiscount,
      sourceLabel: order.source_label || "",
    });

    try {
      const printResult = await printer.printReceiptAt(html, db, "fiscal");
      return {
        printed: true,
        source: "fiscal-html",
        coupon_type: "fiscal",
        html,
        printMessage: "",
        ...printResult,
      };
    } catch (err) {
      return {
        printed: false,
        source: "fiscal-html",
        coupon_type: "fiscal",
        html,
        printMessage: err.message || "Printimi fiskal dështoi.",
      };
    }
  }

  const printResult = await receiptPrint.printOrderReceipt(db, {
    order,
    tableNumber,
    receiptNumber: receipt.receipt_number,
    fiscal,
    totals,
    items: parsedItems,
    closedAt,
    paymentMethod: order.payment_method,
    slipKind: "final",
    station: "bar",
    discountTotal,
    promotionName,
    subtotalBeforeDiscount,
  });

  return {
    ...printResult,
    coupon_type: "thermal",
    html: printResult.html || null,
  };
}

/**
 * Mbyllje nga telefon (cloud SSE status=closed): nëse ka ende porosi aktive cloud-linked,
 * kompleto lokalisht + printo faturën e mbylljes. Nëse tashmë e mbyllur nga paneli → no-op.
 */
async function printClosingReceiptIfActiveCloudOrder(db, tableNumber, opts = {}) {
  const num = Number(tableNumber);
  if (!num || !db) return { printed: false, skipped: true, reason: "no_table" };

  const table =
    typeof db.getTableByNumber === "function"
      ? db.getTableByNumber(num)
      : db.db?.prepare?.("SELECT * FROM tables WHERE number = ?")?.get(num);
  if (!table?.id) return { printed: false, skipped: true, reason: "table_missing" };

  const order =
    typeof db.getActiveOrderForTable === "function"
      ? db.getActiveOrderForTable(table.id)
      : null;
  if (!order?.id) {
    console.warn("[close-print] T" + num + " — no_active (porosia lokale mungon, print anashkaluar)");
    return { printed: false, skipped: true, reason: "no_active" };
  }
  if (!String(order.cloud_order_id || "").trim()) {
    return { printed: false, skipped: true, reason: "not_cloud" };
  }

  const pay = String(opts.paymentMethod || order.payment_method || "cash").trim() || "cash";
  const requestedCoupon = String(opts.coupon_type || opts.couponType || "thermal").trim().toLowerCase();
  const fiscalSkip = opts.fiscal_skip === true || opts.fiscalSkip === true || requestedCoupon === "thermal";
  const closed = db.closeTable(table.id, order.waiter_name || "Kamarier", false, pay, null, {
    allowAnyWaiter: true,
  });
  if (!closed) return { printed: false, skipped: true, reason: "close_failed" };

  const receipt = db.createReceipt(closed.id);

  /* SEF ON + jo termik → processFiscalReceipt */
  let fiscalResult = null;
  try {
    const fiscalConfig = require("./fiscal/fiscal-config");
    const fiscalMain = require("./fiscal/fiscal-main");
    if (fiscalConfig.isFiscalEnabled() && !fiscalSkip) {
      fiscalResult = await fiscalMain.processFiscalReceipt(
        closed.id,
        pay,
        {
          operator_name: closed.waiter_name || "Kamarier",
          operator_id: "PHONE",
          total_amount: closed.total,
        },
      );
      console.log("[close-print] cloud close T" + num + " fiscal:", {
        ok: !!fiscalResult?.ok,
        printed: !!fiscalResult?.printed,
        daily_number: fiscalResult?.daily_number,
        receipt_id: fiscalResult?.fiscal_receipt_id,
      });
    }
  } catch (e) {
    console.warn("[close-print] fiscal processFiscalReceipt:", e.message || e);
  }

  let shouldPrintNormal = true;
  try {
    const fiscalMain = require("./fiscal/fiscal-main");
    shouldPrintNormal = fiscalMain.shouldPrintClosingNormalReceipt();
  } catch {
    shouldPrintNormal = true;
  }

  if (!shouldPrintNormal && !fiscalSkip) {
    console.log("[close-print] SEF replace — skip kupon normal (cloud close T" + num + ")", {
      fiscal_printed: !!fiscalResult?.printed,
      order_id: closed.id,
    });
    return {
      printed: !!fiscalResult?.printed,
      skipped: !fiscalResult?.printed,
      reason: fiscalResult?.printed ? "sef_fiscal_only" : "sef_replace_no_print",
      order_id: closed.id,
      fiscal_receipt: fiscalResult,
    };
  }

  const printResult = await printClosedTableReceipt(db, {
    order: closed,
    receipt,
    tableNumber: num,
    couponType: fiscalSkip ? "thermal" : "fiscal",
  });
  console.log("[close-print] cloud close T" + num, {
    printed: !!printResult?.printed,
    order_id: closed.id,
    fiscal_printed: !!fiscalResult?.printed,
  });
  return { ...printResult, order_id: closed.id, fiscal_receipt: fiscalResult };
}

module.exports = {
  normalizeCouponType,
  printClosedTableReceipt,
  printClosingReceiptIfActiveCloudOrder,
};
