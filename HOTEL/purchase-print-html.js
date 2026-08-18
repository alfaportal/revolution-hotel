function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatEuro(n) {
  return Number(n || 0).toFixed(2) + " EUR";
}

function buildPurchaseInvoiceHtml(invoice, bizName) {
  const inv = invoice || {};
  const items = inv.items || [];
  const rows = items.map(it =>
    `<tr>
      <td>${escHtml(it.product_name)}</td>
      <td style="text-align:center">${it.quantity}</td>
      <td style="text-align:right">${formatEuro(it.unit_price)}</td>
      <td style="text-align:right">${formatEuro(it.line_total)}</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>Faturë blerje ${escHtml(inv.invoice_number || inv.id)}</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;padding:24px;color:#0f172a;max-width:800px;margin:0 auto}
  h1{font-size:1.35rem;margin:0 0 4px}
  .meta{color:#64748b;font-size:0.9rem;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:0.9rem}
  th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0}
  th{text-align:left;background:#f8fafc;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.04em;color:#64748b}
  .total{margin-top:16px;text-align:right;font-size:1.15rem;font-weight:800}
  @media print{body{padding:12px}}
</style></head><body>
<h1>Faturë blerje stoku</h1>
<div class="meta">${escHtml(bizName || "Hotel")} · Furnizues: <strong>${escHtml(inv.supplier)}</strong><br>
Nr. faturës: ${escHtml(inv.invoice_number || "—")} · Data: ${escHtml(inv.invoice_date)} · Status: ${escHtml(inv.status || "completed")}</div>
<table>
  <thead><tr><th>Produkti</th><th>Sasia</th><th>Çmimi</th><th>Totali</th></tr></thead>
  <tbody>${rows || "<tr><td colspan='4'>Pa artikuj</td></tr>"}</tbody>
</table>
<div class="total">TOTALI: ${formatEuro(inv.total)}</div>
</body></html>`;
}

function buildPurchasesListHtml(invoices, bizName, periodLabel) {
  const rows = (invoices || []).map(inv =>
    `<tr>
      <td>${escHtml(inv.invoice_date)}</td>
      <td>${escHtml(inv.supplier)}</td>
      <td>${escHtml(inv.invoice_number || "—")}</td>
      <td style="text-align:right">${formatEuro(inv.total)}</td>
      <td>${escHtml(inv.status || "completed")}</td>
    </tr>`
  ).join("");

  const total = (invoices || []).reduce((s, i) => s + Number(i.total || 0), 0);

  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>Raport blerjesh</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;padding:24px;color:#0f172a;max-width:900px;margin:0 auto}
  h1{font-size:1.35rem;margin:0 0 4px}
  .meta{color:#64748b;font-size:0.9rem;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:0.88rem}
  th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0}
  th{text-align:left;background:#f8fafc;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;color:#64748b}
  .total{margin-top:16px;text-align:right;font-weight:800}
  @media print{body{padding:12px}}
</style></head><body>
<h1>Historia e blerjeve</h1>
<div class="meta">${escHtml(bizName || "Hotel")} · ${escHtml(periodLabel || "")}</div>
<table>
  <thead><tr><th>Data</th><th>Furnizuesi</th><th>Nr. faturës</th><th>Shuma</th><th>Statusi</th></tr></thead>
  <tbody>${rows || "<tr><td colspan='5'>Nuk ka fatura</td></tr>"}</tbody>
</table>
<div class="total">TOTALI: ${formatEuro(total)}</div>
</body></html>`;
}

module.exports = { buildPurchaseInvoiceHtml, buildPurchasesListHtml };
