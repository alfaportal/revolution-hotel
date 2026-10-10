"use strict";

const dbMod = require("./database");

function sqlite() {
  return dbMod.db;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const PAYABLE_INVOICE_STATUSES = new Set(["final", "printed", "emailed"]);

function computePaymentStatus(amountPaid, grandTotal) {
  const paid = roundMoney(amountPaid);
  const total = roundMoney(grandTotal);
  const tol = 0.02;
  if (total <= 0 && paid > 0) return "paid";
  if (total > 0 && paid + tol >= total) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

function normalizeB2bPaymentMethod(raw) {
  const v = String(raw || "cash").trim().toLowerCase();
  if (["bank", "banke", "bankë", "transfer", "bank_transfer"].includes(v)) return "bank_account";
  if (["karte", "kartë", "card", "kart"].includes(v)) return "karte";
  if (["cash", "para"].includes(v)) return "cash";
  return dbMod.normalizePaymentMethod(v);
}

function paymentMethodLabel(method) {
  const m = normalizeB2bPaymentMethod(method);
  if (m === "bank_account") return "Bankë";
  if (m === "karte") return "Kartë";
  return "Cash";
}

function enrichInvoicePaymentFields(invRow, invoiceObj) {
  const grand = roundMoney(invoiceObj.totals?.grandTotal ?? invRow.grand_total);
  const paid = roundMoney(invRow.amount_paid);
  const balanceDue = roundMoney(Math.max(0, grand - paid));
  const paymentStatus = computePaymentStatus(paid, grand);
  return {
    ...invoiceObj,
    amountPaid: paid,
    paymentStatus,
    balanceDue,
  };
}

function listPaymentsForInvoice(invoiceId) {
  return sqlite()
    .prepare(`
      SELECT * FROM sales_invoice_payments
      WHERE invoice_id = ?
      ORDER BY payment_date ASC, id ASC
    `)
    .all(Number(invoiceId))
    .map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      paymentDate: row.payment_date,
      amount: roundMoney(row.amount),
      paymentMethod: normalizeB2bPaymentMethod(row.payment_method),
      paymentMethodLabel: paymentMethodLabel(row.payment_method),
      note: row.note || "",
      dailyLogId: row.daily_log_id,
      createdAt: row.created_at,
    }));
}

function lineTotal(line) {
  const qty = Number(line.qty) || 0;
  const price = Number(line.unitPrice) || 0;
  const base = roundMoney(qty * price);
  const disc = line.discount?.value
    ? (String(line.discount.type || "").toLowerCase() === "percent"
      ? roundMoney((base * (Number(line.discount.value) || 0)) / 100)
      : roundMoney(Number(line.discount.value) || 0))
    : 0;
  return roundMoney(Math.max(0, base - disc));
}

function computeTotals(lines, vat) {
  const arr = lines || [];
  const hasInvLines = arr.some((ln) => ln.sumGross != null && Number.isFinite(Number(ln.sumGross)));
  if (hasInvLines) {
    const subtotal = roundMoney(arr.reduce((s, ln) => s + (Number(ln.sumNet) || 0), 0));
    const vatAmount = roundMoney(arr.reduce((s, ln) => s + (Number(ln.sumVat) || 0), 0));
    const grandTotal = roundMoney(arr.reduce((s, ln) => s + (Number(ln.sumGross) || 0), 0));
    let percent = Number(vat?.percent);
    if (!Number.isFinite(percent) || percent < 0) percent = 18;
    return {
      subtotal,
      vatAmount,
      grandTotal,
      vatPercent: vatAmount > 0 ? percent : 0,
    };
  }
  const subtotal = roundMoney(arr.reduce((s, ln) => s + lineTotal(ln), 0));
  const enabled = Boolean(vat?.enabled);
  let percent = Number(vat?.percent);
  if (!Number.isFinite(percent) || percent < 0) percent = 18;
  if (!enabled) {
    return { subtotal, vatAmount: 0, grandTotal: subtotal, vatPercent: 0 };
  }
  const vatAmount = roundMoney((subtotal * percent) / 100);
  return {
    subtotal,
    vatAmount,
    grandTotal: roundMoney(subtotal + vatAmount),
    vatPercent: percent,
  };
}

