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

function dt(iso) {
  return formatReceiptDateTime(iso);
}

function byWaiterRows(rows) {
  return (rows || []).map(w =>
    `<div class="receipt-item"><span>${w.waiter_name || "—"}</span><span>${formatEuro(w.total_sales)}</span></div>`
  ).join("");
}

function byCategoryRows(rows) {
  return (rows || []).map(c =>
    `<div class="receipt-item"><span>${c.category}</span><span>${formatEuro(c.total)}</span></div>`
  ).join("");
}

function commonHeader({ f, bizName, title }) {
  const now = dt(new Date().toISOString());
  return `
    <div class="receipt-meta">${now.date} ${now.time}</div>
    <div class="receipt-name">${bizName}</div>
    <div class="receipt-meta">${f.biz_address || ""}${f.biz_address && f.biz_city ? ", " : ""}${f.biz_city || ""}</div>
    <div class="receipt-meta">Tel: ${f.biz_phone || "—"}</div>
    <div class="receipt-rule">================================</div>
    <div class="receipt-name">${title}</div>
    <div class="receipt-rule">================================</div>`;
}

function totalsBlock(data) {
  return `
    <div class="receipt-item"><span>Porosi:</span><span>${Number(data.order_count) || 0}</span></div>
    <div class="receipt-item"><span>Shitje cash:</span><span>${formatEuro(data.cash_total)}</span></div>
    <div class="receipt-item"><span>Shitje kartë:</span><span>${formatEuro(data.card_total)}</span></div>
    ${Number(data.discount_total) > 0
      ? `<div class="receipt-item receipt-discount"><span>Zbritje totale:</span><span>−${formatEuro(data.discount_total)}</span></div>`
      : ""}
    <div class="receipt-total"><span>TOTALI:</span><span>${formatEuro(data.total_sales)}</span></div>`;
}

/** Raporti X — gjendja e tashme e nderrimeve hapur, pa mbyllur asgjë (i printueshëm në çdo kohë). */
function buildXReportHtml({ fiscal = {}, restaurantName = "", data = {} }) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";

  const waiterBlock = (data.by_waiter || []).length
    ? `
      <div class="receipt-meta receipt-invoice">Shitjet sipas kamarierit</div>
      <div class="receipt-rule">--------------------------------</div>
      ${byWaiterRows(data.by_waiter)}
      <div class="receipt-rule">--------------------------------</div>`
    : `<div class="receipt-meta">Nuk ka nderrim aktiv tani.</div><div class="receipt-rule">--------------------------------</div>`;

  const categoryBlock = (data.by_category || []).length
    ? `
      <div class="receipt-meta receipt-invoice">Shitjet sipas kategorisë</div>
      <div class="receipt-rule">--------------------------------</div>
      ${byCategoryRows(data.by_category)}
      <div class="receipt-rule">--------------------------------</div>`
    : "";

  return `
    ${commonHeader({ f, bizName, title: "RAPORTI X" })}
    <div class="receipt-body">
      <div class="receipt-meta">Nderrime aktive: ${Number(data.open_shift_count) || 0}</div>
      <div class="receipt-meta">Momentanisht — nuk mbyll asnjë nderrim</div>
      <div class="receipt-rule">--------------------------------</div>
      ${waiterBlock}
      ${categoryBlock}
      ${totalsBlock(data)}
      <div class="receipt-rule">================================</div>
      <div class="receipt-thanks">Raport i përkohshëm — jo mbyllje</div>
      <div class="receipt-rule">================================</div>
    </div>`;
}

