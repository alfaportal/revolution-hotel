const cloudSync = require("./cloud-sync");
const printer = require("./printer");
const { buildReceiptText, finalizeReceiptText, plainTextFromServerBundle, stripEscPosMarkers } = require("./receipt-text");

async function printOrderReceipt(db, {
  order,
  tableNumber = 0,
  receiptNumber = "",
  orderNumber = "",
  fiscal = {},
  totals = {},
  items = [],
  closedAt = "",
  paymentMethod = "",
  slipKind = "",
  station = "bar",
  acceptedBy = "",
  discountTotal = 0,
  promotionName = "",
  subtotalBeforeDiscount = null,
}) {
  const parsedItems = Array.isArray(items) ? items : [];
  const total = Number(totals.total ?? order?.total ?? 0) || (
    parsedItems.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0)
  );
  const settings = db.getSettings();
  const kind = slipKind === "order" ? "order" : "final";
  const at = closedAt || new Date().toISOString();
  const targetStation = station === "kitchen" ? "kitchen" : "bar";

  let { printerName, paper } = await printer.ensureReceiptPrinter(db, targetStation);
  // Pa printer kuzhine të veçantë → printo fletën e ushqimit te printeri i barit (2 fletë të ndara).
  if (targetStation === "kitchen" && !printerName) {
    const barFallback = await printer.ensureReceiptPrinter(db, "bar");
    printerName = barFallback.printerName;
    paper = barFallback.paper || paper;
    if (!printerName) {
      return {
        printed: false,
        skipped: true,
        station: targetStation,
        printMessage: "Nuk ka printer kuzhine / bar të konfiguruar.",
      };
    }
  }
  const receiptWidthMm = paper === "58mm" ? 58 : 80;

  let bundle = null;
  try {
    bundle = await cloudSync.fetchReceiptFormat(db, {
      receipt_number: kind === "final" ? receiptNumber : "",
      order_number: kind === "order" ? String(orderNumber || "") : "",
      table_number: tableNumber,
      waiter_name: order?.waiter_name || "",
      accepted_by: acceptedBy || order?.accepted_by || "",
      source_label: order?.source_label || "",
      items: parsedItems,
      total,
      closed_at: at,
      printed_at: at,
      register_name: fiscal.biz_register_number || "",
      cashier_name: fiscal.biz_cashier_operator || "",
      receipt_width_mm: receiptWidthMm,
      payment_method: kind === "final" ? (paymentMethod || order?.payment_method || "") : "",
      slip_kind: kind,
      tvsh_enabled: kind === "final" ? !!fiscal.tvsh_enabled : false,
      tvsh_percent: fiscal.tvsh_percent,
      subtotal: kind === "final" && totals.subtotal != null ? totals.subtotal : null,
      vat: kind === "final" && totals.vat != null ? totals.vat : null,
    });
  } catch (err) {
    console.warn("Server receipt:", err.message);
  }

  const serverText = plainTextFromServerBundle(bundle);
  if (serverText.trim()) {
    try {
      const printResult = await printer.printPlainTextReceiptAt(
        finalizeReceiptText(serverText, paper),
        db,
        targetStation,
      );
      return {
        printed: true,
        source: "server-text",
        station: targetStation,
        html: bundle?.html || null,
        text: finalizeReceiptText(serverText, paper),
        printMessage: "",
        ...printResult,
      };
    } catch (err) {
      console.warn("Server text print:", err.message);
    }
  }

  if (bundle?.escpos_base64) {
    try {
      const printResult = await printer.printEscPosReceiptAt(bundle.escpos_base64, db, targetStation);
      return {
        printed: true,
        source: "server-escpos",
        station: targetStation,
        html: bundle?.html || null,
        printMessage: "",
        ...printResult,
      };
    } catch (err) {
      console.warn("Server ESC/POS print:", err.message);
    }
  }

  const receiptText = finalizeReceiptText(buildReceiptText({
    restaurantName: fiscal.biz_name || settings.restaurant_name,
    phone: fiscal.biz_phone || "",
    address: fiscal.biz_address || "",
    city: fiscal.biz_city || "",
    tableNumber,
    sourceLabel: order?.source_label || "",
    waiterName: order?.waiter_name || "",
    acceptedBy: acceptedBy || order?.accepted_by || "",
    items: parsedItems,
    total,
    receiptNumber,
    orderNumber,
    registerName: fiscal.biz_register_number || "",
    cashierName: fiscal.biz_cashier_operator || "",
    closedAt: at,
    paper,
    paymentMethod: kind === "final" ? (paymentMethod || order?.payment_method || "") : "",
    slipKind: kind,
    discountTotal,
    promotionName,
    subtotalBeforeDiscount,
    tvshEnabled: !!fiscal.tvsh_enabled,
    tvshPercent: fiscal.tvsh_percent,
    subtotal: totals.subtotal != null ? totals.subtotal : null,
    vat: totals.vat != null ? totals.vat : null,
  }), paper);
  const receiptTextDisplay = receiptText.split("\n").map(stripEscPosMarkers).join("\n");

  if (!printerName) {
    return {
      printed: false,
      source: "local",
      station: targetStation,
      html: bundle?.html || null,
      text: receiptTextDisplay,
      printMessage: "Nuk u gjet printer termik — lidhni printerin në Windows.",
      fallback: true,
    };
  }

  try {
    const printResult = await printer.printPlainTextReceiptAt(receiptText, db, targetStation);
    return {
      printed: true,
      source: "local",
      station: targetStation,
      html: bundle?.html || null,
      text: receiptTextDisplay,
      printMessage: "",
      ...printResult,
    };
  } catch (err) {
    return {
      printed: false,
      source: "local",
      station: targetStation,
      html: bundle?.html || null,
      text: receiptTextDisplay,
      printMessage: err.message || "Printimi dështoi.",
    };
  }
}

module.exports = {
  printOrderReceipt,
};
