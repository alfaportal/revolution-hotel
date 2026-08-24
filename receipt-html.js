function formatReceiptDate() {
  const { formatReceiptDateTime } = require("./receipt-text");
  const { date, time } = formatReceiptDateTime(new Date().toISOString());
  return { data: date, ora: time };
}

function formatReceiptDateFromIso(iso) {
  const { formatReceiptDateTime } = require("./receipt-text");
  const { date, time } = formatReceiptDateTime(iso);
  return { data: date, ora: time };
}

function formatEuro(n) {
  return Number(n).toFixed(2) + " €";
}

function atkSealPlaceholderHtml() {
  return `<div class="receipt-atk-seal" aria-hidden="true">
    <svg viewBox="0 0 120 120" width="72" height="72" role="img" aria-label="Vula ATK">
      <circle cx="60" cy="60" r="56" fill="none" stroke="#111" stroke-width="3"/>
      <circle cx="60" cy="60" r="46" fill="none" stroke="#111" stroke-width="1.5"/>
      <text x="60" y="54" text-anchor="middle" font-size="16" font-weight="700" fill="#111">ATK</text>
      <text x="60" y="72" text-anchor="middle" font-size="8" font-weight="600" fill="#111">KOSOVE</text>
      <text x="60" y="84" text-anchor="middle" font-size="7" fill="#111">KUPON FISKAL</text>
    </svg>
    <div class="receipt-atk-caption">Republika e Kosoves — ATK</div>
  </div>`;
}

function resolveVenueLineHtml(tableNumber, sourceLabel, waiterName) {
  const { resolveVenueLine } = require("./receipt-text");
  const venue = resolveVenueLine({ tableNumber, sourceLabel });
  if (venue) return `<div class="receipt-meta">${venue}</div>`;
  if (waiterName) return "";
  return "";
}

function buildReceiptHtml({
  tableNumber,
  waiterName,
  items,
  fiscal,
  receiptNumber,
  totals,
  restaurantName,
  paymentMethod,
  closedAt = "",
  discountTotal = 0,
  promotionName = "",
  subtotalBeforeDiscount = null,
  sourceLabel = "",
}) {
  const { displayReceiptNumber } = require("./receipt-text");
  const { data, ora } = closedAt
    ? formatReceiptDateFromIso(closedAt)
    : formatReceiptDate();
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const nr = displayReceiptNumber(receiptNumber, receiptNumber, "final");
  const lines = (items || []).map(it =>
    `<div class="receipt-item"><span>${it.quantity}× ${it.name}</span><span>${formatEuro(it.price * it.quantity)}</span></div>`
  ).join("");
  const disc = Number(discountTotal) || 0;
  const gross = subtotalBeforeDiscount != null ? Number(subtotalBeforeDiscount) : Number(totals.subtotal || totals.total);
  const subtotalLine = disc > 0
    ? `<div class="receipt-item"><span>Nentotali:</span><span>${formatEuro(gross)}</span></div>`
    : (f.tvsh_enabled
      ? `<div class="receipt-item"><span>Subtotali:</span><span>${formatEuro(totals.subtotal)}</span></div>`
      : "");
  const discountLine = disc > 0
    ? `<div class="receipt-item receipt-discount"><span>Zbritje${promotionName ? ` (${promotionName})` : ""}:</span><span>−${formatEuro(disc)}</span></div>`
    : "";
  const tvshLine = f.tvsh_enabled
    ? `<div class="receipt-item"><span>TVSh (${f.tvsh_percent}%):</span><span>${formatEuro(totals.vat)}</span></div>`
    : "";
  const footer = f.biz_footer || "Faleminderit!";
  const paymentLabel = paymentMethod === "karte" ? "Karte" : paymentMethod ? "Cash" : "";
  const paymentLine = paymentLabel
    ? `<div class="receipt-meta">Pagesa: ${paymentLabel}</div>`
    : "";
  const venueLine = resolveVenueLineHtml(tableNumber, sourceLabel, waiterName);

  return `
    <div class="receipt-rule">================================</div>
    <div class="receipt-name">${bizName}</div>
    <div class="receipt-meta">${f.biz_address || ""}${f.biz_address && f.biz_city ? ", " : ""}${f.biz_city || ""}</div>
    <div class="receipt-meta">Tel: ${f.biz_phone || "—"}</div>
    <div class="receipt-rule">================================</div>
    ${atkSealPlaceholderHtml()}
    <div class="receipt-meta receipt-fiscal-legal">Kupon tatimor — Administrata Tatimore e Kosoves (ATK)</div>
    <div class="receipt-meta">Nr. Fiskal (NF): ${f.biz_fiscal_number || "—"}</div>
    <div class="receipt-meta">Nr. TVSH: ${f.biz_vat_number || "—"}</div>
    <div class="receipt-rule">================================</div>
    <div class="receipt-meta receipt-invoice">FATURA Nr: ${nr || "—"}</div>
    <div class="receipt-rule">--------------------------------</div>
    <div class="receipt-meta">Data: ${data}  Ora: ${ora}</div>
    ${venueLine}
    <div class="receipt-meta">Kamarieri: ${waiterName || "—"}</div>
    <div class="receipt-meta">Arka: ${f.biz_register_number || "—"}</div>
    <div class="receipt-meta">Operatori: ${f.biz_cashier_operator || "—"}</div>
    <div class="receipt-rule">--------------------------------</div>
    ${lines}
    <div class="receipt-rule">--------------------------------</div>
    ${subtotalLine}
    ${discountLine}
    ${tvshLine}
    <div class="receipt-total"><span>TOTALI:</span><span>${formatEuro(totals.total)}</span></div>
    ${paymentLine}
    <div class="receipt-rule">================================</div>
    <div class="receipt-thanks">${footer}</div>
    <div class="receipt-rule">================================</div>
    <div class="receipt-meta" style="text-align:center;font-size:9pt">*Fature e gjeneruar nga sistemi POS*</div>`;
}

module.exports = {
  buildReceiptHtml,
  formatEuro,
  atkSealPlaceholderHtml,
};
