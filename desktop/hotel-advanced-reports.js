function sqlite() {
  return require("./database").db;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseIsoDate(s) {
  const p = String(s || "").slice(0, 10).split("-").map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}

const DAY_NAMES = ["E Diel", "E Hënë", "E Martë", "E Mërkurë", "E Enjte", "E Premte", "E Shtunë"];

function weekBounds(dateStr) {
  const d = parseIsoDate(dateStr || fmtDate(new Date()));
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: fmtDate(start), to: fmtDate(end) };
}

function monthBounds(ym) {
  const raw = String(ym || fmtDate(new Date())).slice(0, 7);
  const [y, m] = raw.split("-").map(Number);
  const start = new Date(y, (m || 1) - 1, 1);
  const end = new Date(y, m || 1, 0);
  return { from: fmtDate(start), to: fmtDate(end), month: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}` };
}

function fetchSales(from, to) {
  return sqlite()
    .prepare(
      `SELECT date, time, total, payment_method, cash_amount, card_amount, items_json,
              waiter_name, receipt_number, discount_total, staff_id
       FROM daily_log
       WHERE status = 'completed' AND date >= date(?) AND date <= date(?)
         AND ${require("./database").folioSettledRoomDailyLogExcludeSql()}
       ORDER BY date ASC, time ASC`,
    )
    .all(from, to);
}

function cashOf(row) {
  const method = String(row.payment_method || "").toLowerCase();
  if (row.cash_amount != null && row.card_amount != null) {
    return { cash: Number(row.cash_amount) || 0, card: Number(row.card_amount) || 0 };
  }
  const total = Number(row.total) || 0;
  if (method === "karte" || method === "debit_card" || method === "credit_card" || method === "card") {
    return { cash: 0, card: total };
  }
  if (method === "mixed" || method === "perzier") {
    return { cash: Number(row.cash_amount) || 0, card: Number(row.card_amount) || 0 };
  }
  return { cash: total, card: 0 };
}

function itemsOf(row) {
  try {
    const raw = JSON.parse(row.items_json || "[]");
    return Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function stationOf(row) {
  const rec = String(row.receipt_number || "").trim().toUpperCase();
  if (
    rec.startsWith("CO-")
    || rec.startsWith("RC-")
    || rec.startsWith("SVC-")
    || rec.startsWith("KR-")
    || rec.startsWith("KL-")
  ) {
    return "recepsion";
  }
  return "waiter";
}

function moneyParts(row) {
  const total = Number(row.total) || 0;
  const rec = String(row.receipt_number || "").trim().toUpperCase();
  if (rec.startsWith("CO-")) {
    let food = 0;
    for (const it of itemsOf(row)) {
      const name = String(it.name || "");
      const amt = (Number(it.quantity) || 1) * (Number(it.price) || 0);
      if (/^Dhoma\s+/i.test(name.trim())) continue;
      if (/\(\s*T\d+\s*\)/i.test(name) || /\(\s*POS\s*\)/i.test(name) || /\(\s*RS\s*\)/i.test(name)) {
        food += amt;
      }
    }
    food = round2(food);
    const reception = round2(total - food);
    return { restaurant: food, reception: reception < 0 ? 0 : reception };
  }
  if (stationOf(row) === "recepsion") return { restaurant: 0, reception: total };
  return { restaurant: total, reception: 0 };
}

function summarize(rows) {
  let total = 0;
  let cash = 0;
  let card = 0;
  let waiter = 0;
  let reception = 0;
  for (const row of rows) {
    const t = Number(row.total) || 0;
    const pay = cashOf(row);
    const parts = moneyParts(row);
    total += t;
    cash += pay.cash;
    card += pay.card;
    waiter += parts.restaurant;
    reception += parts.reception;
  }
  return {
    order_count: rows.length,
    total: round2(total),
    cash: round2(cash),
    card: round2(card),
    waiter: round2(waiter),
    reception: round2(reception),
  };
}

function eachDay(from, to) {
  const days = [];
  const cur = parseIsoDate(from);
  const end = parseIsoDate(to);
  while (cur <= end) {
    days.push(fmtDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function getWeeklyReport(dateStr) {
  const range = weekBounds(dateStr);
  const rows = fetchSales(range.from, range.to);
  const byDay = new Map(eachDay(range.from, range.to).map((d) => [d, []]));
  for (const row of rows) {
    const key = String(row.date || "").slice(0, 10);
    if (byDay.has(key)) byDay.get(key).push(row);
  }
  const days = [...byDay.entries()].map(([date, list]) => ({
    date,
    day_name: DAY_NAMES[parseIsoDate(date).getDay()],
    ...summarize(list),
  }));
  return { ok: true, ...range, days, summary: summarize(rows) };
}

function getMonthlyReport(month) {
  const range = monthBounds(month);
  const rows = fetchSales(range.from, range.to);
  const byDay = new Map(eachDay(range.from, range.to).map((d) => [d, []]));
  for (const row of rows) {
    const key = String(row.date || "").slice(0, 10);
    if (byDay.has(key)) byDay.get(key).push(row);
  }
  const days = [...byDay.entries()].map(([date, list]) => ({ date, ...summarize(list) }));
  return { ok: true, month: range.month, from: range.from, to: range.to, days, summary: summarize(rows) };
}

function getComparisonReport(month1, month2) {
  const a = getMonthlyReport(month1);
  const b = getMonthlyReport(month2);
  const delta = round2(b.summary.total - a.summary.total);
  const pct = a.summary.total ? round2((delta / a.summary.total) * 100) : 0;
  return {
    ok: true,
    month1: { month: a.month, summary: a.summary },
    month2: { month: b.month, summary: b.summary },
    delta,
    delta_pct: pct,
  };
}

function getTrendsReport() {
  const end = new Date();
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i * 7);
    const range = weekBounds(fmtDate(d));
    const rows = fetchSales(range.from, range.to);
    weeks.push({ ...range, ...summarize(rows) });
  }
  return { ok: true, weeks };
}

function getTurnoverReport(from, to) {
  const start = String(from || fmtDate(new Date())).slice(0, 10);
  const end = String(to || start).slice(0, 10);
  const rows = fetchSales(start, end);
  const menu = sqlite().prepare("SELECT name, category FROM menu_items").all();
  const catByName = new Map(menu.map((m) => [String(m.name || "").trim().toLowerCase(), m.category || "Të tjera"]));
  const cats = new Map();
  for (const row of rows) {
    for (const it of itemsOf(row)) {
      const name = String(it.name || "").trim();
      if (!name) continue;
      const qty = Number(it.quantity ?? it.qty) || 1;
      const rev = qty * (Number(it.price) || 0);
      const cat = catByName.get(name.toLowerCase()) || "Të tjera";
      const cur = cats.get(cat) || { category: cat, qty: 0, revenue: 0 };
      cur.qty += qty;
      cur.revenue += rev;
      cats.set(cat, cur);
    }
  }
  const categories = [...cats.values()]
    .map((c) => ({ ...c, qty: round2(c.qty), revenue: round2(c.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
  return { ok: true, from: start, to: end, categories, summary: summarize(rows) };
}

function getStaffReport(from, to) {
  const start = String(from || fmtDate(new Date())).slice(0, 10);
  const end = String(to || start).slice(0, 10);
  const rows = fetchSales(start, end);
  const stats = new Map();
  for (const row of rows) {
    const name = String(row.waiter_name || "").trim() || "—";
    const cur = stats.get(name) || {
      operator: name,
      station: stationOf(row),
      order_count: 0,
      total: 0,
      cash: 0,
      card: 0,
    };
    const pay = cashOf(row);
    cur.order_count += 1;
    cur.total += Number(row.total) || 0;
    cur.cash += pay.cash;
    cur.card += pay.card;
    if (stationOf(row) === "recepsion") cur.station = "recepsion";
    stats.set(name, cur);
  }
  const staff = [...stats.values()]
    .map((s) => ({
      ...s,
      total: round2(s.total),
      cash: round2(s.cash),
      card: round2(s.card),
      station_label: s.station === "recepsion" ? "Recepsion" : "Kamarier",
      services: [],
    }))
    .sort((a, b) => b.total - a.total);
  const work = require("./database").listServiceWorkInRange(start, end);
  const byName = new Map(staff.map((s) => [s.operator, s]));
  for (const line of work) {
    const name = String(line.performed_by_name || "").trim();
    if (!name || line.status !== "completed") continue;
    let bucket = byName.get(name);
    if (!bucket) {
      bucket = {
        operator: name,
        station: "sherbim",
        order_count: 0,
        total: 0,
        cash: 0,
        card: 0,
        station_label: "Shërbim",
        services: [],
      };
      byName.set(name, bucket);
      staff.push(bucket);
    }
    bucket.services.push(line);
  }
  return { ok: true, from: start, to: end, staff, service_work: work, summary: summarize(rows) };
}

function getShiftsReport(from, to) {
  const start = String(from || fmtDate(new Date())).slice(0, 10);
  const end = String(to || start).slice(0, 10);
  const shifts = require("./database").listShiftReports({
    from: start,
    to: end,
    include_open: true,
  });
  return { ok: true, from: start, to: end, shifts };
}

module.exports = {
  getWeeklyReport,
  getMonthlyReport,
  getComparisonReport,
  getTrendsReport,
  getTurnoverReport,
  getStaffReport,
  getShiftsReport,
};