function getInvoiceSettings() {
  const vatOn = dbMod.getSetting("sales_invoice_vat_enabled", "0") === "1";
  const pct = Number(dbMod.getSetting("sales_invoice_vat_percent", "18")) || 18;
  const logo = String(dbMod.getSetting("sales_invoice_logo_data_url", "") || "").trim()
    || String(dbMod.getSetting("venue_logo_data_url", "") || "").trim();
  return {
    vatEnabled: vatOn,
    vatPercent: Math.max(0, Math.min(100, pct)),
    companyLogoUrl: logo,
  };
}

function updateInvoiceSettings(body) {
  if (body.vatEnabled != null) {
    dbMod.setSetting("sales_invoice_vat_enabled", body.vatEnabled ? "1" : "0");
  }
  if (body.vatPercent != null) {
    const p = Number(body.vatPercent);
    dbMod.setSetting(
      "sales_invoice_vat_percent",
      String(Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 18),
    );
  }
  if (body.companyLogoUrl === "") {
    dbMod.setSetting("sales_invoice_logo_data_url", "");
  }
  return getInvoiceSettings();
}

function saveLogoBase64(imageBase64, contentType) {
  const b64 = String(imageBase64 || "").trim();
  if (!b64) throw new Error("Mungon imazhi.");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 2 * 1024 * 1024) throw new Error("Logo shumë e madhe (max 2MB).");
  const ct = String(contentType || "image/png").trim();
  const dataUrl = `data:${ct};base64,${b64}`;
  dbMod.setSetting("sales_invoice_logo_data_url", dataUrl);
  return dataUrl;
}

function getSellerSnapshot() {
  const fiscal = dbMod.getFiscalSettings();
  const settings = dbMod.getSettings();
  const inv = getInvoiceSettings();
  const companyName = String(fiscal.biz_name || settings.restaurant_name || "Hotel").trim();
  return {
    companyName,
    companyNameDisplay: companyName.toLocaleUpperCase("sq-AL"),
    nui: String(fiscal.biz_vat_number || "").trim(),
    fiscalNumber: String(fiscal.biz_fiscal_number || "").trim(),
    address: String(fiscal.biz_address || "").trim(),
    city: String(fiscal.biz_city || "").trim(),
    phone: String(fiscal.biz_phone || settings.biz_phone || "").trim(),
    email: String(dbMod.getSetting("biz_email", "") || "").trim(),
    logoUrl: inv.companyLogoUrl,
    currency: "€",
  };
}

function allocateInvoiceNumber() {
  const year = new Date().getFullYear();
  return sqlite().transaction(() => {
    let row = sqlite()
      .prepare("SELECT next_seq FROM sales_invoice_counters WHERE year = ?")
      .get(year);
    if (!row) {
      sqlite()
        .prepare("INSERT INTO sales_invoice_counters (year, next_seq) VALUES (?, 1)")
        .run(year);
      row = { next_seq: 1 };
    }
    const seq = Number(row.next_seq) || 1;
    sqlite()
      .prepare("UPDATE sales_invoice_counters SET next_seq = next_seq + 1 WHERE year = ?")
      .run(year);
    return `${year}-${String(seq).padStart(4, "0")}`;
  })();
}

function guestFromRow(row) {
  return {
    kind: row.guest_kind === "company" ? "company" : "individual",
    name: row.guest_name || "",
    companyName: row.guest_company_name || "",
    address: row.guest_address || "",
    nui: row.guest_nui || "",
    fiscalNumber: row.guest_fiscal_number || "",
    email: row.guest_email || "",
    phone: row.guest_phone || "",
  };
}

