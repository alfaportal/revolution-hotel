const {
  formatReceiptDateTime,
  pad,
  divider,
  labelValueLine,
  truncatedLabelValueLine,
  formatMoney,
  paperChars,
} = require("./receipt-text");

function unifiedPrintBusinessName() {
  try {
    return require("./database").getUnifiedBusinessName();
  } catch {
    return "";
  }
}

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

function folioTaxpayerNui(fiscal) {
  const f = fiscal || {};
  const fromFiscal = String(f.biz_nui || f.taxpayer_nui || "").trim();
  if (fromFiscal) return fromFiscal;
  try {
    return String(require("./fiscal/fiscal-config").getFiscalSettings().taxpayer_nui || "").trim();
  } catch {
    return "";
  }
}

function folioDepositAndDue(bill) {
  const deposit = Math.round((Number(bill?.deposit) || 0) * 100) / 100;
  if (deposit <= 0) return { deposit: 0, totalDue: null };
  let totalDue = Number(bill?.total_due);
  if (!Number.isFinite(totalDue)) {
    totalDue = Math.round(((Number(bill?.total) || 0) - deposit) * 100) / 100;
  }
  return { deposit, totalDue };
}

function receiptBizBlock(fiscal, restaurantName) {
  const f = fiscal || {};
  const bizName = unifiedPrintBusinessName();
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");
  const nf = String(f.biz_fiscal_number || "").trim();
  const vat = String(f.biz_vat_number || "").trim();
  const nui = folioTaxpayerNui(f);
  const fiscalLines = [
    nf ? `<div class="receipt-meta">NF: ${escHtml(nf)}</div>` : "",
    vat ? `<div class="receipt-meta">TVSh Nr.: ${escHtml(vat)}</div>` : "",
    nui ? `<div class="receipt-meta">NUI: ${escHtml(nui)}</div>` : "",
  ].filter(Boolean).join("");
  return `
    <div class="receipt-rule">================================</div>
    <div class="receipt-name">${escHtml(bizName)}</div>
    ${addr ? `<div class="receipt-meta">${escHtml(addr)}</div>` : ""}
    ${f.biz_phone ? `<div class="receipt-meta">Tel: ${escHtml(f.biz_phone)}</div>` : ""}
    <div class="receipt-rule">================================</div>
    ${fiscalLines}`;
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
  const bizName = unifiedPrintBusinessName();
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
  const bizName = unifiedPrintBusinessName();
  const gen = formatReceiptDateTime(data.printed_at || new Date().toISOString());

  const serviceLines = (data.service_lines || []).map((it) =>
    `<div class="receipt-item"><span>${escHtml(it.description)}</span><span>${formatEuro(it.amount)}</span></div>`,
  ).join("");
  const foodLines = (data.food_lines || []).map((it) =>
    `<div class="receipt-item"><span>${escHtml(it.description)}</span><span>${formatEuro(it.amount)}</span></div>`,
  ).join("");
  const { deposit, totalDue } = folioDepositAndDue(bill);
  const depositHtml =
    deposit > 0
      ? `<div class="receipt-item"><span>Depozita</span><span>-${deposit.toFixed(2)} EUR</span></div>
      <div class="receipt-total"><span>PËR PAGESË</span><span>${formatEuro(totalDue)}</span></div>`
      : "";

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
      ${data.processed_by ? `<div class="receipt-item"><span>Përpunoi pagesën</span><span>${escHtml(data.processed_by)}</span></div>` : ""}
      ${data.payment_label ? `<div class="receipt-item"><span>Pagesa</span><span>${escHtml(data.payment_label)}</span></div>` : ""}
      ${data.shift_id ? `<div class="receipt-item"><span>Nderrimi</span><span>#${escHtml(String(data.shift_id))}</span></div>` : ""}
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
      ${depositHtml}
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
  const bizName = unifiedPrintBusinessName();
  const w = paperChars(paper);
  const gen = formatReceiptDateTime(data.printed_at || new Date().toISOString());

  const lines = [divider(w), pad(bizName, w, "center")];
  const addr = [f.biz_address, f.biz_city].filter(Boolean).join(", ");
  if (addr) lines.push(pad(addr, w, "center"));
  if (f.biz_phone) lines.push(pad(`Tel: ${f.biz_phone}`, w, "center"));
  lines.push(divider(w));
  const nf = String(f.biz_fiscal_number || "").trim();
  const vat = String(f.biz_vat_number || "").trim();
  const nui = folioTaxpayerNui(f);
  if (nf) lines.push(`NF: ${nf}`);
  if (vat) lines.push(`TVSh Nr.: ${vat}`);
  if (nui) lines.push(`NUI: ${nui}`);
  lines.push(divider(w));
  lines.push(pad("FATURË QËNDRIMI", w, "center"));
  lines.push(divider(w, "-"));
  lines.push(truncatedLabelValueLine("Mysafiri", guest.guest_name || "—", w));
  lines.push(labelValueLine("Dhoma", String(room.room_number || "—"), w));
  lines.push(labelValueLine("Check-in", String(bill.check_in_date || guest.check_in_date || "—"), w));
  lines.push(labelValueLine("Check-out", String(bill.check_out_date || guest.check_out_date || "—"), w));
  if (data.processed_by) {
    lines.push(truncatedLabelValueLine("Përpunoi pagesën", String(data.processed_by), w));
  }
  if (data.payment_label) {
    lines.push(labelValueLine("Pagesa", String(data.payment_label), w));
  }
  if (data.shift_id) {
    lines.push(labelValueLine("Nderrimi", `#${String(data.shift_id)}`, w));
  }
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
  const { deposit, totalDue } = folioDepositAndDue(bill);
  if (deposit > 0) {
    lines.push(labelValueLine("Depozita", `-${formatMoney(deposit)} EUR`, w));
    lines.push(labelValueLine("PËR PAGESË", money(totalDue), w));
  }
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
