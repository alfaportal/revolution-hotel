const { getSupabase } = require("../db");
const { VAT_CATEGORIES, VAT_KEYS, emptyVatBreakdown, sumVatBreakdowns } = require("../lib/vatCategories");
const { getFiscalSettings } = require("./fiscalService");
const { normalizeItems } = require("./salesService");
const { getFiscalLogoHtmlFooter, FISCAL_LOGO_CSS } = require("../lib/fiscalLogoHtml");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dayBounds(dateStr) {
  const d = dateStr || todayISO();
  return {
    date: d,
    from: `${d}T00:00:00.000Z`,
    to: `${d}T23:59:59.999Z`,
  };
}

function rangeBounds(fromDate, toDate) {
  const from = String(fromDate || "").slice(0, 10);
  const to = String(toDate || "").slice(0, 10);
  return {
    from_date: from,
    to_date: to,
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
  };
}

function validateDateRange(fromDate, toDate) {
  const from = String(fromDate || "").slice(0, 10);
  const to = String(toDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Datat duhet YYYY-MM-DD");
  }
  if (from > to) throw new Error("Data Nga duhet ≤ Deri");
  return { from, to };
}

async function fetchDayFiscalReceipts(clientId, dateStr) {
  const { from, to } = dayBounds(dateStr);
  return fetchFiscalReceiptsInRange(clientId, from, to);
}

async function fetchFiscalReceiptsInRange(clientId, fromIso, toIso) {
  const db = getSupabase();
  const { data, error } = await db
    .from("fiscal_receipts")
    .select("*")
    .eq("client_id", clientId)
    .gte("printed_at", fromIso)
    .lte("printed_at", toIso)
    .order("printed_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchDayClosedSales(clientId, dateStr) {
  const { from, to } = dayBounds(dateStr);
  return fetchClosedSalesInRange(clientId, from, to);
}

async function fetchClosedSalesInRange(clientId, fromIso, toIso) {
  const db = getSupabase();
  const { data, error } = await db
    .from("sales_orders")
    .select("id, table_number, waiter_name, items_json, total, receipt_number, closed_at, payment_status, payment_method, fiscal_receipt_id")
    .eq("client_id", clientId)
    .eq("status", "closed")
    .gte("closed_at", fromIso)
    .lte("closed_at", toIso)
    .order("closed_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(o => ({
    ...o,
    items_json: normalizeItems(o.items_json),
  }));
}

async function getCumulativeTurnover(clientId, beforeDate) {
  const db = getSupabase();
  const { data, error } = await db
    .from("fiscal_receipts")
    .select("total_gross")
    .eq("client_id", clientId)
    .lt("printed_at", `${beforeDate}T00:00:00.000Z`);
  if (error) throw error;
  return Math.round((data || []).reduce((s, r) => s + Number(r.total_gross), 0) * 100) / 100;
}

/** Shitjet sipas kategorisë së menusë (jo kategoria TVSH A-E) — kundrejt
 * emrit të artikullit te pos_menu_items, njësoj si dashboard-i i pronarit. */
