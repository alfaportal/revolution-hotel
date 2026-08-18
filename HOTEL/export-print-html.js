const {
  formatReceiptDateTime,
  pad,
  divider,
  labelValueLine,
  truncatedLabelValueLine,
  formatMoney,
  paperChars,
} = require("./receipt-text");

function money(n) {
  return `${formatMoney(n)} EUR`;
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

function receiptBizBlock(fiscal, restaurantName) {
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");
  return `
    <div class="receipt-rule">================================</div>
    <div class="receipt-name">${escHtml(bizName)}</div>
    ${addr ? `<div class="receipt-meta">${escHtml(addr)}</div>` : ""}
    ${f.biz_phone ? `<div class="receipt-meta">Tel: ${escHtml(f.biz_phone)}</div>` : ""}
    <div class="receipt-rule">================================</div>
    <div class="receipt-meta">NF: ${escHtml(f.biz_fiscal_number || "—")}</div>
    <div class="receipt-meta">TVSh Nr.: ${escHtml(f.biz_vat_number || "—")}</div>`;
}

function buildMenuPrintHtml(categories, items, fiscal, restaurantName, versionLabel) {
  const gen = formatReceiptDateTime(new Date().toISOString());
  const catBlocks = (categories || []).map(cat => {
    const catItems = (items || []).filter(i => i.category === cat);
    if (!catItems.length) return "";
    const lines = catItems.map(it => {
      const inactive = it.active ? "" : " (joaktiv)";
      return `<div class="receipt-item"><span>${escHtml(it.name)}${inactive}</span><span>${formatEuro(it.price)}</span></div>`;
    }).join("");
    return `
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta receipt-invoice">${escHtml(cat)}</div>
      ${lines}`;
  }).join("");

  return `
    <div class="receipt-body">
      ${receiptBizBlock(fiscal, restaurantName)}
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta receipt-invoice">MENU</div>
      ${versionLabel ? `<div class="receipt-meta">Versioni: ${escHtml(versionLabel)}</div>` : ""}
      <div class="receipt-rule">--------------------------------</div>
      ${catBlocks || `<div class="receipt-meta">Nuk ka artikuj.</div>`}
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta">Gjeneruar: ${gen.date} ${gen.time}</div>
      <div class="receipt-thanks">${escHtml(fiscal?.biz_footer || "Faleminderit!")}</div>
      <div class="receipt-rule">================================</div>
    </div>`;
}

function buildReportPrintHtml(report, fiscal, restaurantName) {
  const rep = report || {};
  const gen = formatReceiptDateTime(new Date().toISOString());
  const topLines = (rep.topItems || []).map(it =>
    `<div class="receipt-item"><span>${escHtml(it.name)}</span><span>${it.quantity} copë</span></div>`
  ).join("");

  const periodLabel = rep.dateFrom === rep.dateTo
    ? rep.dateFrom
    : `${rep.dateFrom} — ${rep.dateTo}`;

  return `
    <div class="receipt-body">
      ${receiptBizBlock(fiscal, restaurantName)}
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta receipt-invoice">RAPORT SHITJESH</div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta">Periudha: ${escHtml(periodLabel)}</div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-item"><span>Shitjet totale</span><span>${formatEuro(rep.totalSales)}</span></div>
      <div class="receipt-item"><span>Porosi të përfunduara</span><span>${rep.orderCount || 0}</span></div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta receipt-invoice">ARTIKUJ MË TË SHITUR</div>
      ${topLines || `<div class="receipt-meta">Pa të dhëna.</div>`}
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta">Gjeneruar: ${gen.date} ${gen.time}</div>
      <div class="receipt-thanks">${escHtml(fiscal?.biz_footer || "Faleminderit!")}</div>
      <div class="receipt-rule">================================</div>
    </div>`;
}

/** Njësoj si buildReportPrintHtml, si rreshta tekst (ESC/POS raw, si faturat/raportet X/Z). */
function buildReportPrintLines(report, fiscal, restaurantName, paper = "80mm") {
  const rep = report || {};
  const f = fiscal || {};
  const bizName = f.biz_name || restaurantName || "Hotel";
  const w = paperChars(paper);
  const gen = formatReceiptDateTime(new Date().toISOString());
  const periodLabel = rep.dateFrom === rep.dateTo
    ? rep.dateFrom
    : `${rep.dateFrom} — ${rep.dateTo}`;

  const lines = [divider(w), pad(bizName, w, "center")];
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");
  if (addr) lines.push(pad(addr, w, "center"));
  if (f.biz_phone) lines.push(pad(`Tel: ${f.biz_phone}`, w, "center"));
  lines.push(divider(w));
  lines.push(`NF: ${f.biz_fiscal_number || "—"}`);
  lines.push(`TVSh Nr.: ${f.biz_vat_number || "—"}`);
  lines.push(divider(w));
  lines.push(pad("RAPORT SHITJESH", w, "center"));
  lines.push(divider(w, "-"));
  lines.push(`Periudha: ${periodLabel}`);
  lines.push(divider(w, "-"));
  lines.push(labelValueLine("Shitjet totale", money(rep.totalSales), w));
  lines.push(labelValueLine("Porosi të përfunduara", String(rep.orderCount || 0), w));
  lines.push(divider(w, "-"));
  lines.push(pad("ARTIKUJ MË TË SHITUR", w, "center"));
  if ((rep.topItems || []).length) {
    for (const it of rep.topItems) {
      lines.push(truncatedLabelValueLine(it.name, `${it.quantity} copë`, w));
    }
  } else {
    lines.push("Pa të dhëna.");
  }
  lines.push(divider(w));
  lines.push(`Gjeneruar: ${gen.date} ${gen.time}`);
  lines.push(pad(f.biz_footer || "Faleminderit!", w, "center"));
  lines.push(divider(w));

  return lines;
}

/** Fatura e check-out të hotelit — HTML 80mm. */
function buildGuestFolioPrintHtml(folio, fiscal, restaurantName) {
  const f = fiscal || {};
  const data = folio || {};
  const guest = data.guest || {};
  const room = data.room || {};
  const bill = data.bill || {};
  const bizName = data.hotel_name || f.biz_name || restaurantName || "Hotel";
  const gen = formatReceiptDateTime(data.printed_at || new Date().toISOString());

  const serviceLines = (data.service_lines || []).map((it) =>
    `<div class="receipt-item"><span>${escHtml(it.description)}</span><span>${formatEuro(it.amount)}</span></div>`,
  ).join("");
  const foodLines = (data.food_lines || []).map((it) =>
    `<div class="receipt-item"><span>${escHtml(it.description)}</span><span>${formatEuro(it.amount)}</span></div>`,
  ).join("");

  return `
    <div class="receipt-body">
      ${receiptBizBlock({ ...f, biz_name: bizName }, bizName)}
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta receipt-invoice">FATURË QËNDRIMI</div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-item"><span>Mysafiri</span><span>${escHtml(guest.guest_name || "—")}</span></div>
      <div class="receipt-item"><span>Dhoma</span><span>${escHtml(room.room_number || "—")}</span></div>
      <div class="receipt-item"><span>Check-in</span><span>${escHtml(bill.check_in_date || guest.check_in_date || "—")}</span></div>
      <div class="receipt-item"><span>Check-out</span><span>${escHtml(bill.check_out_date || guest.check_out_date || "—")}</span></div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta receipt-invoice">DHOMË</div>
      <div class="receipt-item"><span>${escHtml(data.room_line?.description || `${bill.nights || 0} netë`)}</span><span>${formatEuro(bill.room_total)}</span></div>
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta receipt-invoice">SHËRBIMET</div>
      ${serviceLines || `<div class="receipt-meta">Pa shërbime</div>`}
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta receipt-invoice">USHQIM / PIJE</div>
      ${foodLines || `<div class="receipt-meta">Pa porosi</div>`}
      <div class="receipt-rule">================================</div>
      <div class="receipt-total"><span>TOTALI</span><span>${formatEuro(bill.total)}</span></div>
      <div class="receipt-rule">================================</div>
      <div class="receipt-meta">Printuar: ${gen.date} ${gen.time}</div>
      <div class="receipt-thanks">${escHtml(f.biz_footer || "Faleminderit!")}</div>
      <div class="receipt-rule">================================</div>
    </div>`;
}

/** Fatura e check-out — rreshta tekst ESC/POS 80mm. */
function buildGuestFolioPrintLines(folio, fiscal, restaurantName, paper = "80mm") {
  const f = fiscal || {};
  const data = folio || {};
  const guest = data.guest || {};
  const room = data.room || {};
  const bill = data.bill || {};
  const bizName = data.hotel_name || f.biz_name || restaurantName || "Hotel";
  const w = paperChars(paper);
  const gen = formatReceiptDateTime(data.printed_at || new Date().toISOString());

  const lines = [divider(w), pad(bizName, w, "center")];
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");
  if (addr) lines.push(pad(addr, w, "center"));
  if (f.biz_phone) lines.push(pad(`Tel: ${f.biz_phone}`, w, "center"));
  lines.push(divider(w));
  if (f.biz_fiscal_number) lines.push(`NF: ${f.biz_fiscal_number}`);
  if (f.biz_vat_number) lines.push(`TVSh Nr.: ${f.biz_vat_number}`);
  lines.push(divider(w));
  lines.push(pad("FATURË QËNDRIMI", w, "center"));
  lines.push(divider(w, "-"));
  lines.push(truncatedLabelValueLine("Mysafiri", guest.guest_name || "—", w));
  lines.push(labelValueLine("Dhoma", String(room.room_number || "—"), w));
  lines.push(labelValueLine("Check-in", String(bill.check_in_date || guest.check_in_date || "—"), w));
  lines.push(labelValueLine("Check-out", String(bill.check_out_date || guest.check_out_date || "—"), w));
  lines.push(divider(w, "-"));
  lines.push(pad("DHOMË", w, "center"));
  lines.push(truncatedLabelValueLine(
    data.room_line?.description || `${bill.nights || 0} netë`,
    money(bill.room_total),
    w,
  ));
  lines.push(divider(w, "-"));
  lines.push(pad("SHËRBIMET", w, "center"));
  if ((data.service_lines || []).length) {
    for (const it of data.service_lines) {
      lines.push(truncatedLabelValueLine(it.description, money(it.amount), w));
    }
  } else {
    lines.push("Pa shërbime");
  }
  lines.push(divider(w, "-"));
  lines.push(pad("USHQIM / PIJE", w, "center"));
  if ((data.food_lines || []).length) {
    for (const it of data.food_lines) {
      lines.push(truncatedLabelValueLine(it.description, money(it.amount), w));
    }
  } else {
    lines.push("Pa porosi");
  }
  lines.push(divider(w));
  lines.push(labelValueLine("TOTALI", money(bill.total), w));
  lines.push(divider(w));
  lines.push(`Printuar: ${gen.date} ${gen.time}`);
  lines.push(pad(f.biz_footer || "Faleminderit!", w, "center"));
  lines.push(divider(w));
  return lines;
}

module.exports = {
  buildMenuPrintHtml,
  buildReportPrintHtml,
  buildReportPrintLines,
  buildGuestFolioPrintHtml,
  buildGuestFolioPrintLines,
};
