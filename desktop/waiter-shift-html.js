const { formatEuro } = require("./receipt-html");
const {
  formatReceiptDateTime,
  pad,
  divider,
  labelValueLine,
  truncatedLabelValueLine,
  formatMoney,
  paperChars,
} = require("./receipt-text");

function formatShiftDateTime(iso) {
  const { date, time } = formatReceiptDateTime(iso);
  return { date, time };
}

function money(n) {
  return `${formatMoney(n)} EUR`;
}

function summaryRows(items) {
  return (items || []).map(it =>
    `<div class="receipt-item"><span>${it.name} x${it.quantity}</span><span>${formatEuro(it.line_total)}</span></div>`
  ).join("");
}

function buildShiftCloseHtml({
  fiscal = {},
  restaurantName = "",
  waiterName = "",
  shift = {},
  totals = {},
  salesDetail = {},
  title = "PAZARI I NDERRIMIT",
  live = false,
}) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const opened = formatShiftDateTime(shift.opened_at);
  const closed = live ? null : formatShiftDateTime(shift.closed_at || new Date().toISOString());
  const now = formatShiftDateTime(new Date().toISOString());
  const itemSummary = salesDetail.item_summary || [];

  const opening = Number(totals.opening_cash ?? shift.opening_cash ?? 0);
  const cashSales = Number(totals.cash_total ?? shift.cash_sales_total ?? 0);
  const cardSales = Number(totals.card_total ?? shift.card_sales_total ?? 0);
  const discountTotal = Number(totals.discount_total ?? shift.discount_total ?? 0);
  const totalSales = Number(totals.total_sales ?? shift.total_sales ?? 0);
  const expected = Number(totals.expected_closing_cash ?? shift.expected_closing_cash ?? opening + cashSales);
  const actual = totals.closing_cash_actual ?? shift.closing_cash_actual;
  const diff = Number(totals.cash_difference ?? shift.cash_difference) || 0;
  const orderCount = Number(totals.order_count ?? shift.order_count_total ?? 0);

  const itemsBlock = itemSummary.length
    ? `
      <div class="receipt-meta receipt-invoice">Artikujt e shitur</div>
      <div class="receipt-rule">--------------------------------</div>
      ${summaryRows(itemSummary)}
      <div class="receipt-rule">--------------------------------</div>`
    : `<div class="receipt-meta">Nuk ka shitje në këtë nderrim.</div><div class="receipt-rule">--------------------------------</div>`;

  let cashBlock = `
    <div class="receipt-meta receipt-invoice">Paratë në arkë</div>
    <div class="receipt-rule">--------------------------------</div>
    <div class="receipt-item"><span>Paratë e nisjes:</span><span>${formatEuro(opening)}</span></div>
    <div class="receipt-item"><span>Paratë e pritshme:</span><span>${formatEuro(expected)}</span></div>`;
  if (actual != null) {
    cashBlock += `<div class="receipt-item"><span>Paratë e numëruar:</span><span>${formatEuro(actual)}</span></div>`;
    if (Math.abs(diff) < 0.005) {
      cashBlock += `<div class="receipt-meta">Barazim: OK</div>`;
    } else if (diff < 0) {
      cashBlock += `<div class="receipt-item"><span>Mungesë:</span><span>${formatEuro(Math.abs(diff))}</span></div>`;
    } else {
      cashBlock += `<div class="receipt-item"><span>Tepricë:</span><span>${formatEuro(diff)}</span></div>`;
    }
  }
  if (totals.handed_over_to_name) {
    cashBlock += `<div class="receipt-meta">Dorëzuar te: ${totals.handed_over_to_name}</div>`;
  }

  const discountLine = discountTotal > 0
    ? `<div class="receipt-item receipt-discount"><span>Zbritje totale:</span><span>−${formatEuro(discountTotal)}</span></div>`
    : "";

  return `
    <div class="receipt-meta">${now.date} ${now.time}</div>
    <div class="receipt-name">${bizName}</div>
    <div class="receipt-meta">${f.biz_address || ""}${f.biz_address && f.biz_city ? ", " : ""}${f.biz_city || ""}</div>
    <div class="receipt-meta">Tel: ${f.biz_phone || "—"}</div>
    <div class="receipt-rule">================================</div>
    <div class="receipt-name">${title}</div>
    <div class="receipt-rule">================================</div>
    <div class="receipt-body">
      <div class="receipt-meta">Kamarieri: ${waiterName || "—"}</div>
      <div class="receipt-meta">Hapur: ${opened.date} ${opened.time}</div>
      ${closed ? `<div class="receipt-meta">Mbyllur: ${closed.date} ${closed.time}</div>` : `<div class="receipt-meta">Gjendja deri tani: ${now.date} ${now.time}</div>`}
      <div class="receipt-meta">Arka: ${f.biz_register_number || "—"}</div>
      <div class="receipt-meta">Operatori: ${f.biz_cashier_operator || "—"}</div>
      <div class="receipt-rule">--------------------------------</div>
      ${itemsBlock}
      <div class="receipt-item"><span>Porosi:</span><span>${orderCount}</span></div>
      <div class="receipt-item"><span>Shitje cash:</span><span>${formatEuro(cashSales)}</span></div>
      <div class="receipt-item"><span>Shitje kartë:</span><span>${formatEuro(cardSales)}</span></div>
      ${discountLine}
      <div class="receipt-total"><span>TOTALI:</span><span>${formatEuro(totalSales)}</span></div>
      <div class="receipt-rule">--------------------------------</div>
      ${cashBlock}
      <div class="receipt-rule">================================</div>
      <div class="receipt-thanks">${live ? "Raport i përkohshëm — nderrimi ende aktiv" : "Barazohet me pronarin"}</div>
      <div class="receipt-rule">================================</div>
    </div>`;
}