async function getCategoryBreakdown(clientId, salesDetail) {
  const db = getSupabase();
  const { data: menuItems } = await db
    .from("pos_menu_items")
    .select("name, category")
    .eq("client_id", clientId);
  const catByName = new Map(
    (menuItems || []).map(m => [String(m.name || "").trim().toLowerCase(), m.category || "Të tjera"]),
  );
  const totals = {};
  for (const s of salesDetail) {
    for (const it of s.items || []) {
      const cat = catByName.get(String(it.name || "").trim().toLowerCase()) || "Të tjera";
      const rev = (Number(it.price) || 0) * (Number(it.quantity) || 1);
      totals[cat] = (totals[cat] || 0) + rev;
    }
  }
  return Object.entries(totals)
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

function getWaiterBreakdown(salesDetail) {
  const byWaiter = new Map();
  for (const s of salesDetail) {
    const key = s.waiter_name || "—";
    const prev = byWaiter.get(key) || { waiter_name: key, order_count: 0, total_sales: 0 };
    prev.order_count += 1;
    prev.total_sales = Math.round((prev.total_sales + s.total) * 100) / 100;
    byWaiter.set(key, prev);
  }
  return [...byWaiter.values()].sort((a, b) => b.total_sales - a.total_sales);
}

/** Rangu i numrave të kuponëve fiskalë të ditës — kronologjik (parë..fundit),
 * jo domosdoshmërisht rendit numerik, pasi numrat i cakton arka fiskale. */
function getReceiptNumberRange(salesDetail) {
  const nums = salesDetail.map(s => s.receipt_number).filter(Boolean);
  if (!nums.length) return { from: "", to: "", count: 0 };
  return { from: nums[0], to: nums[nums.length - 1], count: nums.length };
}

async function buildDailyZReport(clientId, dateStr) {
  const date = dateStr || todayISO();
  const settings = await getFiscalSettings(clientId);
  const receipts = await fetchDayFiscalReceipts(clientId, date);
  const sales = await fetchDayClosedSales(clientId, date);
  const stored = await getStoredZReport(clientId, date);

  const totals = sumVatBreakdowns(receipts);
  const couponCount = receipts.filter(r => r.status === "printed" || r.status === "manual").length;
  const cashRegisterBalance = receipts.reduce((s, r) => s + Number(r.cash_given || r.total_gross), 0);
  const cumulativeBefore = await getCumulativeTurnover(clientId, date);
  const cumulativeTurnover = Math.round((cumulativeBefore + totals.totalGross) * 100) / 100;

  const salesDetail = sales.map(s => {
    const receipt = receipts.find(r => r.sale_order_id === s.id);
    const pm = s.payment_method === "karte" ? "karte" : "cash";
    return {
      id: s.id,
      time: s.closed_at,
      table_number: s.table_number,
      waiter_name: s.waiter_name,
      total: Number(s.total),
      payment_status: s.payment_status,
      payment_method: pm,
      payment_label: pm === "karte" ? "Kartë" : "Cash",
      receipt_number: s.receipt_number,
      coupon_nr: receipt?.coupon_nr || "",
      serial_nr: receipt?.serial_nr || "",
      items: s.items_json,
    };
  });

  const payment_totals = { cash: 0, karte: 0 };
  for (const s of salesDetail) {
    payment_totals[s.payment_method] = Math.round((payment_totals[s.payment_method] + s.total) * 100) / 100;
  }

  const cashRegisterBalanceRounded = Math.round(cashRegisterBalance * 100) / 100;
  const openingFloat = stored?.opening_float != null ? Number(stored.opening_float) : null;
  const expectedClosingCash = openingFloat != null
    ? Math.round((openingFloat + cashRegisterBalanceRounded) * 100) / 100
    : null;

  return {
    report_type: "Z",
    report_date: date,
    business_name: settings.business_name,
    fiscal_nr: settings.fiscal_nr,
    pef_serial_number: settings.pef_serial_number || "",
    responsible_person: settings.fiscal_operator_name || settings.business_name,
    coupon_count: couponCount,
    turnover_total: totals.totalGross,
    turnover_net: totals.totalNet,
    turnover_vat: totals.totalVat,
    vat_breakdown: totals.breakdown,
    vat_categories: VAT_CATEGORIES,
    cash_register_balance: cashRegisterBalanceRounded,
    cumulative_turnover: cumulativeTurnover,
    cumulative_before: cumulativeBefore,
    sales: salesDetail,
    payment_totals,
    by_category: await getCategoryBreakdown(clientId, salesDetail),
    by_waiter: getWaiterBreakdown(salesDetail),
    receipt_number_range: getReceiptNumberRange(salesDetail),
    opening_float: openingFloat,
    closing_cash_actual: stored?.closing_cash_actual != null ? Number(stored.closing_cash_actual) : null,
    expected_closing_cash: expectedClosingCash,
    cash_difference: stored?.cash_difference != null ? Number(stored.cash_difference) : null,
    cash_difference_reason: stored?.cash_difference_reason || "",
    closed_at: stored?.closed_at || null,
    fiscal_receipts: receipts,
    generated_at: new Date().toISOString(),
  };
}

/** Raporti X — gjendja e tashme e ditës, e printueshme në çdo kohë, PA
 * mbyllur/arkivuar asgjë (nuk shkruan te daily_z_reports). Rikthen krejt
 * llogaritjet e njëjta si Z-Report, thjesht heq fushat e barazimit të arkës
 * (ato i takojnë vetëm mbylljes përfundimtare të ditës). */
async function buildDailyXReport(clientId, dateStr) {
  const z = await buildDailyZReport(clientId, dateStr);
  const {
    opening_float, closing_cash_actual, expected_closing_cash,
    cash_difference, cash_difference_reason, closed_at,
    ...rest
  } = z;
  return { ...rest, report_type: "X", is_closed: Boolean(closed_at) };
}

/** Raport periodik — akumulim mes dy datave (lexim Supabase), pa mbyllje ditore. */
async function buildPeriodicReport(clientId, fromDate, toDate) {
  const { from, to } = validateDateRange(fromDate, toDate);
  const bounds = rangeBounds(from, to);
  const settings = await getFiscalSettings(clientId);
  const receipts = await fetchFiscalReceiptsInRange(clientId, bounds.from, bounds.to);
  const sales = await fetchClosedSalesInRange(clientId, bounds.from, bounds.to);

  const totals = sumVatBreakdowns(receipts);
  const couponCount = receipts.filter(r => r.status === "printed" || r.status === "manual").length;
  const cashRegisterBalance = receipts.reduce((s, r) => s + Number(r.cash_given || r.total_gross), 0);
  const offlineCount = receipts.filter(r => r.register_connected === false).length;

  const salesDetail = sales.map(s => {
    const receipt = receipts.find(r => r.sale_order_id === s.id);
    const pm = s.payment_method === "karte" ? "karte" : "cash";
    return {
      id: s.id,
      time: s.closed_at,
      table_number: s.table_number,
      waiter_name: s.waiter_name,
      total: Number(s.total),
      payment_status: s.payment_status,
      payment_method: pm,
      payment_label: pm === "karte" ? "Kartë" : "Cash",
      receipt_number: s.receipt_number,
      coupon_nr: receipt?.coupon_nr || "",
      serial_nr: receipt?.serial_nr || "",
      items: s.items_json,
    };
  });

  const payment_totals = { cash: 0, karte: 0 };
  for (const s of salesDetail) {
    payment_totals[s.payment_method] = Math.round((payment_totals[s.payment_method] + s.total) * 100) / 100;
  }

  return {
    report_type: "PERIODIC",
    from_date: from,
    to_date: to,
    report_date: `${from} — ${to}`,
    business_name: settings.business_name,
    fiscal_nr: settings.fiscal_nr,
    pef_serial_number: settings.pef_serial_number || "",
    responsible_person: settings.fiscal_operator_name || settings.business_name,
    coupon_count: couponCount,
    turnover_total: totals.totalGross,
    turnover_net: totals.totalNet,
    turnover_vat: totals.totalVat,
    vat_breakdown: totals.breakdown,
    vat_categories: VAT_CATEGORIES,
    cash_register_balance: Math.round(cashRegisterBalance * 100) / 100,
    offline_count: offlineCount,
    sales: salesDetail,
    payment_totals,
    by_category: await getCategoryBreakdown(clientId, salesDetail),
    by_waiter: getWaiterBreakdown(salesDetail),
    receipt_number_range: getReceiptNumberRange(salesDetail),
    generated_at: new Date().toISOString(),
  };
}

async function getStoredZReport(clientId, dateStr) {
  const db = getSupabase();
  const { data } = await db
    .from("daily_z_reports")
    .select("*")
    .eq("client_id", clientId)
    .eq("report_date", dateStr)
    .maybeSingle();
  return data;
}

async function saveDailyZReport(clientId, dateStr, {
  close = false,
  closing_cash_actual = null,
  cash_difference_reason = null,
} = {}) {
  const report = await buildDailyZReport(clientId, dateStr);
  const db = getSupabase();

  let closingCashActual = report.closing_cash_actual;
  let cashDifference = report.cash_difference;
  let reason = report.cash_difference_reason;

  if (close) {
    if (closing_cash_actual != null) closingCashActual = Number(closing_cash_actual);
    if (cash_difference_reason != null) reason = String(cash_difference_reason).trim().slice(0, 500);
    if (closingCashActual != null && report.opening_float != null) {
      cashDifference = Math.round(
        (closingCashActual - (report.opening_float + report.cash_register_balance)) * 100,
      ) / 100;
    }
  }

  const row = {
    client_id: clientId,
    report_date: report.report_date,
    coupon_count: report.coupon_count,
    turnover_total: report.turnover_total,
    turnover_net: report.turnover_net,
    turnover_vat: report.turnover_vat,
    vat_breakdown: report.vat_breakdown,
    cash_register_balance: report.cash_register_balance,
    cumulative_turnover: report.cumulative_turnover,
    responsible_person: report.responsible_person,
    fiscal_nr: report.fiscal_nr,
    sales_json: report.sales,
    opening_float: report.opening_float,
    closing_cash_actual: closingCashActual,
    cash_difference: cashDifference,
    cash_difference_reason: reason,
    closed_at: close ? new Date().toISOString() : null,
  };

  const { data, error } = await db
    .from("daily_z_reports")
    .upsert(row, { onConflict: "client_id,report_date" })
    .select()
    .single();
  if (error) throw error;
  return {
    ...report,
    closing_cash_actual: data.closing_cash_actual != null ? Number(data.closing_cash_actual) : null,
    cash_difference: data.cash_difference != null ? Number(data.cash_difference) : null,
    cash_difference_reason: data.cash_difference_reason || "",
    closed_at: data.closed_at || null,
    stored: data,
    closed: close,
  };
}

/** Vendos paranë e nisjes së arkës për një ditë — thirret në fillim të ditës,
 * para se Z-Report të mbyllet. Nuk prek fusha të tjera nëse rreshti ekziston. */
async function setOpeningFloat(clientId, dateStr, openingFloat) {
  const date = dateStr || todayISO();
  const amount = Number(openingFloat);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Paraja e nisjes duhet të jetë 0 ose më shumë.");
  }
  const db = getSupabase();
  const { data: existing } = await db
    .from("daily_z_reports")
    .select("client_id")
    .eq("client_id", clientId)
    .eq("report_date", date)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("daily_z_reports")
      .update({ opening_float: amount })
      .eq("client_id", clientId)
      .eq("report_date", date);
    if (error) throw error;
  } else {
    const { error } = await db
      .from("daily_z_reports")
      .insert({ client_id: clientId, report_date: date, opening_float: amount });
    if (error) throw error;
  }
  return buildDailyZReport(clientId, date);
}

