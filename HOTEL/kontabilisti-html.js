function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatEuro(n) {
  return Number(n || 0).toFixed(2) + " EUR";
}

const PRINT_STYLE = `
  body{font-family:Segoe UI,system-ui,sans-serif;padding:24px;color:#0f172a;max-width:900px;margin:0 auto}
  h1{font-size:1.35rem;margin:0 0 4px}
  .meta{color:#64748b;font-size:0.9rem;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:0.88rem}
  th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0}
  th{text-align:left;background:#f8fafc;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;color:#64748b}
  .total{margin-top:16px;text-align:right;font-weight:800}
  @media print{body{padding:12px}}
`;

function buildSalesLedgerHtml(rows, bizName, periodLabel) {
  const list = rows || [];
  const trs = list.map(r =>
    `<tr>
      <td>${escHtml(r.date)}</td>
      <td>${escHtml(r.receipt_number || "—")}</td>
      <td>${escHtml(r.items)}</td>
      <td style="text-align:right">${formatEuro(r.total)}</td>
      <td>${escHtml(r.vat_rate)}</td>
      <td style="text-align:right">${formatEuro(r.vat_amount)}</td>
      <td>${escHtml(r.payment_method)}</td>
    </tr>`
  ).join("");
  const total = list.reduce((s, r) => s + Number(r.total || 0), 0);
  const vatTotal = list.reduce((s, r) => s + Number(r.vat_amount || 0), 0);

  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>Libri i shitjeve</title>
<style>${PRINT_STYLE}</style></head><body>
<h1>Libri i shitjeve</h1>
<div class="meta">${escHtml(bizName || "Hotel")} · ${escHtml(periodLabel || "")}</div>
<table>
  <thead><tr><th>Data</th><th>Nr. faturës</th><th>Artikujt</th><th>Shuma</th><th>Norma TVSH</th><th>TVSh</th><th>Mënyra e pagesës</th></tr></thead>
  <tbody>${trs || "<tr><td colspan='7'>Nuk ka shitje</td></tr>"}</tbody>
</table>
<div class="total">TOTALI: ${formatEuro(total)} · TVSh: ${formatEuro(vatTotal)}</div>
</body></html>`;
}

function buildExpensesLedgerHtml(rows, bizName, periodLabel) {
  const list = rows || [];
  const trs = list.map(r =>
    `<tr>
      <td>${escHtml(r.expense_date)}</td>
      <td>${escHtml(r.vendor_name)}</td>
      <td>${escHtml(r.description)}</td>
      <td>${escHtml(r.category)}</td>
      <td style="text-align:right">${formatEuro(r.amount)}</td>
      <td>${escHtml(r.entered_by)}</td>
    </tr>`
  ).join("");
  const total = list.reduce((s, r) => s + Number(r.amount || 0), 0);

  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>Libri i blerjeve/shpenzimeve</title>
<style>${PRINT_STYLE}</style></head><body>
<h1>Libri i blerjeve/shpenzimeve</h1>
<div class="meta">${escHtml(bizName || "Hotel")} · ${escHtml(periodLabel || "")}</div>
<table>
  <thead><tr><th>Data</th><th>Emri i firmës</th><th>Përshkrimi</th><th>Kategoria</th><th>Shuma</th><th>Regjistroi</th></tr></thead>
  <tbody>${trs || "<tr><td colspan='6'>Nuk ka shpenzime</td></tr>"}</tbody>
</table>
<div class="total">TOTALI: ${formatEuro(total)}</div>
</body></html>`;
}

