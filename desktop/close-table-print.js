const receiptPrint = require("./receipt-print");
const { buildReceiptHtml } = require("./receipt-html");
const printer = require("./printer");

function normalizeCouponType(raw) {
  const v = String(raw || "thermal").trim().toLowerCase();
  return v === "fiscal" ? "fiscal" : "thermal";
}

function parseOrderItemsSafe(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function itemsTotal(items) {
  return (items || []).reduce((s, it) => {
    const qty = Number(it.quantity ?? it.sasia ?? 1) || 1;
    const price = Number(it.price ?? it.cmimi ?? it.unit_price ?? 0) || 0;
    return s + qty * price;
  }, 0);
}

function resolveCloseTotal(order) {
  const fromOrder = Number(order?.total);
  if (Number.isFinite(fromOrder) && fromOrder > 0) return Math.round(fromOrder * 100) / 100;
  const fromItems = itemsTotal(parseOrderItemsSafe(order?.items_json));
  return Math.round(fromItems * 100) / 100;
}

async function printClosedTableReceipt(db, {
  order,
  receipt,
  tableNumber = 0,
  couponType = "thermal",
}) {
  const fiscal = db.getFiscalSettings();
  const totals = db.calcFiscalTotals(
    order.total,
    fiscal.tvsh_enabled,
    fiscal.tvsh_percent,
  );
  const parsedItems = parseOrderItemsSafe(order.items_json);
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
      restaurantName: fiscal.biz_name,
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

function linkLocalOrderToCloud(db, localOrderId, cloudOrderId) {
  const cloudId = String(cloudOrderId || "").trim();
  const id = Number(localOrderId);
  if (!cloudId || !id || !db?.db) return;
  try {
    db.db.prepare(`
      UPDATE orders SET cloud_order_id = COALESCE(NULLIF(cloud_order_id, ''), ?)
      WHERE id = ?
    `).run(cloudId, id);
    if (typeof db.linkCloudOrderId === "function") db.linkCloudOrderId(id, cloudId);
  } catch (e) {
    console.warn("[close-print] link cloud_order_id:", e.message || e);
  }
}

function closePrintLogTag(tableNumber, cloudId) {
  const num = Number(tableNumber) || 0;
  if (num >= 1) return "T" + num;
  const id = String(cloudId || "").trim();
  return id ? "Online " + id.slice(0, 8) : "Online";
}

/**
 * Mbyllje nga telefon (cloud SSE status=closed): kompleto lokalisht + printo.
 * Lidh edhe porositë POS lokale që u sinkronizuan në cloud me local_order_id=order.id
 * por pa kolonën cloud_order_id (arsyeja kryesore pse paneli mbetej i hapur).
 * table_number=0 → Takeaway/Delivery (sllot Online); fatura shfaq source_label, jo T0.
 */
async function printClosingReceiptIfActiveCloudOrder(db, tableNumber, opts = {}) {
  const num = Number(tableNumber) || 0;
  const cloudId = String(opts.order_id || opts.cloudOrderId || opts.cloud_order_id || "").trim();
  if (!db) return { printed: false, skipped: true, reason: "no_db" };
  if (!num && !cloudId) return { printed: false, skipped: true, reason: "no_table" };

  const tag = closePrintLogTag(num, cloudId);
  const printTableNum = num >= 1 ? num : 0;

  let table = null;
  if (num >= 1) {
    table =
      typeof db.getTableByNumber === "function"
        ? db.getTableByNumber(num)
        : db.db?.prepare?.("SELECT * FROM tables WHERE number = ?")?.get(num);
    if (!table?.id) return { printed: false, skipped: true, reason: "table_missing" };
  }

  const localOrderId = String(opts.local_order_id || opts.localOrderId || "").trim();

  let order =
    num >= 1 && table?.id && typeof db.getActiveOrderForTable === "function"
      ? db.getActiveOrderForTable(table.id)
      : null;

  // Fallback: gjej sipas cloud UUID (WEB-WAITER / Takeaway) ose local_order_id = id lokale POS
  if (!order?.id && cloudId && typeof db.getActiveOrderByCloudId === "function") {
    order = db.getActiveOrderByCloudId(cloudId);
  }
  if (!order?.id && localOrderId && db?.db) {
    try {
      order = db.db.prepare(
        "SELECT * FROM orders WHERE id = ? AND status = 'active'",
      ).get(Number(localOrderId));
    } catch { /* ignore */ }
  }

  // Fallback: sync e kompletoi porosinë pa print → gjej completed + printo nëse s'ka receipt.
  if (!order?.id && cloudId && db?.db) {
    try {
      const completed = db.db.prepare(
        "SELECT * FROM orders WHERE cloud_order_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1",
      ).get(cloudId);
      if (completed?.id) {
        const hasReceipt = !!db.db.prepare(
          "SELECT id FROM receipts WHERE order_id = ? LIMIT 1",
        ).get(completed.id);
        if (!hasReceipt) {
          console.log(
            "[close-print] " + tag +
            " no_active por completed pa receipt — print termik order#" + completed.id,
          );
          try {
            const freeTableId = Number(completed.table_id) || Number(table?.id);
            if (freeTableId) {
              db.db.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(freeTableId);
            }
          } catch { /* ignore */ }
          const receipt = db.createReceipt(completed.id);
          const closeTotal = resolveCloseTotal(completed);
          if (closeTotal > 0 && Number(completed.total) !== closeTotal) {
            completed.total = closeTotal;
          }
          const printResult = await printClosedTableReceipt(db, {
            order: { ...completed, total: closeTotal > 0 ? closeTotal : completed.total },
            receipt,
            tableNumber: printTableNum,
            couponType: "thermal",
          });
          return {
            ...printResult,
            order_id: completed.id,
            reason: printResult?.printed ? "printed_completed_fallback" : "print_failed_completed_fallback",
          };
        }
      }
    } catch (err) {
      console.warn("[close-print] completed fallback:", err.message || err);
    }
  }

  if (!order?.id) {
    console.warn("[close-print] " + tag + " — no_active (porosia lokale mungon, print anashkaluar)");
    return { printed: false, skipped: true, reason: "no_active" };
  }

  const linked = String(order.cloud_order_id || "").trim();
  const matchesLocalId = !!(localOrderId && String(order.id) === localOrderId);

  // Porosi cloud-linked, POS me local_order_id, ose SSE me order_id cloud
  if (!linked && !matchesLocalId && !cloudId) {
    console.warn("[close-print] " + tag + " — not_cloud (order#" + order.id +
      " cloud_order_id bosh, local_order_id SSE=" + (localOrderId || "null") + ")");
    return { printed: false, skipped: true, reason: "not_cloud" };
  }
  if (!linked && cloudId) {
    linkLocalOrderToCloud(db, order.id, cloudId);
    order.cloud_order_id = cloudId;
    console.log("[close-print] " + tag + " linked order#" + order.id + " -> " + cloudId);
  }

  const closeTableId = Number(order.table_id) || Number(table?.id);
  if (!closeTableId) {
    return { printed: false, skipped: true, reason: "table_missing" };
  }

  // Echo nga paneli: daily_log ekziston. Por sync-u telefonit shpesh e fut në daily_log
  // PARA printit — atëherë duhet ende të dalë fatura termike (pa closeTable dy herë).
  if (cloudId && typeof db.isCloudWaiterSaleImported === "function" && db.isCloudWaiterSaleImported(cloudId)) {
    const stillActive = order.status === "active" || order.status === "ordered";
    let hasReceipt = false;
    try {
      hasReceipt = !!db.db?.prepare?.(
        "SELECT id FROM receipts WHERE order_id = ? LIMIT 1",
      ).get(order.id);
    } catch { /* ignore */ }

    if (stillActive && !hasReceipt) {
      console.log(
        "[close-print] " + tag +
        " daily_log ekziston por pa faturë — print termik (pa closeTable dy herë) order#" +
        order.id,
      );
      const pay = String(opts.paymentMethod || order.payment_method || "cash").trim() || "cash";
      try {
        db.db?.prepare?.(
          "UPDATE orders SET status = 'completed', payment_method = ? WHERE id = ?",
        ).run(pay, order.id);
        db.db?.prepare?.("UPDATE tables SET status = 'free' WHERE id = ?").run(closeTableId);
      } catch { /* ignore */ }
      const closedOrder =
        typeof db.getOrderById === "function"
          ? db.getOrderById(order.id)
          : db.db?.prepare?.("SELECT * FROM orders WHERE id = ?")?.get(order.id) || {
              ...order,
              status: "completed",
              payment_method: pay,
            };
      const receipt = db.createReceipt(closedOrder.id);
      const closeTotal = resolveCloseTotal(closedOrder);
      if (closeTotal > 0 && Number(closedOrder.total) !== closeTotal) {
        closedOrder.total = closeTotal;
      }
      const printResult = await printClosedTableReceipt(db, {
        order: { ...closedOrder, total: closeTotal > 0 ? closeTotal : closedOrder.total },
        receipt,
        tableNumber: printTableNum,
        couponType: "thermal",
      });
      console.log("[close-print] " + tag + " print-after-daily_log", {
        printed: !!printResult?.printed,
        order_id: closedOrder.id,
      });
      return {
        ...printResult,
        order_id: closedOrder.id,
        reason: printResult?.printed ? "printed_after_daily_log" : "print_failed_after_daily_log",
      };
    }

    console.log("[close-print] " + tag + " SKIP already in daily_log cloud_sale_id=" + cloudId);
    if (stillActive) {
      try {
        db.db?.prepare?.("UPDATE orders SET status = 'completed' WHERE id = ?").run(order.id);
        db.db?.prepare?.("UPDATE tables SET status = 'free' WHERE id = ?").run(closeTableId);
      } catch { /* ignore */ }
    }
    return { printed: false, skipped: true, reason: "already_in_daily_log" };
  }

  const pay = String(opts.paymentMethod || order.payment_method || "cash").trim() || "cash";
  const closed = db.closeTable(closeTableId, order.waiter_name || "Kamarier", false, pay, null, {
    allowAnyWaiter: true,
  });
  if (!closed) return { printed: false, skipped: true, reason: "close_failed" };

  const receipt = db.createReceipt(closed.id);
  const closeTotal = resolveCloseTotal(closed);
  if (closeTotal > 0 && Number(closed.total) !== closeTotal) {
    closed.total = closeTotal;
  }

  /* SEF ON → processFiscalReceipt (rrit FIS · N + printon kuponin fiskal) */
  let fiscalResult = null;
  let fiscalError = "";
  try {
    const fiscalConfig = require("./fiscal/fiscal-config");
    const fiscalMain = require("./fiscal/fiscal-main");
    if (fiscalConfig.isFiscalEnabled()) {
      if (closeTotal <= 0) {
        fiscalError = "total_amount=0 — nuk mund të fiskalizohet (kontrollo çmimet e artikujve)";
        console.warn("[close-print] cloud close " + tag + " fiscal SKIP:", fiscalError);
      } else {
        fiscalResult = await fiscalMain.processFiscalReceipt(
          closed.id,
          pay,
          {
            operator_name: closed.waiter_name || "Kamarier",
            operator_id: "PHONE",
            total_amount: closeTotal,
          },
        );
        console.log("[close-print] cloud close " + tag + " fiscal:", {
          ok: !!fiscalResult?.ok,
          printed: !!fiscalResult?.printed,
          daily_number: fiscalResult?.daily_number,
          receipt_id: fiscalResult?.fiscal_receipt_id,
        });
      }
    }
  } catch (e) {
    fiscalError = e.message || String(e);
    console.warn("[close-print] fiscal processFiscalReceipt:", fiscalError);
  }

  let shouldPrintNormal = true;
  try {
    const fiscalMain = require("./fiscal/fiscal-main");
    shouldPrintNormal = fiscalMain.shouldPrintClosingNormalReceipt();
  } catch {
    shouldPrintNormal = true;
  }

  // SEF replace: vetëm fiskal — por nëse fiskali dështon, bëj fallback thermal.
  if (!shouldPrintNormal && fiscalResult?.printed) {
    console.log("[close-print] SEF replace — skip kupon normal (cloud close " + tag + ")", {
      fiscal_printed: true,
      order_id: closed.id,
    });
    return {
      printed: true,
      skipped: false,
      reason: "sef_fiscal_only",
      order_id: closed.id,
      fiscal_receipt: fiscalResult,
    };
  }
  if (!shouldPrintNormal && !fiscalResult?.printed) {
    console.warn("[close-print] SEF fiscal dështoi — fallback thermal " + tag, {
      error: fiscalError || "fiscal_not_printed",
      order_id: closed.id,
      total: closeTotal,
    });
  }

  const printResult = await printClosedTableReceipt(db, {
    order: { ...closed, total: closeTotal > 0 ? closeTotal : closed.total },
    receipt,
    tableNumber: printTableNum,
    couponType: "thermal",
  });
  console.log("[close-print] cloud close " + tag, {
    printed: !!printResult?.printed,
    order_id: closed.id,
    fiscal_printed: !!fiscalResult?.printed,
    fiscal_error: fiscalError || null,
    total: closeTotal,
  });
  return {
    ...printResult,
    order_id: closed.id,
    fiscal_receipt: fiscalResult,
    fiscal_error: fiscalError || null,
  };
}

module.exports = {
  normalizeCouponType,
  printClosedTableReceipt,
  printClosingReceiptIfActiveCloudOrder,
};