async function listZReportHistory(clientId, limit = 60) {
  const db = getSupabase();
  const { data, error } = await db
    .from("daily_z_reports")
    .select("report_date, coupon_count, turnover_total, turnover_vat, cash_register_balance, cumulative_turnover, closed_at, created_at")
    .eq("client_id", clientId)
    .order("report_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

function reportTypeLabel(report) {
  if (report.report_type === "X") return "Raporti X (i përkohshëm)";
  if (report.report_type === "PERIODIC") return "Raport Periodik Fiskal";
  return "Raporti Ditor (Z-Report)";
}

function zReportToCsv(report) {
  const lines = [];
  lines.push(reportTypeLabel(report));
  lines.push(`Biznesi,${csvEsc(report.business_name)}`);
  lines.push(`Nr.Fisk,${csvEsc(report.fiscal_nr)}`);
  lines.push(`Nr. Serial PEF,${csvEsc(report.pef_serial_number)}`);
  if (report.report_type === "PERIODIC") {
    lines.push(`Nga data,${report.from_date}`);
    lines.push(`Deri data,${report.to_date}`);
  } else {
    lines.push(`Data,${report.report_date}`);
  }
  lines.push(`Kuponë fiskalë,${report.coupon_count}`);
  if (report.report_type === "PERIODIC") {
    lines.push(`Offline,${report.offline_count ?? 0}`);
  }
  lines.push(`Rangu i kuponëve,${csvEsc(report.receipt_number_range?.from)} - ${csvEsc(report.receipt_number_range?.to)}`);
  lines.push(`Qarkullimi total (€),${report.turnover_total}`);
  lines.push(`Totali pa TVSH (€),${report.turnover_net}`);
  lines.push(`TVSH total (€),${report.turnover_vat}`);
  lines.push(`Gjendja e arkës (€),${report.cash_register_balance}`);
  lines.push(`Qarkullimi kumulativ (€),${report.cumulative_turnover}`);
  lines.push(`Pagesa Cash (€),${report.payment_totals?.cash ?? 0}`);
  lines.push(`Pagesa Kartë (€),${report.payment_totals?.karte ?? 0}`);
  if (report.report_type === "Z") {
    lines.push(`Paraja e nisjes (€),${report.opening_float ?? ""}`);
    lines.push(`Paraja e pritshme (€),${report.expected_closing_cash ?? ""}`);
    lines.push(`Paraja e numëruar (€),${report.closing_cash_actual ?? ""}`);
    lines.push(`Diferenca (€),${report.cash_difference ?? ""}`);
    lines.push(`Arsyeja e diferencës,${csvEsc(report.cash_difference_reason)}`);
  }
  lines.push("");
  lines.push("TVSH breakdown");
  lines.push("Kategoria,Neto,VAT,Bruto");
  for (const k of VAT_KEYS) {
    const v = report.vat_breakdown?.[k] || { net: 0, vat: 0, gross: 0 };
    lines.push(`${k},${v.net},${v.vat},${v.gross}`);
  }
  lines.push("");
  lines.push("Shitjet sipas kategorisë");
  lines.push("Kategoria,Totali");
  for (const c of report.by_category || []) {
    lines.push(`${csvEsc(c.category)},${c.total}`);
  }
  lines.push("");
  lines.push("Shitjet sipas kamarierit");
  lines.push("Kamarieri,Porosi,Totali");
  for (const w of report.by_waiter || []) {
    lines.push(`${csvEsc(w.waiter_name)},${w.order_count},${w.total_sales}`);
  }
  lines.push("");
  lines.push("Shitjet");
  lines.push("Koha,Tavolina,Kamarieri,Totali,Pagesa,Kupon,Serial,Statusi");
  for (const s of report.sales || []) {
    lines.push([
      s.time || "",
      s.table_number || "",
      csvEsc(s.waiter_name),
      s.total,
      csvEsc(s.payment_label || s.payment_method || "Cash"),
      csvEsc(s.coupon_nr),
      csvEsc(s.serial_nr),
      s.payment_status || "",
    ].join(","));
  }
  return lines.join("\n");
}

function csvEsc(s) {
  const t = String(s ?? "");
  if (t.includes(",") || t.includes('"')) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function zReportToHtml(report) {
  const vatRows = VAT_KEYS.map(k => {
    const v = report.vat_breakdown?.[k] || { net: 0, vat: 0, gross: 0 };
    return `<tr><td>${VAT_CATEGORIES[k].label}</td><td>${v.net.toFixed(2)} €</td><td>${v.vat.toFixed(2)} €</td><td>${v.gross.toFixed(2)} €</td></tr>`;
  }).join("");

  const salesRows = (report.sales || []).map(s => `
    <tr>
      <td>${new Date(s.time).toLocaleString("sq-AL")}</td>
      <td>T${s.table_number || "—"}</td>
      <td>${escHtml(s.waiter_name)}</td>
      <td>${Number(s.total).toFixed(2)} €</td>
      <td>${escHtml(s.payment_label || "Cash")}</td>
      <td>${escHtml(s.coupon_nr || "—")}</td>
      <td>${escHtml(s.payment_status || "")}</td>
    </tr>`).join("");

  const categoryRows = (report.by_category || []).map(c =>
    `<tr><td>${escHtml(c.category)}</td><td>${c.total.toFixed(2)} €</td></tr>`).join("");

  const waiterRows = (report.by_waiter || []).map(w =>
    `<tr><td>${escHtml(w.waiter_name)}</td><td>${w.order_count}</td><td>${w.total_sales.toFixed(2)} €</td></tr>`).join("");

  const cashBox = report.report_type === "Z" && report.opening_float != null ? `
<div class="box"><strong>Barazimi i arkës</strong>
  <div class="grid">
    <div>Paraja e nisjes: ${report.opening_float.toFixed(2)} €</div>
    <div>Paraja e pritshme: ${(report.expected_closing_cash ?? 0).toFixed(2)} €</div>
    ${report.closing_cash_actual != null ? `<div>Paraja e numëruar: ${report.closing_cash_actual.toFixed(2)} €</div>` : ""}
    ${report.cash_difference != null ? `<div>Diferenca: ${report.cash_difference.toFixed(2)} €</div>` : ""}
  </div>
  ${report.cash_difference_reason ? `<div class="meta">Arsyeja: ${escHtml(report.cash_difference_reason)}</div>` : ""}
</div>` : "";

  const isX = report.report_type === "X";
  const isPeriodic = report.report_type === "PERIODIC";
  const htmlTitle = isPeriodic
    ? "RAPORT PERIODIK FISKAL"
    : isX
      ? "RAPORTI X (I PËRKOHSHËM)"
      : "RAPORTI DITOR (Z-REPORT)";
  const htmlSubtitle = isPeriodic
    ? "Mes dy datave — JO mbyllje"
    : isX
      ? "Gjendja aktuale e ditës — PA mbyllje"
      : "";
  const dateMeta = isPeriodic
    ? `${escHtml(report.from_date)} — ${escHtml(report.to_date)}`
    : escHtml(report.report_date);

  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8">
<title>${htmlTitle} ${escHtml(report.report_date)}</title>
<style>
body{font-family:Arial,sans-serif;padding:24px;color:#111}
h1{margin:0 0 4px} .meta{color:#444;margin-bottom:16px}
.subtitle{color:#555;margin:-8px 0 12px;font-size:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:16px 0}
.box{border:1px solid #ccc;padding:12px;border-radius:8px;margin:12px 0}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}
th{background:#f5f5f5}
.total{font-size:1.2em;font-weight:bold}
${FISCAL_LOGO_CSS}
@media print{body{padding:12px}}
</style></head><body>
<h1>${htmlTitle}</h1>
${htmlSubtitle ? `<p class="subtitle">${htmlSubtitle}</p>` : ""}
<div class="meta">${escHtml(report.business_name)} · Nr.Fisk: ${escHtml(report.fiscal_nr)}${report.pef_serial_number ? ` · PEF: ${escHtml(report.pef_serial_number)}` : ""} · ${dateMeta}</div>
<div class="grid">
  <div><strong>Kuponë fiskalë:</strong> ${report.coupon_count}</div>
  <div><strong>Rangu i kuponëve:</strong> ${escHtml(report.receipt_number_range?.from || "—")} – ${escHtml(report.receipt_number_range?.to || "—")}</div>
  <div><strong>Qarkullimi${isPeriodic ? " (interval)" : " ditor"}:</strong> ${report.turnover_total.toFixed(2)} €</div>
  <div><strong>Totali pa TVSH:</strong> ${report.turnover_net.toFixed(2)} €</div>
  <div><strong>TVSH total:</strong> ${report.turnover_vat.toFixed(2)} €</div>
  <div><strong>Gjendja e arkës:</strong> ${report.cash_register_balance.toFixed(2)} €</div>
  <div><strong>Pagesa Cash:</strong> ${(report.payment_totals?.cash ?? 0).toFixed(2)} €</div>
  <div><strong>Pagesa Kartë:</strong> ${(report.payment_totals?.karte ?? 0).toFixed(2)} €</div>
  ${!isPeriodic ? `<div><strong>Qarkullimi kumulativ:</strong> ${report.cumulative_turnover?.toFixed(2) ?? "—"} €</div>` : ""}
  ${isPeriodic ? `<div><strong>Offline:</strong> ${report.offline_count ?? 0}</div>` : ""}
  <div><strong>Përgjegjësi:</strong> ${escHtml(report.responsible_person)}</div>
</div>
<div class="box"><strong>TVSH breakdown (A–E)</strong>
<table><thead><tr><th>Kategoria</th><th>Neto</th><th>TVSH</th><th>Bruto</th></tr></thead>
<tbody>${vatRows}</tbody></table></div>
<div class="box"><strong>Shitjet sipas kategorisë</strong>
<table><thead><tr><th>Kategoria</th><th>Totali</th></tr></thead>
<tbody>${categoryRows || "<tr><td colspan='2'>—</td></tr>"}</tbody></table></div>
<div class="box"><strong>Shitjet sipas kamarierit</strong>
<table><thead><tr><th>Kamarieri</th><th>Porosi</th><th>Totali</th></tr></thead>
<tbody>${waiterRows || "<tr><td colspan='3'>—</td></tr>"}</tbody></table></div>
${cashBox}
<div class="box"><strong>Shitjet${isPeriodic ? " (intervali)" : " e ditës"}</strong>
<table><thead><tr><th>Koha</th><th>Tav.</th><th>Kamarieri</th><th>Totali</th><th>Pagesa</th><th>Kupon</th><th>Statusi</th></tr></thead>
<tbody>${salesRows || "<tr><td colspan='7'>—</td></tr>"}</tbody></table></div>
${getFiscalLogoHtmlFooter()}
<p class="meta">Gjeneruar: ${new Date(report.generated_at).toLocaleString("sq-AL")}</p>
</body></html>`;
}

function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

module.exports = {
  buildDailyZReport,
  buildDailyXReport,
  buildPeriodicReport,
  saveDailyZReport,
  setOpeningFloat,
  getStoredZReport,
  listZReportHistory,
  zReportToCsv,
  zReportToHtml,
};