function buildVatReportHtml(report, bizName, periodLabel) {
  const rep = report || { rows: [], totals: { gross: 0, net: 0, vat: 0 } };
  const trs = (rep.rows || []).map(r =>
    `<tr>
      <td>${escHtml(r.rate)}%</td>
      <td style="text-align:right">${formatEuro(r.net)}</td>
      <td style="text-align:right">${formatEuro(r.vat)}</td>
      <td style="text-align:right">${formatEuro(r.gross)}</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>Raporti i TVSH-së</title>
<style>${PRINT_STYLE}</style></head><body>
<h1>Raporti i TVSH-së</h1>
<div class="meta">${escHtml(bizName || "Hotel")} · ${escHtml(periodLabel || "")}</div>
<table>
  <thead><tr><th>Norma</th><th>Shitjet neto</th><th>TVSh e mbledhur</th><th>Shitjet bruto</th></tr></thead>
  <tbody>${trs || "<tr><td colspan='4'>Nuk ka të dhëna</td></tr>"}</tbody>
</table>
<div class="total">TOTALI: neto ${formatEuro(rep.totals.net)} · TVSh ${formatEuro(rep.totals.vat)} · bruto ${formatEuro(rep.totals.gross)}</div>
</body></html>`;
}

function buildPurchasesLedgerHtml(rows, bizName, periodLabel) {
  const list = rows || [];
  const trs = list.map((r) =>
    `<tr>
      <td>${escHtml(r.date)}</td>
      <td>${escHtml(r.supplier)}</td>
      <td>${escHtml(r.product_name)}</td>
      <td style="text-align:right">${escHtml(String(r.quantity))}</td>
      <td style="text-align:right">${formatEuro(r.unit_price)}</td>
      <td style="text-align:right">${formatEuro(r.line_total)}</td>
    </tr>`,
  ).join("");
  const seen = new Set();
  let invoiceTotal = 0;
  for (const r of list) {
    if (seen.has(r.invoice_id)) continue;
    seen.add(r.invoice_id);
    invoiceTotal += Number(r.invoice_total) || 0;
  }

  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>Blerjet</title>
<style>${PRINT_STYLE}</style></head><body>
<h1>Blerjet (stok)</h1>
<div class="meta">${escHtml(bizName || "Hotel")} · ${escHtml(periodLabel || "")}</div>
<table>
  <thead><tr><th>Data</th><th>Furnitori</th><th>Artikulli</th><th>Sasia</th><th>Çmimi</th><th>Totali</th></tr></thead>
  <tbody>${trs || "<tr><td colspan='6'>Nuk ka blerje</td></tr>"}</tbody>
</table>
<div class="total">TOTALI BLERJEVE: ${formatEuro(invoiceTotal)}</div>
</body></html>`;
}

function buildBilancHtml(bilanc, bizName) {
  const b = bilanc || {};
  const period = `${b.from || "—"} deri ${b.to || "—"}`;
  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>Bilanci — Kontabilisti</title>
<style>${PRINT_STYLE}
  .bilanc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}
  .bilanc-box{border:1px solid #e2e8f0;border-radius:8px;padding:14px}
  .bilanc-box .lbl{font-size:0.75rem;text-transform:uppercase;color:#64748b;letter-spacing:0.04em}
  .bilanc-box .val{font-size:1.4rem;font-weight:800;margin-top:4px}
  .bilanc-profit{grid-column:1/-1;background:#f0fdf4;border-color:#86efac}
  .bilanc-loss{background:#fef2f2;border-color:#fca5a5}
  .formula{color:#64748b;font-size:0.9rem;margin-top:8px}
</style></head><body>
<h1>Bilanci i kontabilistit</h1>
<div class="meta">${escHtml(bizName || "Hotel")} · ${escHtml(period)}</div>
<div class="bilanc-grid">
  <div class="bilanc-box"><div class="lbl">Shitjet (pa TVSH)</div><div class="val">${formatEuro(b.sales_total)}</div></div>
  <div class="bilanc-box"><div class="lbl">Blerjet (pa TVSH)</div><div class="val">${formatEuro(b.purchases_total)}</div></div>
  <div class="bilanc-box"><div class="lbl">Shpenzimet</div><div class="val">${formatEuro(b.expenses_total)}</div></div>
  <div class="bilanc-box ${Number(b.profit) < 0 ? "bilanc-loss" : "bilanc-profit"}">
    <div class="lbl">Fitimi neto</div>
    <div class="val">${formatEuro(b.profit)}</div>
    <div class="formula">(Shitje pa TVSH) − (Blerje pa TVSH) − Shpenzime = Fitimi neto</div>
  </div>
</div>
</body></html>`;
}

module.exports = {
  buildSalesLedgerHtml,
  buildExpensesLedgerHtml,
  buildVatReportHtml,
  buildPurchasesLedgerHtml,
  buildBilancHtml,
};