/** Raporti Z — pamja përfundimtare e një nderrimi tashmë të mbyllur, me barazimin e arkës. */
function buildZReportHtml({ fiscal = {}, restaurantName = "", data = {} }) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const opened = dt(data.opened_at);
  const closed = dt(data.closed_at);

  const categoryBlock = (data.by_category || []).length
    ? `
      <div class="receipt-meta receipt-invoice">Shitjet sipas kategorisë</div>
      <div class="receipt-rule">--------------------------------</div>
      ${byCategoryRows(data.by_category)}
      <div class="receipt-rule">--------------------------------</div>`
    : "";

  const diff = Number(data.cash_difference) || 0;
  let cashBlock = `
    <div class="receipt-meta receipt-invoice">Paratë në arkë</div>
    <div class="receipt-rule">--------------------------------</div>
    <div class="receipt-item"><span>Paratë e nisjes:</span><span>${formatEuro(data.opening_cash)}</span></div>
    <div class="receipt-item"><span>Paratë e pritshme:</span><span>${formatEuro(data.expected_closing_cash)}</span></div>`;
  if (data.closing_cash_actual != null) {
    cashBlock += `<div class="receipt-item"><span>Paratë e numëruar:</span><span>${formatEuro(data.closing_cash_actual)}</span></div>`;
    if (Math.abs(diff) < 0.005) {
      cashBlock += `<div class="receipt-meta">Barazim: OK</div>`;
    } else if (diff < 0) {
      cashBlock += `<div class="receipt-item"><span>Mungesë:</span><span>${formatEuro(Math.abs(diff))}</span></div>`;
    } else {
      cashBlock += `<div class="receipt-item"><span>Tepricë:</span><span>${formatEuro(diff)}</span></div>`;
    }
  }
  if (Math.abs(diff) >= 0.005 && data.closing_reason) {
    cashBlock += `<div class="receipt-meta">Arsyeja: ${data.closing_reason}</div>`;
  }

  return `
    ${commonHeader({ f, bizName, title: "RAPORTI Z" })}
    <div class="receipt-body">
      <div class="receipt-meta">Kamarieri: ${data.waiter_name || "—"}</div>
      <div class="receipt-meta">Hapur: ${opened.date} ${opened.time}</div>
      <div class="receipt-meta">Mbyllur: ${closed.date} ${closed.time}</div>
      <div class="receipt-meta">Arka: ${f.biz_register_number || "—"}</div>
      <div class="receipt-meta">Operatori: ${f.biz_cashier_operator || "—"}</div>
      <div class="receipt-rule">--------------------------------</div>
      ${categoryBlock}
      ${totalsBlock(data)}
      <div class="receipt-rule">--------------------------------</div>
      ${cashBlock}
      <div class="receipt-rule">================================</div>
      <div class="receipt-thanks">Nderrim i mbyllur — dokument final</div>
      <div class="receipt-rule">================================</div>
    </div>`;
}

// ─── Rreshta tekst (ESC/POS) — njësoj si receipt-text.js, për printer termik ───
// Njëjtë përmbajtja/etiketat si HTML-t sipër, por si rreshta të mbushur (pad/
// labelValueLine) brenda gjerësisë së letrës, në vend të CSS flex që disa
// drejtues printeri termik s'e nxjerrin saktë (çmime mungojnë / tekst i prerë).

function money(n) {
  return `${formatMoney(n)} EUR`;
}

function textHeader({ f, bizName, title, w }) {
  const now = dt(new Date().toISOString());
  const lines = [pad(`${now.date} ${now.time}`, w, "center"), pad(bizName, w, "center")];
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");
  if (addr) lines.push(pad(addr, w, "center"));
  lines.push(pad(`Tel: ${f.biz_phone || "—"}`, w, "center"));
  lines.push(divider(w));
  lines.push(pad(title, w, "center"));
  lines.push(divider(w));
  return lines;
}

function byWaiterLines(rows, w) {
  return (rows || []).map(r => truncatedLabelValueLine(r.waiter_name || "—", money(r.total_sales), w));
}

function byCategoryLines(rows, w) {
  return (rows || []).map(c => truncatedLabelValueLine(c.category, money(c.total), w));
}

function totalsLines(data, w) {
  const lines = [
    labelValueLine("Porosi:", String(Number(data.order_count) || 0), w),
    labelValueLine("Shitje cash:", money(data.cash_total), w),
    labelValueLine("Shitje kartë:", money(data.card_total), w),
  ];
  if (Number(data.discount_total) > 0) {
    lines.push(labelValueLine("Zbritje totale:", `-${formatMoney(data.discount_total)} EUR`, w));
  }
  lines.push(`^R^B${labelValueLine("TOTALI:", money(data.total_sales), w)}`);
  return lines;
}

/** Raporti X si rreshta tekst — për printer termik (ESC/POS raw, njësoj si faturat). */
function buildXReportLines({ fiscal = {}, restaurantName = "", data = {}, paper = "80mm" }) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const w = paperChars(paper);

  const lines = textHeader({ f, bizName, title: "RAPORTI X", w });

  lines.push(`Nderrime aktive: ${Number(data.open_shift_count) || 0}`);
  lines.push("Momentanisht — nuk mbyll asnjë nderrim");
  lines.push(divider(w, "-"));

  if ((data.by_waiter || []).length) {
    lines.push("Shitjet sipas kamarierit");
    lines.push(divider(w, "-"));
    lines.push(...byWaiterLines(data.by_waiter, w));
    lines.push(divider(w, "-"));
  } else {
    lines.push("Nuk ka nderrim aktiv tani.");
    lines.push(divider(w, "-"));
  }

  if ((data.by_category || []).length) {
    lines.push("Shitjet sipas kategorisë");
    lines.push(divider(w, "-"));
    lines.push(...byCategoryLines(data.by_category, w));
    lines.push(divider(w, "-"));
  }

  lines.push(...totalsLines(data, w));

  lines.push(divider(w));
  lines.push(pad("Raport i përkohshëm — jo mbyllje", w, "center"));
  lines.push(divider(w));

  return lines;
}

