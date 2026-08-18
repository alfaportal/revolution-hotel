const { formatReceiptDateTime } = require("./receipt-text");

function t(s) {
  try {
    return require("./i18n").t(s);
  } catch {
    return s;
  }
}

function formatEuro(n) {
  return Number(n || 0).toFixed(2) + " EUR";
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nrDisplay(receiptNumber) {
  const part = String(receiptNumber || "").split("-")[1] || receiptNumber || "";
  return String(part).padStart(6, "0");
}

function buildDitariReportHtml(ditari, fiscal, restaurantName) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const gen = formatReceiptDateTime(new Date().toISOString());
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");

  const entryBlocks = (ditari.entries || []).map(e => {
    const cancelled = e.status === "cancelled";
    const items = (e.items || []).map(it =>
      `<div class="receipt-item"><span>${it.quantity}× ${escHtml(it.name)}</span><span>${formatEuro(it.price * it.quantity)}</span></div>`
    ).join("");
    const statusLine = cancelled
      ? `<div class="receipt-meta" style="color:#b45309">*** ${escHtml(t("ANULLUAR"))} ***</div>`
      : "";
    return `
      <div class="receipt-rule">--------------------------------</div>
      ${statusLine}
      <div class="receipt-meta">${escHtml(t("Nr. Porosia:"))} ${escHtml(e.receipt_number || "—")}</div>
      <div class="receipt-meta">${escHtml(t("Tavolina:"))} T${e.table_number}</div>
      <div class="receipt-meta">${escHtml(t("Kamarieri:"))} ${escHtml(e.waiter_name)}</div>
      <div class="receipt-meta">${escHtml(t("Arka:"))} ${escHtml(f.biz_register_number || "—")}</div>
      <div class="receipt-meta">${escHtml(t("Operatori:"))} ${escHtml(f.biz_cashier_operator || "—")}</div>
      <div class="receipt-meta">${escHtml(t("Data:"))} ${escHtml(e.date)}  ${escHtml(t("Ora:"))} ${escHtml(e.time)}</div>
      <div class="receipt-rule">--------------------------------</div>
      ${items || `<div class="receipt-meta">—</div>`}
      <div class="receipt-total"><span>${escHtml(t("TOTALI:"))}</span><span>${formatEuro(e.total)}</span></div>
      <div class="receipt-meta">${escHtml(t("Pagesa:"))} ${escHtml(e.payment_label || "Cash")}</div>`;
  }).join("");

  return `
    <div class="receipt-rule">================================</div>
    <div class="receipt-name">${escHtml(bizName)}</div>
    ${addr ? `<div class="receipt-meta">${escHtml(addr)}</div>` : ""}
    ${f.biz_phone ? `<div class="receipt-meta">Tel: ${escHtml(f.biz_phone)}</div>` : ""}
    <div class="receipt-rule">================================</div>
    <div class="receipt-body">
      <div class="receipt-meta">NF: ${escHtml(f.biz_fiscal_number || "—")}</div>
      <div class="receipt-meta">${escHtml(t("TVSh Nr.:"))} ${escHtml(f.biz_vat_number || "—")}</div>
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta receipt-invoice">${escHtml(t("RAPORT DITARI"))}</div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta">${escHtml(t("Periudha:"))} ${escHtml(ditari.periodLabel)}</div>
      <div class="receipt-meta">${escHtml(t("Nga:"))} ${escHtml(ditari.dateFrom)} ${escHtml(ditari.timeFrom || "00:00:00")}</div>
      <div class="receipt-meta">${escHtml(t("Deri:"))} ${escHtml(ditari.dateTo)} ${escHtml(ditari.timeTo || "23:59:59")}</div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-item"><span>${escHtml(t("Shitjet totale"))}</span><span>${formatEuro(ditari.totalSales)}</span></div>
      <div class="receipt-item"><span>${escHtml(t("Cash"))}</span><span>${formatEuro(ditari.totalCash)}</span></div>
      <div class="receipt-item"><span>${escHtml(t("Kartë"))}</span><span>${formatEuro(ditari.totalKarte)}</span></div>
      <div class="receipt-item"><span>${escHtml(t("Porosi"))}</span><span>${ditari.orderCount}</span></div>
      <div class="receipt-item"><span>${escHtml(t("Tavolina"))}</span><span>${ditari.tablesServed}</span></div>
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta receipt-invoice">${escHtml(t("TRANSAKSIONET"))}</div>
      ${entryBlocks || `<div class="receipt-meta">${escHtml(t("Nuk ka transaksione."))}</div>`}
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-total"><span>${escHtml(t("TOTALI PERiUDHËS:"))}</span><span>${formatEuro(ditari.totalSales)}</span></div>
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta">${escHtml(t("Gjeneruar:"))} ${gen.date} ${gen.time}</div>
      <div class="receipt-thanks">${escHtml(f.biz_footer || t("Faleminderit!"))}</div>
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta" style="text-align:center;font-size:9pt">*${escHtml(t("Raport i gjeneruar nga sistemi"))}*</div>
    </div>`;
}

module.exports = { buildDitariReportHtml };
