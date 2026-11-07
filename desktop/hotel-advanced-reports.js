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
  const end = parseIsoDate(dateStr || fmtDate(new Date()));
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
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
  const db = require("./database");
  if (typeof db.ledgerSourceParts === "function") {
    const parts = db.ledgerSourceParts(row.receipt_number, itemsOf(row), total);
    return { restaurant: round2(parts.restaurant_gross), reception: round2(parts.reception_gross) };
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
  const shops = require("./database").shopFiguresFromDailyLogs(rows);
  return {
    order_count: rows.length,
    total: round2(total),
    cash: round2(cash),
    card: round2(card),
    waiter: round2(waiter),
    reception: round2(reception),
    shops,
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

function bareSaleName(name) {
  return String(name || "")
    .replace(/^\d+(?:[.,]\d+)?\s*[×xX]\s*/, "")
    .replace(/\(\s*(?:T\d+|POS|RS)\s*\)/gi, "")
    .replace(/\s*·.*$/, "")
    .trim();
}

function getTurnoverReport(from, to) {
  const start = String(from || fmtDate(new Date())).slice(0, 10);
  const end = String(to || start).slice(0, 10);
  const rows = fetchSales(start, end);
  const menu = sqlite().prepare(
    "SELECT id, name, category, COALESCE(stock_qty, 0) AS stock_qty FROM menu_items",
  ).all();
  const byId = new Map(menu.map((m) => [Number(m.id), m]));
  function menuRowForSale(it, name, bare) {
    const mid = Number(it.menu_item_id || it.product_id) || 0;
    if (mid && byId.get(mid)) return byId.get(mid);
    const keys = new Set(
      [name, bare].map((s) => String(s || "").trim().toLowerCase()).filter(Boolean),
    );
    const matches = menu.filter((m) => keys.has(String(m.name || "").trim().toLowerCase()));
    if (matches.length === 1) return matches[0];
    if (!matches.length) return null;
    const raw = `${name} ${bare}`;
    const mini = matches.filter((m) => String(m.category || "").trim().toLowerCase() === "minibar");
    const other = matches.filter((m) => String(m.category || "").trim().toLowerCase() !== "minibar");
    if (/\bminibar\b/i.test(raw) && mini.length) return mini[0];
    if (other.length) return other[0];
    return mini[0] || matches[0];
  }
  const cats = new Map();
  const products = new Map();
  for (const row of rows) {
    for (const it of itemsOf(row)) {
      const name = String(it.name || "").trim();
      if (!name) continue;
      const storedQty = Number(it.quantity ?? it.qty) || 1;
      const prefix = name.match(/^(\d+(?:[.,]\d+)?)\s*[×xX]\s*/);
      const prefixQty = prefix ? Number(String(prefix[1]).replace(",", ".")) : 0;
      const qty = prefixQty > 0 && storedQty === 1 ? prefixQty : storedQty;
      const rev = storedQty * (Number(it.price) || 0);
      const bare = bareSaleName(name);
      const menuRow = menuRowForSale(it, name, bare);
      const cat = menuRow?.category || "Të tjera";
      const stock = menuRow ? Number(menuRow.stock_qty) || 0 : null;
      const pkey = menuRow ? `id:${menuRow.id}` : `name:${(bare || name).toLowerCase()}`;
      const prod = products.get(pkey) || {
        name: menuRow?.name || name,
        category: cat,
        qty: 0,
        revenue: 0,
        stock_qty: stock,
      };
      prod.qty += qty;
      prod.revenue += rev;
      products.set(pkey, prod);
      const cur = cats.get(cat) || { category: cat, qty: 0, revenue: 0, stock_qty: 0, seen: new Set() };
      cur.qty += qty;
      cur.revenue += rev;
      if (menuRow && !cur.seen.has(Number(menuRow.id))) {
        cur.seen.add(Number(menuRow.id));
        cur.stock_qty += Number(menuRow.stock_qty) || 0;
      }
      cats.set(cat, cur);
    }
  }
  const productRows = [...products.values()]
    .map((p) => ({
      name: p.name,
      category: p.category,
      qty: round2(p.qty),
      revenue: round2(p.revenue),
      stock_qty: p.stock_qty,
    }))
    .sort((a, b) => b.revenue - a.revenue || String(a.name).localeCompare(String(b.name), "sq"));
  const categories = [...cats.values()]
    .map((c) => ({
      category: c.category,
      qty: round2(c.qty),
      revenue: round2(c.revenue),
      stock_qty: round2(c.stock_qty),
    }))
    .sort((a, b) => b.revenue - a.revenue);
  return { ok: true, from: start, to: end, categories, products: productRows, summary: summarize(rows) };
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
      services_total: 0,
      paid_to_restaurant: 0,
    };
    const pay = cashOf(row);
    let cashPart = pay.cash;
    let cardPart = pay.card;
    let totalPart = Number(row.total) || 0;
    if (stationOf(row) === "recepsion") {
      const food = moneyParts(row).restaurant;
      if (food) {
        const base = cashPart + cardPart;
        const cutCash = base ? round2(food * (cashPart / base)) : 0;
        cashPart = round2(cashPart - cutCash);
        cardPart = round2(cardPart - round2(food - cutCash));
        totalPart = round2(totalPart - food);
        cur.paid_to_restaurant += food;
      }
    }
    cur.order_count += 1;
    cur.total += totalPart;
    cur.cash += cashPart;
    cur.card += cardPart;
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
      shop: s.station === "recepsion" || s.station === "sherbim" ? "Recepsion" : "Restorant",
      paid_to_restaurant: round2(s.paid_to_restaurant || 0),
      services_total: round2(s.services_total || 0),
      services: [],
    }))
    .sort((a, b) => b.total - a.total);
  const work = require("./database").listServiceWorkInRange(start, end);
  const byName = new Map(staff.map((s) => [s.operator, s]));
  for (const line of work) {
    const name = String(line.performed_by_name || "").trim();
    if (!name || line.status !== "completed" || !line.hotel_service) continue;
    let bucket = byName.get(name);
    if (!bucket) {
      bucket = {
        operator: name,
        station: "sherbim",
        order_count: 0,
        total: 0,
        cash: 0,
        card: 0,
        services_total: 0,
        station_label: "Shërbim",
        shop: "Recepsion",
        paid_to_restaurant: 0,
        services: [],
      };
      byName.set(name, bucket);
      staff.push(bucket);
    }
    bucket.services.push(line);
    bucket.services_total = round2((Number(bucket.services_total) || 0) + (Number(line.amount) || 0));
  }
  const roomByName = new Map();
  const shifts = require("./database").listShiftReports({ from: start, to: end, include_open: true });
  for (const sh of shifts || []) {
    const name = String(sh.waiter_name || "").trim();
    if (!name) continue;
    roomByName.set(name, round2((roomByName.get(name) || 0) + (Number(sh.room_total) || 0)));
  }
  for (const s of staff) {
    s.room = round2(roomByName.get(s.operator) || 0);
    s.activity_total = round2((Number(s.cash) || 0) + (Number(s.card) || 0) + s.room);
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