/** Raporti Z si rreshta tekst — për printer termik (ESC/POS raw, njësoj si faturat). */
function buildZReportLines({ fiscal = {}, restaurantName = "", data = {}, paper = "80mm" }) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const w = paperChars(paper);
  const opened = dt(data.opened_at);
  const closed = dt(data.closed_at);

  const lines = textHeader({ f, bizName, title: "RAPORTI Z", w });

  lines.push(`Kamarieri: ${data.waiter_name || "—"}`);
  lines.push(`Hapur: ${opened.date} ${opened.time}`);
  lines.push(`Mbyllur: ${closed.date} ${closed.time}`);
  lines.push(`Arka: ${f.biz_register_number || "—"}`);
  lines.push(`Operatori: ${f.biz_cashier_operator || "—"}`);
  lines.push(divider(w, "-"));

  if ((data.by_category || []).length) {
    lines.push("Shitjet sipas kategorisë");
    lines.push(divider(w, "-"));
    lines.push(...byCategoryLines(data.by_category, w));
    lines.push(divider(w, "-"));
  }

  lines.push(...totalsLines(data, w));
  lines.push(divider(w, "-"));

  const diff = Number(data.cash_difference) || 0;
  lines.push("Paratë në arkë");
  lines.push(divider(w, "-"));
  lines.push(labelValueLine("Paratë e nisjes:", money(data.opening_cash), w));
  lines.push(labelValueLine("Paratë e pritshme:", money(data.expected_closing_cash), w));
  if (data.closing_cash_actual != null) {
    lines.push(labelValueLine("Paratë e numëruar:", money(data.closing_cash_actual), w));
    if (Math.abs(diff) < 0.005) {
      lines.push("Barazim: OK");
    } else if (diff < 0) {
      lines.push(labelValueLine("Mungesë:", money(Math.abs(diff)), w));
    } else {
      lines.push(labelValueLine("Tepricë:", money(diff), w));
    }
  }
  if (Math.abs(diff) >= 0.005 && data.closing_reason) {
    lines.push(`Arsyeja: ${data.closing_reason}`);
  }

  lines.push(divider(w));
  lines.push(pad("Nderrim i mbyllur — dokument final", w, "center"));
  lines.push(divider(w));

  return lines;
}

/** Rresht artikulli për Përmbledhjen Ditore — emri majtas, sasi+total djathtas,
 * pa çmim njësie (më i shkurtër se formatItemLine i faturave, i qëllimshëm). */
function formatSummaryItemLine(name, qty, total, width) {
  return truncatedLabelValueLine(name, `${qty}x  ${formatMoney(total)} EUR`, width);
}

/** Përmbledhje Ditore — vetëm artikujt e shitur sot + totali. Pa orë, tavolinë,
 * kamarier apo rreshta transaksionesh, siç kërkohet për një raport të shkurtër. */
function buildDailySummaryLines({ fiscal = {}, restaurantName = "", data = {}, paper = "80mm" }) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const w = paperChars(paper);
  const day = dt(`${data.date || new Date().toISOString().slice(0, 10)}T12:00:00`).date;

  const lines = textHeader({ f, bizName, title: "PËRMBLEDHJE DITORE", w });
  lines.push(`Data: ${day}`);
  lines.push(divider(w, "-"));

  const items = data.items || [];
  if (items.length) {
    for (const it of items) {
      lines.push(formatSummaryItemLine(it.name, it.quantity, it.total, w));
    }
  } else {
    lines.push("Nuk ka shitje sot.");
  }

  lines.push(divider(w));
  lines.push(`^R^B${labelValueLine("TOTALI:", money(data.total_sales), w)}`);
  lines.push(divider(w));

  return lines;
}

module.exports = {
  buildXReportHtml,
  buildZReportHtml,
  buildXReportLines,
  buildZReportLines,
  buildDailySummaryLines,
};
