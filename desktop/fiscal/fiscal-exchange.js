/**
 * Ndërrim artikulli (return + shitje e re) — logjikë e portuar nga BIZNES server.js.
 */
const { getFiscalSettings } = require("./fiscal-config");

function round2ex(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function listProductsForExchange(db) {
  if (typeof db.listProducts === "function") {
    return db.listProducts();
  }
  if (typeof db.getMenuItems === "function") {
    return (db.getMenuItems() || []).map((m) => ({
      id: m.id,
      name: m.name,
      price: Number(m.price) || 0,
      vat_letter: m.vat_letter || m.vat_norm || "E",
    }));
  }
  return [];
}

function sumSaleItems(saleItems) {
  return round2ex(
    (saleItems || []).reduce(
      (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0),
      0
    )
  );
}

async function runFiscalExchange(db, body, operator, deps) {
  const { processFiscalReceipt, printFiscalBundle } = deps;
  const nuikf = String(body?.nuikf || "")
    .trim()
    .toUpperCase();
  if (!nuikf) throw new Error("NUIKF origjinal mungon");

  const {
    getOriginalReceipt,
    getReturnableItemsForReceipt,
    createCorrectionReceipt,
    buildExchangeCorrectionReason,
  } = require("./fiscal-correction");

  const original = getOriginalReceipt(nuikf);
  if (!original) throw new Error("Kuponi origjinal nuk u gjet");

  const returnableItems = getReturnableItemsForReceipt(nuikf) || [];
  const products = listProductsForExchange(db);
  let selectedOld = [];
  let saleItems = [];

  if (Array.isArray(body?.exchange_lines) && body.exchange_lines.length) {
    for (const raw of body.exchange_lines) {
      const name = String(raw?.name || "").trim();
      const price = Number(raw?.unit_price ?? raw?.price) || 0;
      const qty = Number(raw?.quantity) || 0;
      const newProductId = Number(raw?.new_product_id) || 0;
      if (!name || qty <= 0 || !newProductId) continue;

      const match = returnableItems.find(
        (o) => o.name === name && Math.abs(o.unit_price - price) < 0.0001
      );
      if (!match) {
        throw new Error(`Artikulli nuk është në kuponin origjinal: ${name}`);
      }
      const remaining = Number(match.remaining_quantity) || 0;
      if (qty > remaining + 1e-9) {
        throw new Error(`Sasia tejkalon të mbeturën për: ${name} (max ${remaining})`);
      }

      const neu = products.find((p) => Number(p.id) === newProductId);
      if (!neu) throw new Error(`Produkti i ri nuk ekziston për: ${name}`);

      const oldVat = String(match.vat_norm || "E").toUpperCase();
      const newVat = String(neu.vat_letter || "E").toUpperCase();
      if (oldVat !== newVat) {
        throw new Error(`Norma TVSH duhet e njëjtë për ${name} (${oldVat} ≠ ${newVat})`);
      }

      selectedOld.push({
        name: match.name,
        quantity: qty,
        price: match.unit_price,
        unit_price: match.unit_price,
        vat_norm: oldVat,
      });
      saleItems.push({
        product_id: neu.id,
        name: neu.name,
        price: Number(neu.price) || 0,
        quantity: qty,
        vat_letter: newVat,
      });
    }
  } else if (Array.isArray(body?.old_items) && body.old_items.length) {
    const newProductId = Number(body?.new_product_id);
    if (!newProductId) throw new Error("Produkti i ri mungon");
    for (const raw of body.old_items) {
      const name = String(raw?.name || "").trim();
      const price = Number(raw?.unit_price ?? raw?.price) || 0;
      const qty = Number(raw?.quantity) || 0;
      if (!name || qty <= 0) continue;
      const match = returnableItems.find(
        (o) => o.name === name && Math.abs(o.unit_price - price) < 0.0001
      );
      if (!match) {
        throw new Error(`Artikulli nuk është në kuponin origjinal: ${name}`);
      }
      const remaining = Number(match.remaining_quantity) || 0;
      if (qty > remaining + 1e-9) {
        throw new Error(`Sasia tejkalon të mbeturën për: ${name} (max ${remaining})`);
      }
      selectedOld.push({
        name: match.name,
        quantity: qty,
        price: match.unit_price,
        unit_price: match.unit_price,
        vat_norm: match.vat_norm,
      });
    }
  } else {
    const newProductId = Number(body?.new_product_id);
    if (!newProductId) throw new Error("Produkti i ri mungon");
    const oldItems = original.items || [];
    let oldItem = null;
    if (body?.old_item && typeof body.old_item === "object") {
      oldItem = oldItems.find(
        (o) =>
          String(o.name) === String(body.old_item.name) &&
          Math.abs(Number(o.price) - Number(body.old_item.price)) < 0.0001
      );
    }
    if (!oldItem) oldItem = oldItems[Number(body?.old_index) || 0];
    if (!oldItem) throw new Error("Artikulli i vjetër nuk u gjet në kupon");
    const match = returnableItems.find(
      (o) =>
        o.name === String(oldItem.name || "").trim() &&
        Math.abs(o.unit_price - (Number(oldItem.unit_price ?? oldItem.price) || 0)) < 0.0001
    );
    const qty =
      Number(body?.quantity || match?.remaining_quantity || oldItem.quantity || 1) || 1;
    if (qty <= 0) throw new Error("Sasia duhet > 0");
    const remaining = Number(match?.remaining_quantity ?? qty) || 0;
    if (qty > remaining + 1e-9) {
      throw new Error(`Sasia tejkalon të mbeturën për: ${oldItem.name} (max ${remaining})`);
    }
    selectedOld = [
      {
        name: String(oldItem.name || "").trim(),
        quantity: qty,
        price: Number(oldItem.unit_price ?? oldItem.price) || 0,
        unit_price: Number(oldItem.unit_price ?? oldItem.price) || 0,
        vat_norm: String(oldItem.vat_norm || oldItem.vat_letter || "E").toUpperCase(),
      },
    ];
    const neu = products.find((p) => Number(p.id) === newProductId);
    if (!neu) throw new Error("Produkti i ri nuk ekziston");
    const oldVat = String(selectedOld[0].vat_norm || "E").toUpperCase();
    const newVat = String(neu.vat_letter || "E").toUpperCase();
    if (oldVat !== newVat) {
      throw new Error(`Norma TVSH duhet e njëjtë (${oldVat} ≠ ${newVat})`);
    }
    saleItems = [
      {
        product_id: neu.id,
        name: neu.name,
        price: Number(neu.price) || 0,
        quantity: qty,
        vat_letter: newVat,
      },
    ];
  }

  if (!selectedOld.length) {
    throw new Error("Zgjidhni të paktën një artikull për ndërrim");
  }

  if (!saleItems.length) {
    const newProductId = Number(body?.new_product_id);
    if (!newProductId) throw new Error("Produkti i ri mungon");
    const neu = products.find((p) => Number(p.id) === newProductId);
    if (!neu) throw new Error("Produkti i ri nuk ekziston");
    const oldVatSet = new Set(selectedOld.map((it) => String(it.vat_norm || "E").toUpperCase()));
    if (oldVatSet.size !== 1) {
      throw new Error("Artikujt e zgjedhur duhet të kenë të njëjtën normë TVSH");
    }
    const oldVat = [...oldVatSet][0];
    const newVat = String(neu.vat_letter || "E").toUpperCase();
    if (oldVat !== newVat) {
      throw new Error(`Norma TVSH duhet e njëjtë (${oldVat} ≠ ${newVat})`);
    }
    const totalQty = selectedOld.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    saleItems = [
      {
        product_id: neu.id,
        name: neu.name,
        price: Number(neu.price) || 0,
        quantity: totalQty,
        vat_letter: newVat,
      },
    ];
  }

  const oldLineTotal = round2ex(
    selectedOld.reduce(
      (s, it) => s + (Number(it.unit_price ?? it.price) || 0) * (Number(it.quantity) || 0),
      0
    )
  );
  const newLineTotal = sumSaleItems(saleItems);
  const difference = round2ex(newLineTotal - oldLineTotal);
  let scenario = "equal";
  if (difference > 0.02) scenario = "upgrade";
  else if (difference < -0.02) scenario = "downgrade";

  const paymentMethod =
    String(body?.payment_method || original.payment_method || "cash")
      .trim()
      .toLowerCase() || "cash";

  if (scenario === "upgrade" && (paymentMethod === "cash" || paymentMethod === "mixed")) {
    const received = Number(body?.amount_received);
    if (!Number.isFinite(received) || received + 1e-9 < difference) {
      throw new Error(
        `Klienti duhet të paguajë diferencën ${difference.toFixed(2)} €` +
          (Number.isFinite(received)
            ? ` (marrë: ${received.toFixed(2)} €)`
            : " — vendosni shumën e marrë")
      );
    }
  }
  if (scenario === "downgrade" && !body?.refund_acknowledged) {
    throw new Error(
      `Konfirmoni kthimin e ${Math.abs(difference).toFixed(2)} € klientit (refund_acknowledged)`
    );
  }

  const reason = buildExchangeCorrectionReason(selectedOld, saleItems);

  const ret = createCorrectionReceipt(nuikf, "return", selectedOld, reason, {
    operator_name: operator.operator_name,
    operator_id: operator.operator_id,
  });

  const { generateFiscalQR } = require("./fiscal-qr");
  const { isAtkTransmissionBlocked } = require("./fiscal-test-mode-store");

  let qr = null;
  try {
    const settings = getFiscalSettings();
    qr = await generateFiscalQR({
      nuikf: ret.nuikf,
      total_amount: ret.total_amount,
      fiscal_date: ret.fiscal_date,
      taxpayer_nui: settings.taxpayer_nui,
    });
  } catch {
    /* */
  }

  let printedReturn = false;
  let atkReturn = { atk_sent: false, atk_message: "LOKAL — pa dërgim te ATK" };
  let printOfflineBanner = false;
  if (!isAtkTransmissionBlocked()) {
    const { tryAutoSendFiscalReceiptById } = require("./fiscal-offline");
    atkReturn = await tryAutoSendFiscalReceiptById(ret.id);
    if (
      !atkReturn.atk_sent &&
      !atkReturn.atk_test_mode &&
      atkReturn.atk_status === "send_failed"
    ) {
      printOfflineBanner = true;
    }
  }

  if (!body?.skip_print && ret.print_text) {
    const pr = await printFiscalBundle(ret.print_text, qr, {
      printOfflineBanner,
    });
    printedReturn = !!pr.printed;
  }

  let sale;
  if (typeof db.createSale === "function") {
    sale = db.createSale({
      items: saleItems,
      payment_method: paymentMethod,
      operator_name: operator.operator_name,
    });
  } else {
    const newOrderId = Number(body?.new_order_id);
    if (!newOrderId) {
      throw new Error(
        "Pas kthimit, shitja e re kërkon new_order_id (porosi HOTEL e mbyllur) ose modul createSale"
      );
    }
    sale = {
      id: newOrderId,
      items: saleItems,
      total: newLineTotal,
      subtotal: newLineTotal,
      payment_method: paymentMethod,
      operator_name: operator.operator_name,
    };
  }

  const fiscalNew = await processFiscalReceipt(sale.id, sale.payment_method, {
    items: sale.items,
    operator_name: sale.operator_name,
    operator_id: operator.operator_id,
    total_amount: sale.total,
    subtotal: sale.subtotal,
    amount_paid: newLineTotal,
    skip_print: !!body?.skip_print,
  });

  return {
    exchange: {
      scenario,
      old_line_total: oldLineTotal,
      new_line_total: newLineTotal,
      difference,
      amount_received: scenario === "upgrade" ? round2ex(body?.amount_received) : null,
      refund_amount: scenario === "downgrade" ? round2ex(Math.abs(difference)) : null,
      payment_method: paymentMethod,
    },
    return_coupon: {
      id: ret.id,
      nuikf: ret.nuikf,
      original_nuikf: ret.original_nuikf,
      receipt_type: ret.receipt_type,
      total_amount: ret.total_amount,
      printed: printedReturn,
      atk: atkReturn,
    },
    new_sale: {
      order_id: sale.id,
      total: sale.total,
      fiscal: fiscalNew,
    },
  };
}

module.exports = { runFiscalExchange };
