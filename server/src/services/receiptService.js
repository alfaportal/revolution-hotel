const { getSupabase } = require("../db");
const { buildEscPosFromLines, toBase64 } = require("../lib/receiptEscPos");

function getClientById(clientId) {
  const { getClientById: loadClient } = require("./salesService");
  return loadClient(clientId);
}

function paperChars(widthMm) {
  return Number(widthMm) <= 58 ? 32 : 48;
}

function pad(str, width, align = "left") {
  const s = String(str ?? "");
  if (s.length >= width) return s.slice(0, width);
  const gap = width - s.length;
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + s + " ".repeat(gap - left);
  }
  return s + " ".repeat(gap);
}

function divider(width, char = "-") {
  return char.repeat(width);
}

function formatMoney(n) {
  return Number(n || 0).toFixed(2);
}

const RECEIPT_TIMEZONE = "Europe/Belgrade";

function formatReceiptDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) {
    return formatReceiptDateTime(new Date().toISOString());
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: RECEIPT_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d).map(p => [p.type, p.value]),
  );
  return {
    date: `${parts.day}/${parts.month}/${parts.year}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

async function getBusinessProfile(clientId) {
  const client = await getClientById(clientId);
  const db = getSupabase();
  const { data: settings } = await db
    .from("pos_settings")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  const widthMm = [58, 80].includes(Number(settings?.receipt_width_mm))
    ? Number(settings.receipt_width_mm)
    : 80;

  return {
    business_name: String(settings?.restaurant_name || client?.emri || "").trim(),
    address: String(settings?.address || client?.adresa || "").trim(),
    phone: String(settings?.phone || client?.telefoni || "").trim(),
    nui: String(settings?.nui || "").trim(),
    tvsh_nr: String(settings?.tvsh_nr || "").trim(),
    receipt_width_mm: widthMm,
  };
}

function normalizeReceiptItems(items) {
  return (Array.isArray(items) ? items : []).map(i => ({
    name: String(i.name || i.emri || "").trim(),
    quantity: Number(i.quantity) || 1,
    price: Number(i.price ?? i.cmimi ?? 0) || 0,
  })).filter(i => i.name);
}

function paymentMethodLabel(raw) {
  const v = String(raw || "cash").trim().toLowerCase();
  if (["karte", "kartë", "card", "kart"].includes(v)) return "Kartë";
  return "Cash";
}

function displayReceiptNumber(receiptNumber, orderNumber, slipKind) {
  const raw = slipKind === "order"
    ? String(orderNumber || "").trim()
    : String(receiptNumber || orderNumber || "").trim();
  if (!raw) return "";
  const part = raw.includes("-") ? raw.split("-").pop() : raw;
  const digits = String(part).replace(/\D/g, "");
  return digits ? digits.padStart(6, "0") : raw;
}

function resolveVenueLine({ tableNumber = 0, sourceLabel = "" } = {}) {
  const num = Number(tableNumber) || 0;
  const src = String(sourceLabel || "").trim();
  if (num >= 1) return `Tavolina: T${num}`;
  if (/takeaway/i.test(src)) return "Takeaway";
  if (/delivery/i.test(src)) return "Delivery";
  const onlineMatch = src.match(/online\s*\d+/i);
  if (onlineMatch) return onlineMatch[0].replace(/\s+/g, " ");
  if (/^online\b/i.test(src)) return src || "Online";
  const qrTable = src.match(/\bT\s*(\d+)\b/i);
  if (qrTable) return `Tavolina: T${qrTable[1]}`;
  if (src) return src;
  return "";
}

function buildReceiptPayload(clientId, business, body) {
  const items = normalizeReceiptItems(body.items);
  const total = Number(body.total) || items.reduce((s, i) => s + i.price * i.quantity, 0);
  const closedAt = body.closed_at || body.printed_at || new Date().toISOString();
  const { date, time } = formatReceiptDateTime(closedAt);
  const printed = formatReceiptDateTime(body.printed_at || closedAt);
  const slipKind = String(body.slip_kind || body.slipKind || "").trim().toLowerCase() === "final"
    ? "final"
    : "order";
  const slipTitle = String(body.slip_title || body.slipTitle || "").trim();
  const slipNote = String(body.slip_note || body.slipNote || "").trim();

  return {
    business,
    slip_kind: slipKind,
    slip_title: slipTitle,
    slip_note: slipNote,
    receipt_number: slipKind === "final" ? String(body.receipt_number || body.order_number || "").trim() : "",
    order_number: String(body.order_number || body.local_order_id || body.receipt_number || "").trim(),
    table_number: Number(body.table_number) || 0,
    source_label: String(body.source_label || body.sourceLabel || "").trim(),
    waiter_name: String(body.waiter_name || "").trim(),
    accepted_by: String(body.accepted_by || "").trim(),
    cashier_name: String(body.cashier_name || body.operator_name || "").trim(),
    register_name: String(body.register_name || body.arka || "").trim(),
    items,
    total,
    closed_at: closedAt,
    date,
    time,
    printed_date: printed.date,
    printed_time: printed.time,
    paper_width_mm: [58, 80].includes(Number(body.receipt_width_mm))
      ? Number(body.receipt_width_mm)
      : business.receipt_width_mm,
    payment_method: slipKind === "final"
      ? (String(body.payment_method || "cash").trim().toLowerCase() === "karte" ? "karte" : "cash")
      : "",
    payment_label: slipKind === "final" ? paymentMethodLabel(body.payment_method) : "",
    tvsh_enabled: slipKind === "final" && !!body.tvsh_enabled,
    tvsh_percent: Number(body.tvsh_percent) || 0,
    subtotal: body.subtotal != null ? Number(body.subtotal) : null,
    vat: body.vat != null ? Number(body.vat) : null,
  };
}

/** Një rresht artikulli për printer termal: "Emri    1x  1.50  =  1.50" */
function formatItemLine(item, width) {
  const qty = Number(item.quantity) || 1;
  const unit = formatMoney(item.price);
  const lineTotal = formatMoney(item.price * qty);
  const tail = `${qty}x  ${unit}  =  ${lineTotal}`;
  const nameMax = Math.max(6, width - tail.length - 1);
  let name = String(item.name || "").trim();
  if (name.length > nameMax) {
    name = `${name.slice(0, Math.max(4, nameMax - 1))}…`;
  }
  const gap = Math.max(1, width - name.length - tail.length);
  return `${name}${" ".repeat(gap)}${tail}`;
}

function formatTotalLine(total, width) {
  const totalLabel = "TOTALI:";
  const totalVal = `${formatMoney(total)} EUR`;
  const gap = Math.max(1, width - totalLabel.length - totalVal.length);
  return `${totalLabel}${" ".repeat(gap)}${totalVal}`;
}

function labelValueLine(label, value, width) {
  const gap = Math.max(1, width - label.length - value.length);
  return `${label}${" ".repeat(gap)}${value}`;
}

function formatItemRows(items, width) {
  return items.map(item => formatItemLine(item, width));
}

function buildReceiptLines(receipt) {
  const w = paperChars(receipt.paper_width_mm);
  const lines = [];
  const biz = receipt.business;
  const isFinal = receipt.slip_kind === "final";
  const nr = displayReceiptNumber(receipt.receipt_number, receipt.order_number, receipt.slip_kind);
  const venue = resolveVenueLine({
    tableNumber: receipt.table_number,
    sourceLabel: receipt.source_label,
  });

  if (biz.business_name) lines.push(pad(biz.business_name, w, "center"));
  if (biz.address) lines.push(pad(biz.address, w, "center"));
  if (biz.phone) lines.push(pad(`Tel: ${biz.phone}`, w, "center"));
  if (isFinal && biz.nui) lines.push(pad(`NUI: ${biz.nui}`, w, "center"));
  if (isFinal && biz.tvsh_nr) lines.push(pad(`TVSH Nr.: ${biz.tvsh_nr}`, w, "center"));

  lines.push(divider(w));
  if (nr) lines.push(`Nr. Fatures: ${nr}`);
  if (venue) lines.push(venue);
  if (receipt.waiter_name) lines.push(`Kamarieri: ${receipt.waiter_name}`);
  if (receipt.accepted_by) lines.push(`Pranuar nga: ${receipt.accepted_by}`);
  if (receipt.register_name) lines.push(`Arka: ${receipt.register_name}`);
  if (receipt.cashier_name) lines.push(`Operatori: ${receipt.cashier_name}`);
  lines.push(`Data: ${receipt.date}  Ora: ${receipt.time}`);
  lines.push(divider(w));

  lines.push(...formatItemRows(receipt.items, w));
  lines.push(divider(w));

  if (isFinal && receipt.tvsh_enabled && receipt.subtotal != null) {
    lines.push(labelValueLine("SUBTOTALI:", `${formatMoney(receipt.subtotal)} EUR`, w));
  }
  if (isFinal && receipt.tvsh_enabled && receipt.vat != null) {
    lines.push(labelValueLine(`TVSH (${receipt.tvsh_percent}%):`, `${formatMoney(receipt.vat)} EUR`, w));
  }
  lines.push(formatTotalLine(receipt.total, w));
  if (receipt.payment_label) lines.push(`Pagesa: ${receipt.payment_label}`);
  lines.push(divider(w));
  lines.push(pad("Faleminderit!", w, "center"));

  return lines;
}

function buildMarkedReceiptLines(receipt) {
  const w = paperChars(receipt.paper_width_mm);
  const lines = [];
  const biz = receipt.business;
  const isFinal = receipt.slip_kind === "final";
  const nr = displayReceiptNumber(receipt.receipt_number, receipt.order_number, receipt.slip_kind);
  const venue = resolveVenueLine({
    tableNumber: receipt.table_number,
    sourceLabel: receipt.source_label,
  });

  if (biz.business_name) lines.push(`^C^B${biz.business_name}`);
  if (biz.address) lines.push(`^C${biz.address}`);
  if (biz.phone) lines.push(`^CTel: ${biz.phone}`);
  if (isFinal && biz.nui) lines.push(`^CNUI: ${biz.nui}`);
  if (isFinal && biz.tvsh_nr) lines.push(`^CTVSH Nr.: ${biz.tvsh_nr}`);

  lines.push(divider(w));
  if (nr) lines.push(`Nr. Fatures: ${nr}`);
  if (venue) lines.push(venue);
  if (receipt.waiter_name) lines.push(`Kamarieri: ${receipt.waiter_name}`);
  if (receipt.accepted_by) lines.push(`Pranuar nga: ${receipt.accepted_by}`);
  if (receipt.register_name) lines.push(`Arka: ${receipt.register_name}`);
  if (receipt.cashier_name) lines.push(`Operatori: ${receipt.cashier_name}`);
  lines.push(`Data: ${receipt.date}  Ora: ${receipt.time}`);
  lines.push(divider(w));

  lines.push(...formatItemRows(receipt.items, w));
  lines.push(divider(w));

  if (isFinal && receipt.tvsh_enabled && receipt.subtotal != null) {
    lines.push(labelValueLine("SUBTOTALI:", `${formatMoney(receipt.subtotal)} EUR`, w));
  }
  if (isFinal && receipt.tvsh_enabled && receipt.vat != null) {
    lines.push(labelValueLine(`TVSH (${receipt.tvsh_percent}%):`, `${formatMoney(receipt.vat)} EUR`, w));
  }
  lines.push(`^R^B${formatTotalLine(receipt.total, w)}`);
  if (receipt.payment_label) lines.push(`Pagesa: ${receipt.payment_label}`);
  lines.push(divider(w));
  lines.push("^CFaleminderit!");

  return lines;
}

function formatReceiptText(receipt) {
  return buildReceiptLines(receipt).join("\n");
}

function formatReceiptEscPosBase64(receipt) {
  const buffer = buildEscPosFromLines(buildMarkedReceiptLines(receipt));
  return toBase64(buffer);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function formatReceiptHtml(receipt) {
  const w = receipt.paper_width_mm;
  const biz = receipt.business;
  const isFinal = receipt.slip_kind === "final";

  const itemLines = receipt.items
    .map(i => {
      const qty = Number(i.quantity) || 1;
      const unit = formatMoney(i.price);
      const lineTotal = formatMoney(i.price * qty);
      return `<div class="rc-item-line">
        <span class="rc-item-name">${escapeHtml(i.name)}</span>
        <span class="rc-item-calc">${qty}x ${unit} = ${lineTotal}</span>
      </div>`;
    })
    .join("");

  const metaLines = [];
  const nr = displayReceiptNumber(receipt.receipt_number, receipt.order_number, receipt.slip_kind);
  if (nr) metaLines.push(`Nr. Fatures: ${escapeHtml(nr)}`);
  const venue = resolveVenueLine({
    tableNumber: receipt.table_number,
    sourceLabel: receipt.source_label,
  });
  if (venue) metaLines.push(escapeHtml(venue));
  if (receipt.waiter_name) metaLines.push(`Kamarieri: ${escapeHtml(receipt.waiter_name)}`);
  if (receipt.accepted_by) metaLines.push(`Pranuar nga: ${escapeHtml(receipt.accepted_by)}`);
  if (receipt.register_name) metaLines.push(`Arka: ${escapeHtml(receipt.register_name)}`);
  if (receipt.cashier_name) metaLines.push(`Operatori: ${escapeHtml(receipt.cashier_name)}`);
  metaLines.push(`Data: ${receipt.date} &nbsp; Ora: ${receipt.time}`);

  const taxMeta = isFinal
    ? [
        biz.nui ? `<div class="rc-meta-line">NUI: ${escapeHtml(biz.nui)}</div>` : "",
        biz.tvsh_nr ? `<div class="rc-meta-line">TVSH: ${escapeHtml(biz.tvsh_nr)}</div>` : "",
      ]
        .filter(Boolean)
        .join("")
    : "";

  return `<div class="receipt-thermal" data-width-mm="${w}">
    <div class="rc-header">
      <div class="rc-business-name">${escapeHtml(biz.business_name || "Faturë")}</div>
      ${biz.address ? `<div class="rc-meta-line">${escapeHtml(biz.address)}</div>` : ""}
      ${biz.phone ? `<div class="rc-meta-line">Tel: ${escapeHtml(biz.phone)}</div>` : ""}
      ${taxMeta}
    </div>
    <div class="rc-divider"></div>
    <div class="rc-order-meta">${metaLines.map(line => `<div>${line}</div>`).join("")}</div>
    <div class="rc-divider"></div>
    <div class="rc-items-compact">${itemLines || '<div class="rc-empty">—</div>'}</div>
    <div class="rc-divider"></div>
    ${isFinal && receipt.tvsh_enabled && receipt.subtotal != null
      ? `<div class="rc-item-line"><span>SUBTOTALI:</span><span>${formatMoney(receipt.subtotal)} EUR</span></div>`
      : ""}
    ${isFinal && receipt.tvsh_enabled && receipt.vat != null
      ? `<div class="rc-item-line"><span>TVSH (${receipt.tvsh_percent}%):</span><span>${formatMoney(receipt.vat)} EUR</span></div>`
      : ""}
    <div class="rc-total">
      <span class="rc-total-label">TOTALI:</span>
      <span class="rc-total-value">${formatMoney(receipt.total)} EUR</span>
    </div>
    ${receipt.payment_label ? `<div class="rc-payment">Pagesa: ${escapeHtml(receipt.payment_label)}</div>` : ""}
    <div class="rc-divider"></div>
    <div class="rc-thanks">Faleminderit!</div>
  </div>`;
}

async function formatReceiptBundle(clientId, body) {
  const business = await getBusinessProfile(clientId);
  const receipt = buildReceiptPayload(clientId, business, body);
  return {
    receipt,
    text: formatReceiptText(receipt),
    lines: buildReceiptLines(receipt),
    escpos_base64: formatReceiptEscPosBase64(receipt),
    html: formatReceiptHtml(receipt),
    paper_width_mm: business.receipt_width_mm,
  };
}

async function seedPosSettingsForClient(client) {
  if (!client?.id) return;
  const db = getSupabase();
  const now = new Date().toISOString();
  await db.from("pos_settings").upsert({
    client_id: client.id,
    restaurant_name: client.emri || "",
    address: client.adresa || "",
    phone: client.telefoni || "",
    table_count: 10,
    receipt_width_mm: 80,
    fiscal_enabled: true,
    synced_at: now,
  });
}

async function syncPosSettingsFromClient(clientId) {
  const client = await getClientById(clientId);
  if (!client) return;
  const db = getSupabase();
  const { data: existing } = await db
    .from("pos_settings")
    .select("client_id, restaurant_name, address, phone")
    .eq("client_id", clientId)
    .maybeSingle();

  const patch = {};
  if (!existing?.restaurant_name?.trim()) patch.restaurant_name = client.emri || "";
  if (!existing?.address?.trim() && client.adresa) patch.address = client.adresa;
  if (!existing?.phone?.trim() && client.telefoni) patch.phone = client.telefoni;
  if (!Object.keys(patch).length) return;

  await db.from("pos_settings").upsert({
    client_id: clientId,
    restaurant_name: patch.restaurant_name ?? existing?.restaurant_name ?? client.emri ?? "",
    address: patch.address ?? existing?.address ?? "",
    phone: patch.phone ?? existing?.phone ?? "",
    table_count: 10,
    receipt_width_mm: 80,
    synced_at: new Date().toISOString(),
  });
}

module.exports = {
  paperChars,
  formatItemLine,
  formatTotalLine,
  getBusinessProfile,
  buildReceiptPayload,
  formatReceiptText,
  formatReceiptEscPosBase64,
  formatReceiptHtml,
  formatReceiptBundle,
  seedPosSettingsForClient,
  syncPosSettingsFromClient,
};
