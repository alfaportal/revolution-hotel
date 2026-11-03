const reports = require("./hotel-advanced-reports");

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}

function money(n) {
  return (Number(n) || 0).toFixed(2);
}

function htmlPage(title, body) {
  return `<!DOCTYPE html><html lang="sq"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:18px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left}th{background:#f3f4f6}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;
}

function tableHtml(headers, rows) {
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function exportWeeklyCsv(date) {
  const data = reports.getWeeklyReport(date);
  const csv = toCsv(
    ["Data", "Dita", "Porosi", "Totali", "Cash", "Kartë", "Kamarier", "Recepsion"],
    data.days.map((d) => [d.date, d.day_name, d.order_count, money(d.total), money(d.cash), money(d.card), money(d.waiter), money(d.reception)]),
  );
  return { csv, period: `${data.from} — ${data.to}` };
}

function exportWeeklyPdf(date) {
  const data = reports.getWeeklyReport(date);
  const html = htmlPage(
    `Raporte të avancuara — Javore (${data.from} — ${data.to})`,
    tableHtml(
      ["Data", "Dita", "Porosi", "Totali", "Cash", "Kartë", "Kamarier", "Recepsion"],
      data.days.map((d) => [d.date, d.day_name, d.order_count, money(d.total), money(d.cash), money(d.card), money(d.waiter), money(d.reception)]),
    ),
  );
  return { html, period: `${data.from} — ${data.to}` };
}

function exportMonthlyCsv(month) {
  const data = reports.getMonthlyReport(month);
  const csv = toCsv(
    ["Data", "Porosi", "Totali", "Cash", "Kartë", "Kamarier", "Recepsion"],
    data.days.map((d) => [d.date, d.order_count, money(d.total), money(d.cash), money(d.card), money(d.waiter), money(d.reception)]),
  );
  return { csv, period: data.month };
}

function exportMonthlyPdf(month) {
  const data = reports.getMonthlyReport(month);
  const html = htmlPage(
    `Raporte të avancuara — Mujore (${data.month})`,
    tableHtml(
      ["Data", "Porosi", "Totali", "Cash", "Kartë", "Kamarier", "Recepsion"],
      data.days.map((d) => [d.date, d.order_count, money(d.total), money(d.cash), money(d.card), money(d.waiter), money(d.reception)]),
    ),
  );
  return { html, period: data.month };
}

function exportComparisonCsv(month1, month2) {
  const data = reports.getComparisonReport(month1, month2);
  const csv = toCsv(
    ["Muaji", "Porosi", "Totali", "Cash", "Kartë", "Kamarier", "Recepsion"],
    [data.month1, data.month2].map((m) => [
      m.month,
      m.summary.order_count,
      money(m.summary.total),
      money(m.summary.cash),
      money(m.summary.card),
      money(m.summary.waiter),
      money(m.summary.reception),
    ]),
  );
  return { csv, period: `${data.month1.month} / ${data.month2.month}` };
}

function exportComparisonPdf(month1, month2) {
  const data = reports.getComparisonReport(month1, month2);
  const html = htmlPage(
    `Raporte të avancuara — Krahasime (${data.month1.month} / ${data.month2.month})`,
    tableHtml(
      ["Muaji", "Porosi", "Totali", "Cash", "Kartë", "Kamarier", "Recepsion"],
      [data.month1, data.month2].map((m) => [
        m.month,
        m.summary.order_count,
        money(m.summary.total),
        money(m.summary.cash),
        money(m.summary.card),
        money(m.summary.waiter),
        money(m.summary.reception),
      ]),
    ) + `<p>Ndryshimi: ${money(data.delta)} EUR (${money(data.delta_pct)}%)</p>`,
  );
  return { html, period: `${data.month1.month} / ${data.month2.month}` };
}

function exportTrendsCsv() {
  const data = reports.getTrendsReport();
  const csv = toCsv(
    ["Nga", "Deri", "Porosi", "Totali", "Cash", "Kartë"],
    data.weeks.map((w) => [w.from, w.to, w.order_count, money(w.total), money(w.cash), money(w.card)]),
  );
  return { csv };
}

function exportTrendsPdf() {
  const data = reports.getTrendsReport();
  const html = htmlPage(
    "Raporte të avancuara — Trende",
    tableHtml(
      ["Nga", "Deri", "Porosi", "Totali", "Cash", "Kartë"],
      data.weeks.map((w) => [w.from, w.to, w.order_count, money(w.total), money(w.cash), money(w.card)]),
    ),
  );
  return { html };
}

function exportTurnoverCsv(from, to) {
  const data = reports.getTurnoverReport(from, to);
  const csv = toCsv(
    ["Kategoria", "Sasia", "Të ardhura"],
    data.categories.map((c) => [c.category, c.qty, money(c.revenue)]),
  );
  return { csv, period: `${data.from} — ${data.to}` };
}

function exportTurnoverPdf(from, to) {
  const data = reports.getTurnoverReport(from, to);
  const html = htmlPage(
    `Raporte të avancuara — Qarkullimi (${data.from} — ${data.to})`,
    tableHtml(
      ["Kategoria", "Sasia", "Të ardhura"],
      data.categories.map((c) => [c.category, c.qty, money(c.revenue)]),
    ),
  );
  return { html, period: `${data.from} — ${data.to}` };
}

function exportStaffCsv(from, to) {
  const data = reports.getStaffReport(from, to);
  const csv = toCsv(
    ["Punonjësi", "Stacioni", "Porosi", "Totali", "Cash", "Kartë"],
    data.staff.map((s) => [s.operator, s.station_label, s.order_count, money(s.total), money(s.cash), money(s.card)]),
  );
  return { csv, period: `${data.from} — ${data.to}` };
}

function exportStaffPdf(from, to) {
  const data = reports.getStaffReport(from, to);
  const html = htmlPage(
    `Raporte të avancuara — Punonjësit (${data.from} — ${data.to})`,
    tableHtml(
      ["Punonjësi", "Stacioni", "Porosi", "Totali", "Cash", "Kartë"],
      data.staff.map((s) => [s.operator, s.station_label, s.order_count, money(s.total), money(s.cash), money(s.card)]),
    ),
  );
  return { html, period: `${data.from} — ${data.to}` };
}

function exportShiftsCsv(from, to) {
  const data = reports.getShiftsReport(from, to);
  const csv = toCsv(
    ["Stafi", "Roli", "Hapur", "Mbyllur", "Shitje", "Cash i numëruar", "Diferenca"],
    data.shifts.map((s) => [
      s.waiter_name,
      s.staff_role === "recepsion" ? "Recepsion" : "Kamarier",
      s.opened_at || "",
      s.is_open ? "Hapur" : s.closed_at || "",
      money(s.total_sales),
      s.is_open ? "" : money(s.closing_cash_actual),
      s.is_open ? "" : money(s.cash_difference),
    ]),
  );
  return { csv, period: `${data.from} — ${data.to}` };
}

function exportShiftsPdf(from, to) {
  const data = reports.getShiftsReport(from, to);
  const html = htmlPage(
    `Raporte të avancuara — Ndërrimet (${data.from} — ${data.to})`,
    tableHtml(
      ["Stafi", "Roli", "Mbyllur", "Shitje", "Cash i numëruar", "Diferenca"],
      data.shifts.map((s) => [
        s.waiter_name || "—",
        s.staff_role === "recepsion" ? "Recepsion" : "Kamarier",
        s.is_open ? "Hapur" : s.closed_at || "—",
        money(s.total_sales),
        s.is_open ? "—" : money(s.closing_cash_actual),
        s.is_open ? "—" : money(s.cash_difference),
      ]),
    ),
  );
  return { html, period: `${data.from} — ${data.to}` };
}

module.exports = {
  exportWeeklyCsv,
  exportWeeklyPdf,
  exportMonthlyCsv,
  exportMonthlyPdf,
  exportComparisonCsv,
  exportComparisonPdf,
  exportTrendsCsv,
  exportTrendsPdf,
  exportTurnoverCsv,
  exportTurnoverPdf,
  exportStaffCsv,
  exportStaffPdf,
  exportShiftsCsv,
  exportShiftsPdf,
};