/** Njësoj si buildShiftCloseHtml, si rreshta tekst (ESC/POS raw, si faturat/raportet X/Z). */
function buildShiftCloseLines({
  fiscal = {},
  restaurantName = "",
  waiterName = "",
  shift = {},
  totals = {},
  salesDetail = {},
  title = "PAZARI I NDERRIMIT",
  live = false,
  paper = "80mm",
}) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const w = paperChars(paper);
  const opened = formatShiftDateTime(shift.opened_at);
  const closed = live ? null : formatShiftDateTime(shift.closed_at || new Date().toISOString());
  const now = formatShiftDateTime(new Date().toISOString());
  const itemSummary = salesDetail.item_summary || [];

  const opening = Number(totals.opening_cash ?? shift.opening_cash ?? 0);
  const cashSales = Number(totals.cash_total ?? shift.cash_sales_total ?? 0);
  const cardSales = Number(totals.card_total ?? shift.card_sales_total ?? 0);
  const discountTotal = Number(totals.discount_total ?? shift.discount_total ?? 0);
  const totalSales = Number(totals.total_sales ?? shift.total_sales ?? 0);
  const expected = Number(totals.expected_closing_cash ?? shift.expected_closing_cash ?? opening + cashSales);
  const actual = totals.closing_cash_actual ?? shift.closing_cash_actual;
  const diff = Number(totals.cash_difference ?? shift.cash_difference) || 0;
  const orderCount = Number(totals.order_count ?? shift.order_count_total ?? 0);

  const lines = [pad(`${now.date} ${now.time}`, w, "center"), pad(bizName, w, "center")];
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");
  if (addr) lines.push(pad(addr, w, "center"));
  lines.push(pad(`Tel: ${f.biz_phone || "—"}`, w, "center"));
  lines.push(divider(w));
  lines.push(pad(title, w, "center"));
  lines.push(divider(w));

  lines.push(`Kamarieri: ${waiterName || "—"}`);
  lines.push(`Hapur: ${opened.date} ${opened.time}`);
  lines.push(closed ? `Mbyllur: ${closed.date} ${closed.time}` : `Gjendja deri tani: ${now.date} ${now.time}`);
  lines.push(`Arka: ${f.biz_register_number || "—"}`);
  lines.push(`Operatori: ${f.biz_cashier_operator || "—"}`);
  lines.push(divider(w, "-"));

  if (itemSummary.length) {
    lines.push("Artikujt e shitur");
    lines.push(divider(w, "-"));
    for (const it of itemSummary) {
      lines.push(truncatedLabelValueLine(`${it.name} x${it.quantity}`, money(it.line_total), w));
    }
    lines.push(divider(w, "-"));
  } else {
    lines.push("Nuk ka shitje në këtë nderrim.");
    lines.push(divider(w, "-"));
  }

  lines.push(labelValueLine("Porosi:", String(orderCount), w));
  lines.push(labelValueLine("Shitje cash:", money(cashSales), w));
  lines.push(labelValueLine("Shitje kartë:", money(cardSales), w));
  if (discountTotal > 0) {
    lines.push(labelValueLine("Zbritje totale:", `-${formatMoney(discountTotal)} EUR`, w));
  }
  lines.push(`^R^B${labelValueLine("TOTALI:", money(totalSales), w)}`);
  lines.push(divider(w, "-"));

  lines.push("Paratë në arkë");
  lines.push(divider(w, "-"));
  lines.push(labelValueLine("Paratë e nisjes:", money(opening), w));
  lines.push(labelValueLine("Paratë e pritshme:", money(expected), w));
  if (actual != null) {
    lines.push(labelValueLine("Paratë e numëruar:", money(actual), w));
    if (Math.abs(diff) < 0.005) {
      lines.push("Barazim: OK");
    } else if (diff < 0) {
      lines.push(labelValueLine("Mungesë:", money(Math.abs(diff)), w));
    } else {
      lines.push(labelValueLine("Tepricë:", money(diff), w));
    }
  }
  if (totals.handed_over_to_name) {
    lines.push(`Dorëzuar te: ${totals.handed_over_to_name}`);
  }

  lines.push(divider(w));
  lines.push(pad(live ? "Raport i përkohshëm — nderrimi ende aktiv" : "Barazohet me pronarin", w, "center"));
  lines.push(divider(w));

  return lines;
}