function rowToInvoice(row, lines) {
  const guest = guestFromRow(row);
  const vat = {
    enabled: Number(row.vat_enabled) === 1,
    percent: Number(row.vat_percent) || 18,
  };
  const normLines = (lines || []).map((ln) => ({
    description: ln.description,
    qty: ln.qty,
    unitPrice: ln.unit_price,
    discount: { type: ln.discount_type || "amount", value: ln.discount_value || 0 },
    lineTotal: ln.line_total,
  }));
  const base = {
    id: row.id,
    number: row.number,
    date: row.invoice_date,
    status: row.status,
    guest,
    lines: normLines,
    vat,
    totals: {
      subtotal: row.subtotal,
      vatAmount: row.vat_amount,
      grandTotal: row.grand_total,
      vatPercent: vat.percent,
    },
    sellerSnapshot: getSellerSnapshot(),
    orderId: row.order_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const enriched = enrichInvoicePaymentFields(row, base);
  enriched.payments = listPaymentsForInvoice(row.id);
  return enriched;
}

function listInvoices({ q, status, payment_status, limit = 200 } = {}) {
  let sql = "SELECT * FROM sales_invoices WHERE 1=1";
  const params = [];
  if (status && status !== "Të gjitha") {
    sql += " AND status = ?";
    params.push(status);
  }
  if (payment_status && payment_status !== "Të gjitha") {
    sql += " AND payment_status = ?";
    params.push(payment_status);
  }
  sql += " ORDER BY id DESC LIMIT ?";
  params.push(Math.min(500, Math.max(1, Number(limit) || 200)));
  const rows = sqlite().prepare(sql).all(...params);
  const qq = String(q || "").trim().toLowerCase();
  return rows
    .filter((row) => {
      if (!qq) return true;
      const g = guestFromRow(row);
      const label = g.kind === "company" ? g.companyName : g.name;
      return (
        String(row.number || "").toLowerCase().includes(qq)
        || String(label || "").toLowerCase().includes(qq)
      );
    })
    .map((row) => {
      const lines = sqlite()
        .prepare(
          "SELECT * FROM sales_invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id",
        )
        .all(row.id);
      return rowToInvoice(row, lines);
    });
}

function getInvoiceById(id) {
  const row = sqlite().prepare("SELECT * FROM sales_invoices WHERE id = ?").get(Number(id));
  if (!row) return null;
  const lines = sqlite()
    .prepare("SELECT * FROM sales_invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id")
    .all(row.id);
  return rowToInvoice(row, lines);
}

function normalizeGuest(g) {
  const kind = g?.kind === "company" ? "company" : "individual";
  return {
    kind,
    name: String(g?.name || "").trim(),
    companyName: String(g?.companyName || "").trim(),
    address: String(g?.address || "").trim(),
    nui: String(g?.nui || "").trim(),
    fiscalNumber: String(g?.fiscalNumber || "").trim(),
    email: String(g?.email || "").trim(),
    phone: String(g?.phone || "").trim(),
  };
}

function saveInvoice(payload, { id, number: fixedNumber } = {}) {
  const guest = normalizeGuest(payload.guest);
  const settings = getInvoiceSettings();
  const vat = {
    enabled: payload.vat?.enabled != null ? !!payload.vat.enabled : settings.vatEnabled,
    percent: payload.vat?.percent != null ? Number(payload.vat.percent) : settings.vatPercent,
  };
  const linesIn = Array.isArray(payload.lines) ? payload.lines : [];
  const lines = linesIn.map((ln, idx) => {
    const row = {
      description: String(ln.description || "").trim(),
      qty: Number(ln.qty) || 0,
      unitPrice: Number(ln.unitPrice) || 0,
      discount: ln.discount || { type: "amount", value: 0 },
      sumNet: ln.sumNet != null ? Number(ln.sumNet) : null,
      sumVat: ln.sumVat != null ? Number(ln.sumVat) : null,
      sumGross: ln.sumGross != null ? Number(ln.sumGross) : null,
    };
    const lineTotalVal =
      row.sumNet != null && Number.isFinite(row.sumNet)
        ? roundMoney(row.sumNet)
        : lineTotal(row);
    return { ...row, lineTotal: lineTotalVal, sort_order: idx };
  });
  const vatForTotals = {
    enabled: vat.enabled || lines.some((ln) => (Number(ln.sumVat) || 0) > 0),
    percent: vat.percent,
  };
  const totals = computeTotals(lines, vatForTotals);
  const number = fixedNumber || String(payload.number || "").trim() || allocateInvoiceNumber();
  const date = String(payload.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const status = String(payload.status || "final").trim() || "final";
  const orderId = payload.orderId != null ? Number(payload.orderId) : null;
  const now = new Date().toISOString();

  return sqlite().transaction(() => {
    let invoiceId = id ? Number(id) : null;
    let amountPaid = 0;
    if (invoiceId) {
      const existing = sqlite().prepare("SELECT * FROM sales_invoices WHERE id = ?").get(invoiceId);
      if (!existing) throw new Error("Fatura nuk u gjet.");
      amountPaid = roundMoney(existing.amount_paid);
      const paymentStatus = computePaymentStatus(amountPaid, totals.grandTotal);
      sqlite().prepare(`
        UPDATE sales_invoices SET
          number = ?, invoice_date = ?, status = ?,
          guest_kind = ?, guest_name = ?, guest_company_name = ?,
          guest_address = ?, guest_nui = ?, guest_fiscal_number = ?,
          guest_email = ?, guest_phone = ?,
          vat_enabled = ?, vat_percent = ?,
          subtotal = ?, vat_amount = ?, grand_total = ?,
          amount_paid = ?, payment_status = ?,
          order_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        number,
        date,
        status,
        guest.kind,
        guest.name,
        guest.companyName,
        guest.address,
        guest.nui,
        guest.fiscalNumber,
        guest.email,
        guest.phone,
        vat.enabled ? 1 : 0,
        vat.percent,
        totals.subtotal,
        totals.vatAmount,
        totals.grandTotal,
        amountPaid,
        paymentStatus,
        orderId,
        now,
        invoiceId,
      );
      sqlite().prepare("DELETE FROM sales_invoice_lines WHERE invoice_id = ?").run(invoiceId);
    } else {
      const ins = sqlite().prepare(`
        INSERT INTO sales_invoices (
          number, invoice_date, status,
          guest_kind, guest_name, guest_company_name,
          guest_address, guest_nui, guest_fiscal_number,
          guest_email, guest_phone,
          vat_enabled, vat_percent,
          subtotal, vat_amount, grand_total,
          amount_paid, payment_status,
          order_id, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        number,
        date,
        status,
        guest.kind,
        guest.name,
        guest.companyName,
        guest.address,
        guest.nui,
        guest.fiscalNumber,
        guest.email,
        guest.phone,
        vat.enabled ? 1 : 0,
        vat.percent,
        totals.subtotal,
        totals.vatAmount,
        totals.grandTotal,
        0,
        "unpaid",
        orderId,
        now,
        now,
      );
      invoiceId = Number(ins.lastInsertRowid);
    }
    const insLine = sqlite().prepare(`
      INSERT INTO sales_invoice_lines (
        invoice_id, sort_order, description, qty, unit_price,
        discount_type, discount_value, line_total
      ) VALUES (?,?,?,?,?,?,?,?)
    `);
    lines.forEach((ln, idx) => {
      insLine.run(
        invoiceId,
        idx,
        ln.description,
        ln.qty,
        ln.unitPrice,
        ln.discount?.type || "amount",
        Number(ln.discount?.value) || 0,
        ln.lineTotal,
      );
    });
    return getInvoiceById(invoiceId);
  })();
}

function deleteInvoice(id) {
  const n = Number(id);
  if (!n) throw new Error("ID i pavlefshëm.");
  sqlite().prepare("DELETE FROM sales_invoice_payments WHERE invoice_id = ?").run(n);
  sqlite().prepare("DELETE FROM sales_invoice_lines WHERE invoice_id = ?").run(n);
  const r = sqlite().prepare("DELETE FROM sales_invoices WHERE id = ?").run(n);
  if (!r.changes) throw new Error("Fatura nuk u gjet.");
  return { ok: true };
}

function addInvoicePayment(invoiceId, body = {}) {
  const id = Number(invoiceId);
  if (!id) throw new Error("ID i pavlefshëm.");
  const row = sqlite().prepare("SELECT * FROM sales_invoices WHERE id = ?").get(id);
  if (!row) throw new Error("Fatura nuk u gjet.");
  const st = String(row.status || "").trim();
  if (!PAYABLE_INVOICE_STATUSES.has(st)) {
    throw new Error("Pagesa lejohet vetëm për fatura finalizuar (final / printuar / email).");
  }
  if (String(row.guest_kind || "") !== "company") {
    throw new Error("Pagesat me borxh vlejnë për klientët B2B (kompani).");
  }
  const add = roundMoney(body.amount);
  if (!Number.isFinite(add) || add <= 0) throw new Error("Shuma e pagesës duhet > 0.");
  const grand = roundMoney(row.grand_total);
  const paidBefore = roundMoney(row.amount_paid);
  const balance = roundMoney(Math.max(0, grand - paidBefore));
  if (balance <= 0) throw new Error("Fatura është e paguar.");
  const payAmount = add > balance + 0.02 ? balance : add;
  const method = normalizeB2bPaymentMethod(body.payment_method);
  const paymentDate = String(body.payment_date || body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const note = String(body.note || body.notes || "").trim();
  const waiterName = String(body.waiter_name || "Recepsion").trim() || "Recepsion";

  let dailyLogId = null;
  const company = String(row.guest_company_name || row.guest_name || "B2B").trim();
  const label = `Pagesë faturë B2B ${row.number} — ${company}`;
  if (method === "cash" || method === "karte") {
    dbMod.recordRecepcionKasaSale({
      items: [{ name: label, quantity: 1, price: payAmount }],
      payment_method: method === "karte" ? "karte" : "cash",
      waiter_name: waiterName,
    });
    dailyLogId = sqlite()
      .prepare(`
        SELECT id FROM daily_log
        WHERE receipt_number LIKE 'RC-%'
        ORDER BY id DESC LIMIT 1
      `)
      .get()?.id || null;
  }

  return sqlite().transaction(() => {
    const ins = sqlite().prepare(`
      INSERT INTO sales_invoice_payments (
        invoice_id, payment_date, amount, payment_method, note, daily_log_id
      ) VALUES (?,?,?,?,?,?)
    `).run(id, paymentDate, payAmount, method, note, dailyLogId);

    const newPaid = roundMoney(paidBefore + payAmount);
    const paymentStatus = computePaymentStatus(newPaid, grand);
    sqlite().prepare(`
      UPDATE sales_invoices SET amount_paid = ?, payment_status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newPaid, paymentStatus, id);

    return {
      payment: {
        id: Number(ins.lastInsertRowid),
        invoiceId: id,
        paymentDate,
        amount: payAmount,
        paymentMethod: method,
        paymentMethodLabel: paymentMethodLabel(method),
        note,
        dailyLogId,
      },
      invoice: getInvoiceById(id),
    };
  })();
}

function listBusinessDebts() {
  const rows = sqlite().prepare(`
    SELECT
      guest_company_name,
      guest_nui,
      guest_name,
      guest_phone,
      guest_email,
      COUNT(*) AS invoice_count,
      COALESCE(SUM(grand_total), 0) AS invoiced_total,
      COALESCE(SUM(amount_paid), 0) AS paid_total
    FROM sales_invoices
    WHERE guest_kind = 'company'
      AND status IN ('final', 'printed', 'emailed')
    GROUP BY guest_company_name, guest_nui
    HAVING invoiced_total - paid_total > 0.02
    ORDER BY (invoiced_total - paid_total) DESC, guest_company_name ASC
  `).all();

  return rows.map((r) => {
    const invoiced = roundMoney(r.invoiced_total);
    const paid = roundMoney(r.paid_total);
    const balance = roundMoney(Math.max(0, invoiced - paid));
    return {
      companyName: String(r.guest_company_name || "").trim(),
      nui: String(r.guest_nui || "").trim(),
      contactName: String(r.guest_name || "").trim(),
      phone: String(r.guest_phone || "").trim(),
      email: String(r.guest_email || "").trim(),
      invoiceCount: Number(r.invoice_count) || 0,
      invoicedTotal: invoiced,
      paidTotal: paid,
      balanceDue: balance,
    };
  });
}

function mapItemsToLines(items) {
  return (Array.isArray(items) ? items : [])
    .map((i) => ({
      description: String(i.name || i.emri || i.description || "").trim(),
      qty: Number(i.quantity ?? i.qty ?? 1) || 1,
      unitPrice: Number(i.price ?? i.cmimi ?? i.unitPrice ?? 0) || 0,
      discount: { type: "amount", value: 0 },
    }))
    .filter((ln) => ln.description);
}

function prefillFromSale({ order_id, items }) {
  let order = null;
  const oid = Number(order_id);
  if (oid) {
    order = sqlite()
      .prepare("SELECT id, status, items_json, total, created_at FROM orders WHERE id = ?")
      .get(oid);
    if (!order) throw new Error("Shitja nuk u gjet.");
    if (String(order.status || "").toLowerCase() !== "completed") {
      throw new Error("Shitja duhet të jetë e mbyllur para faturës A4.");
    }
  }
  const rawItems = Array.isArray(items) && items.length
    ? items
    : (order ? JSON.parse(order.items_json || "[]") : []);
  let parsed = rawItems;
  if (typeof rawItems === "string") {
    try {
      parsed = JSON.parse(rawItems);
    } catch {
      parsed = [];
    }
  }
  const lines = mapItemsToLines(parsed);
  if (!lines.length) throw new Error("Nuk ka artikuj për faturën A4.");
  const settings = getInvoiceSettings();
  const closedAt = order?.created_at || new Date().toISOString();
  const date = String(closedAt).slice(0, 10);
  return {
    seller: getSellerSnapshot(),
    settings: {
      vatEnabled: settings.vatEnabled,
      vatPercent: settings.vatPercent,
      companyLogoUrl: settings.companyLogoUrl,
    },
    lines,
    date,
    orderId: order ? order.id : null,
  };
}

function buildInvoiceDocFromPayload(body) {
  const settings = getInvoiceSettings();
  const vat = {
    enabled: body.vat?.enabled != null ? !!body.vat.enabled : settings.vatEnabled,
    percent: body.vat?.percent != null ? Number(body.vat.percent) : settings.vatPercent,
  };
  const lines = (body.lines || []).map((ln) => ({
    ...ln,
    lineTotal: lineTotal(ln),
  }));
  const totals = computeTotals(lines, vat);
  return {
    id: body.id,
    number: body.number,
    date: body.date,
    status: body.status || "final",
    guest: normalizeGuest(body.guest),
    lines,
    vat,
    totals,
    sellerSnapshot: getSellerSnapshot(),
  };
}

module.exports = {
  getInvoiceSettings,
  updateInvoiceSettings,
  saveLogoBase64,
  getSellerSnapshot,
  allocateInvoiceNumber,
  listInvoices,
  getInvoiceById,
  saveInvoice,
  deleteInvoice,
  addInvoicePayment,
  listPaymentsForInvoice,
  listBusinessDebts,
  computePaymentStatus,
  prefillFromSale,
  buildInvoiceDocFromPayload,
  computeTotals,
  lineTotal,
};
