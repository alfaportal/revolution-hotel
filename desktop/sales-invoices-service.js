"use strict";

const dbMod = require("./database");

function sqlite() {
  return dbMod.db;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
  const subtotal = roundMoney((lines || []).reduce((s, ln) => s + lineTotal(ln), 0));
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
  return {
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
}

function listInvoices({ q, status, limit = 200 } = {}) {
  let sql = "SELECT * FROM sales_invoices WHERE 1=1";
  const params = [];
  if (status && status !== "Të gjitha") {
    sql += " AND status = ?";
    params.push(status);
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
    };
    return { ...row, lineTotal: lineTotal(row), sort_order: idx };
  });
  const totals = computeTotals(lines, vat);
  const number = fixedNumber || String(payload.number || "").trim() || allocateInvoiceNumber();
  const date = String(payload.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const status = String(payload.status || "final").trim() || "final";
  const orderId = payload.orderId != null ? Number(payload.orderId) : null;
  const now = new Date().toISOString();

  return sqlite().transaction(() => {
    let invoiceId = id ? Number(id) : null;
    if (invoiceId) {
      const existing = sqlite().prepare("SELECT id FROM sales_invoices WHERE id = ?").get(invoiceId);
      if (!existing) throw new Error("Fatura nuk u gjet.");
      sqlite().prepare(`
        UPDATE sales_invoices SET
          number = ?, invoice_date = ?, status = ?,
          guest_kind = ?, guest_name = ?, guest_company_name = ?,
          guest_address = ?, guest_nui = ?, guest_fiscal_number = ?,
          guest_email = ?, guest_phone = ?,
          vat_enabled = ?, vat_percent = ?,
          subtotal = ?, vat_amount = ?, grand_total = ?,
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
          order_id, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
  sqlite().prepare("DELETE FROM sales_invoice_lines WHERE invoice_id = ?").run(n);
  const r = sqlite().prepare("DELETE FROM sales_invoices WHERE id = ?").run(n);
  if (!r.changes) throw new Error("Fatura nuk u gjet.");
  return { ok: true };
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
  prefillFromSale,
  buildInvoiceDocFromPayload,
  computeTotals,
  lineTotal,
};