/** Raport i shkurtër termik për "Raporti i Kamarierit" — vetëm emri, ora, artikujt, totali. */
function buildWaiterLiveReportLines({
  restaurantName = "",
  waiterName = "",
  shift = {},
  totals = {},
  salesDetail = {},
  paper = "80mm",
}) {
  const w = paperChars(paper);
  const opened = formatShiftDateTime(shift.opened_at);
  const now = formatShiftDateTime(new Date().toISOString());
  const itemSummary = salesDetail.item_summary || [];
  const totalSales = Number(totals.total_sales ?? 0);

  const lines = [
    pad(restaurantName || "Hotel", w, "center"),
    divider(w),
    pad("RAPORTI I KAMARIERIT", w, "center"),
    divider(w),
    `Kamarieri: ${waiterName || "—"}`,
    `Nderrimi: ${opened.date} ${opened.time}`,
    `Printuar: ${now.date} ${now.time}`,
    divider(w, "-"),
  ];

  if (itemSummary.length) {
    for (const it of itemSummary) {
      const qty = Number(it.quantity) || 0;
      const lineTotal = Number(it.line_total) || 0;
      lines.push(truncatedLabelValueLine(`${it.name} x${qty}`, money(lineTotal), w));
    }
  } else {
    lines.push("Nuk ka shitje në këtë nderrim.");
  }

  lines.push(divider(w, "-"));
  lines.push(`^R^B${labelValueLine("TOTALI:", money(totalSales), w)}`);
  lines.push(divider(w));
  return lines;
}

module.exports = {
  buildShiftCloseHtml,
  buildShiftCloseLines,
  buildWaiterLiveReportLines,
};
