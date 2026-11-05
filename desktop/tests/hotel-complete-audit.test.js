"use strict";

const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cents(n) {
  return Math.round((Number(n) || 0) * 100);
}

function same(a, b) {
  return cents(a) === cents(b);
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ensureCat(db, name, route) {
  const row = db.db.prepare("SELECT id FROM categories WHERE name = ?").get(name);
  if (!row) db.addCategory(name, route);
}

function ensureService(db, name, price) {
  const row = db.db.prepare("SELECT id FROM services WHERE lower(name) = lower(?)").get(name);
  if (row) {
    db.db.prepare("UPDATE services SET price = ? WHERE id = ?").run(price, row.id);
    return { id: row.id };
  }
  return db.createHotelService({ name, price, vat_category: "18" });
}

function boot(tag) {
  const dbPath = path.join(os.tmpdir(), `hotel-complete-${tag}-${process.pid}-${Date.now()}.db`);
  if (!dbPath.startsWith(os.tmpdir())) throw new Error("DB jo ne tmp");
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  const db = require("../database.js");
  const advanced = require("../hotel-advanced-reports.js");
  return db.whenReady().then(() => {
    db.runSetup({ restaurant_name: `Audit ${tag}`, admin_password: "1234", table_count: 12 });
    const day = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
    return { db, advanced, day, dbPath };
  });
}

function qtyOf(db, id) {
  return Number(db.db.prepare("SELECT COALESCE(stock_qty,0) AS q FROM menu_items WHERE id = ?").get(id)?.q) || 0;
}

function stockMap(db, ids) {
  const out = {};
  for (const [name, id] of Object.entries(ids)) out[name] = qtyOf(db, id);
  return out;
}

function tableByNumber(db, n) {
  const row = db.db.prepare("SELECT id, number FROM tables WHERE number = ?").get(n);
  if (!row) throw new Error(`Tavolina ${n} mungon`);
  return row;
}

function roomByNumber(db, n) {
  const row = db.db.prepare("SELECT id, room_number, status, price_per_night FROM rooms WHERE room_number = ?").get(String(n));
  if (!row) throw new Error(`Dhoma ${n} mungon`);
  return row;
}

function item(id, name, price, qty = 1) {
  return { name, menu_item_id: id, quantity: qty, price };
}

function sell(db, table, waiter, items, method) {
  db.sendOrder({ table_id: table.id, waiter_name: waiter, items });
  const closed = db.closeTable(table.id, waiter, false, method);
  return closed;
}

function books(db, advanced, from, to) {
  const dit = db.getDitari({ dateFrom: from, dateTo: to });
  const led = db.getSalesLedger({ from, to });
  const week = advanced.getWeeklyReport(to);
  const month = advanced.getMonthlyReport(String(to).slice(0, 7));
  let rest = 0;
  let rec = 0;
  let ledTotal = 0;
  for (const row of led) {
    ledTotal += Number(row.total) || 0;
    rest += Number(row.restaurant_gross) || 0;
    rec += Number(row.reception_gross) || 0;
  }
  return {
    ditari: {
      restaurant: money(dit.restaurantSales),
      reception: money(dit.receptionSales),
      total: money(dit.totalSales),
      sum_parts: money((Number(dit.restaurantSales) || 0) + (Number(dit.receptionSales) || 0)),
      unpaid: money(dit.active_unpaid_total || 0),
      receipts: (dit.entries || []).map((e) => ({
        receipt: e.receipt_number,
        total: money(e.total),
        pay: e.payment_method,
      })),
    },
    kontabilisti: {
      restaurant: money(rest),
      reception: money(rec),
      total: money(ledTotal),
      sum_parts: money(rest + rec),
      rows: led.map((r) => ({
        receipt: r.receipt_number,
        total: money(r.total),
        restaurant: money(r.restaurant_gross),
        reception: money(r.reception_gross),
      })),
    },
    javore: {
      restaurant: money(week.summary?.waiter),
      reception: money(week.summary?.reception),
      total: money(week.summary?.total),
      sum_parts: money((Number(week.summary?.waiter) || 0) + (Number(week.summary?.reception) || 0)),
    },
    mujore: {
      total: money(month.summary?.total),
      restaurant: money(month.summary?.waiter),
      reception: money(month.summary?.reception),
    },
  };
}

function flagDiff(flags, name, a, b) {
  if (!same(a, b)) flags.push({ check: name, a: money(a), b: money(b), delta: money((Number(a) || 0) - (Number(b) || 0)) });
}

function partsMatch(flags, label, block) {
  flagDiff(flags, `${label} restorant+recepsion = total`, block.sum_parts, block.total);
}

async function scenarioA() {
  const { db, advanced, day, dbPath } = await boot("A");
  const flags = [];
  ensureCat(db, "Ushqim", "kitchen");
  ensureCat(db, "Pije", "bar");
  const ids = {
    Biftek: db.addMenuItem({ name: "Biftek", category: "Ushqim", price: 9, vat_category: "18", stock_qty: 20 }),
    Kafe: db.addMenuItem({ name: "Kafe", category: "Pije", price: 2.5, vat_category: "18", stock_qty: 20 }),
    Birra: db.addMenuItem({ name: "Birra", category: "Pije", price: 3, vat_category: "18", stock_qty: 20 }),
    Pasta: db.addMenuItem({ name: "Pasta", category: "Ushqim", price: 8, vat_category: "18", stock_qty: 20 }),
    Sallate: db.addMenuItem({ name: "Sallatë", category: "Ushqim", price: 4, vat_category: "18", stock_qty: 20 }),
  };
  const kam = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier A', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(kam, 0);
  const waiter = "Kamarier A";
  const t = [1, 2, 3, 4, 5].map((n) => tableByNumber(db, n));
  sell(db, t[0], waiter, [item(ids.Biftek, "Biftek", 9)], "cash");
  sell(db, t[1], waiter, [item(ids.Biftek, "Biftek", 9)], "cash");
  sell(db, t[2], waiter, [item(ids.Biftek, "Biftek", 9)], "karte");
  const afterBiftek3 = qtyOf(db, ids.Biftek);
  for (let i = 0; i < 5; i++) sell(db, t[i % 5], waiter, [item(ids.Kafe, "Kafe", 2.5)], "cash");
  const afterKafe5 = qtyOf(db, ids.Kafe);
  const purchase = db.createPurchaseInvoice({
    supplier: "Furnitor A",
    invoice_number: "BL-A-1",
    invoice_date: day,
    vat_rate: 18,
    items: [
      { menu_item_id: ids.Biftek, quantity: 10, unit_price: 4, vat_rate: 18 },
      { menu_item_id: ids.Kafe, quantity: 5, unit_price: 1, vat_rate: 18 },
    ],
  });
  const afterPurchase = { Biftek: qtyOf(db, ids.Biftek), Kafe: qtyOf(db, ids.Kafe) };
  sell(db, t[0], waiter, [item(ids.Biftek, "Biftek", 9)], "cash");
  sell(db, t[1], waiter, [item(ids.Biftek, "Biftek", 9)], "cash");
  const stock = stockMap(db, ids);
  const bil = db.getKontabilistiBilanc({ from: day, to: day });
  const rep = books(db, advanced, day, day);
  const turn = advanced.getTurnoverReport(day, day);
  const sqlSum = db.db.prepare("SELECT ROUND(COALESCE(SUM(total),0),2) AS s, COUNT(*) AS n FROM daily_log WHERE status = 'completed'").get();
  if (afterBiftek3 !== 17) flags.push({ check: "stok Biftek pas 3 shitjeve", actual: afterBiftek3, expected: 17 });
  if (afterKafe5 !== 15) flags.push({ check: "stok Kafe pas 5 shitjeve", actual: afterKafe5, expected: 15 });
  if (afterPurchase.Biftek !== 27) flags.push({ check: "stok Biftek pas blerjes", actual: afterPurchase.Biftek, expected: 27 });
  if (afterPurchase.Kafe !== 20) flags.push({ check: "stok Kafe pas blerjes", actual: afterPurchase.Kafe, expected: 20 });
  if (stock.Biftek !== 25) flags.push({ check: "stok Biftek pas 2 shitjeve te tjera", actual: stock.Biftek, expected: 25 });
  flagDiff(flags, "Ditari = Kontabilisti", rep.ditari.total, rep.kontabilisti.total);
  flagDiff(flags, "Ditari = Javore", rep.ditari.total, rep.javore.total);
  flagDiff(flags, "bilanc.sales_total neto = Ditari bruto", bil.sales_total, rep.ditari.total);
  partsMatch(flags, "Ditari", rep.ditari);
  partsMatch(flags, "Kontabilisti", rep.kontabilisti);
  partsMatch(flags, "Javore", rep.javore);
  const purchaseGross = money(purchase?.total);
  const inExpenses = Number(bil.expenses_total) > 0.001;
  if (!inExpenses) {
    flags.push({
      check: "blerja te shpenzimet e Kontabilistit",
      actual: { expenses_total: money(bil.expenses_total), purchases_total: money(bil.purchases_total), invoice_total: purchaseGross },
      note: "blerja NUK eshte te shpenzimet",
    });
  }
  if (!(Number(bil.purchases_total) > 0.001)) {
    flags.push({ check: "blerja te libri i blerjes", actual: money(bil.purchases_total), invoice_total: purchaseGross });
  }
  const turnRows = (turn.products && turn.products.length) ? turn.products : (turn.categories || []);
  const turnHasStock = turnRows.some((c) => c.stock_qty != null);
  if (!turnHasStock) {
    flags.push({
      check: "Qarkullimi tregon levizjen e stokut",
      actual: turnRows,
      note: "Qarkullimi kthen sasi te shitur dhe te ardhura, jo stokun",
    });
  }
  flagDiff(flags, "SUM daily_log = Ditari", sqlSum.s, rep.ditari.total);
  const out = {
    scenario: "A",
    db: dbPath,
    day,
    stock_pas_3_biftek: afterBiftek3,
    stock_pas_5_kafe: afterKafe5,
    stock_pas_blerjes: afterPurchase,
    stock_final: stock,
    shitje: rep,
    sql_daily_log: sqlSum,
    blerja: {
      id: purchase?.id || null,
      total: purchaseGross,
      bilanc_purchases_total: money(bil.purchases_total),
      bilanc_expenses_total: money(bil.expenses_total),
      bilanc_sales_total: money(bil.sales_total),
    },
    qarkullimi: turnRows,
    qarkullimi_summary: turn.summary,
    flags,
  };
  console.log(JSON.stringify(out, null, 2));
  if (flags.length) process.exitCode = 1;
}

async function scenarioB() {
  const { db, advanced, day, dbPath } = await boot("B");
  const flags = [];
  ensureCat(db, "Ushqim", "kitchen");
  ensureCat(db, "Pije", "bar");
  ensureCat(db, "Minibar", "bar");
  const ids = {
    Biftek: db.addMenuItem({ name: "Biftek", category: "Ushqim", price: 9, vat_category: "18", stock_qty: 20 }),
    Kafe: db.addMenuItem({ name: "Kafe", category: "Pije", price: 2.5, vat_category: "18", stock_qty: 20 }),
    Birra: db.addMenuItem({ name: "Birra", category: "Pije", price: 3, vat_category: "18", stock_qty: 20 }),
    Pasta: db.addMenuItem({ name: "Pasta", category: "Ushqim", price: 8, vat_category: "18", stock_qty: 20 }),
    Sallate: db.addMenuItem({ name: "Sallatë", category: "Ushqim", price: 4, vat_category: "18", stock_qty: 20 }),
    Coca: db.addMenuItem({ name: "Coca-Cola", category: "Minibar", price: 1.5, vat_category: "18", stock_qty: 20 }),
  };
  const pastrim = ensureService(db, "Pastrim", 12);
  const pishine = ensureService(db, "Pishinë", 10);
  const masazh = ensureService(db, "Masazh", 20);
  const spa = ensureService(db, "Spa", 25);
  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep B', 'recepsion', '1919', 1)",
  ).run().lastInsertRowid;
  const kamId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier B', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  const arbenId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Arben', 'recepsion', '1717', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 100);
  db.openWaiterShiftWithCash(kamId, 50);
  const waiter = "Kamarier B";
  const recep = "Recep B";
  const r101 = roomByNumber(db, "101");
  const r102 = roomByNumber(db, "102");
  const r201 = roomByNumber(db, "201");
  db.db.prepare("UPDATE rooms SET price_per_night = 50, status = 'free' WHERE id = ?").run(r101.id);
  db.db.prepare("UPDATE rooms SET price_per_night = 80, status = 'free' WHERE id = ?").run(r102.id);
  db.db.prepare("UPDATE rooms SET price_per_night = 40, status = 'free' WHERE id = ?").run(r201.id);
  const g101 = db.checkInGuest({
    room_id: r101.id, guest_name: "Mysafir 101", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 2), deposit: 0,
  }).guest;
  const g102 = db.checkInGuest({
    room_id: r102.id, guest_name: "Mysafir 102", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 1), deposit: 0,
  }).guest;
  const g201 = db.checkInGuest({
    room_id: r201.id, guest_name: "Mysafir 201", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 3), deposit: 0,
  }).guest;

  const rs = db.submitGuestRoomMenuOrder("101", [
    item(ids.Biftek, "Biftek", 9),
    item(ids.Kafe, "Kafe", 2.5),
  ]);
  const rsPending = db.listPendingCloudOrders().find((o) => o.id === rs.order_id);
  const rsImp = db.importCloudOrderToLocal(rsPending, waiter, { fromAcceptFlow: true });
  db.removePendingCloudOrders([rs.order_id]);
  if (rsImp?.table_id) {
    db.chargeTableToRoomAtomic({
      tableId: rsImp.table_id, waiterName: waiter, guestId: g101.id, roomId: r101.id, tableNumber: rsImp.table_number,
    });
  }
  const mini = db.submitGuestRoomMenuOrder("101", [
    { name: "Coca-Cola", quantity: 1, price: 1.5, category: "Minibar", menu_item_id: ids.Coca },
  ]);
  const miniPending = db.listPendingCloudOrders().find((o) => o.id === mini.order_id);
  db.tryApplyCloudRoomMenuOrder(miniPending, { id: recepId, name: recep });
  db.removePendingCloudOrders([mini.order_id]);
  const clean = db.submitGuestRoomServiceOrder("101", [{ service_id: pastrim.id, quantity: 1 }]);
  const cleanPending = db.listPendingCloudOrders().find((o) => o.id === clean.order_id);
  db.applyGuestHotelServiceOrder(cleanPending, { id: arbenId, name: "Arben" });
  db.removePendingCloudOrders([clean.order_id]);

  const t4 = tableByNumber(db, 4);
  db.sendOrder({
    table_id: t4.id,
    waiter_name: waiter,
    items: [item(ids.Pasta, "Pasta", 8), item(ids.Birra, "Birra", 3)],
  });
  db.chargeTableToRoomAtomic({
    tableId: t4.id, waiterName: waiter, guestId: g102.id, roomId: r102.id, tableNumber: t4.number,
  });

  const spaOrder = db.submitGuestRoomServiceOrder("201", [{ service_id: spa.id, quantity: 1 }]);
  const spaPending = db.listPendingCloudOrders().find((o) => o.id === spaOrder.order_id);
  db.applyGuestHotelServiceOrder(spaPending, { id: recepId, name: recep });
  db.removePendingCloudOrders([spaOrder.order_id]);

  sell(db, tableByNumber(db, 1), waiter, [
    item(ids.Pasta, "Pasta", 8), item(ids.Birra, "Birra", 3), item(ids.Sallate, "Sallatë", 4),
  ], "cash");
  sell(db, tableByNumber(db, 2), waiter, [
    item(ids.Biftek, "Biftek", 9), item(ids.Birra, "Birra", 3),
  ], "karte");
  sell(db, tableByNumber(db, 3), waiter, [item(ids.Pasta, "Pasta", 8)], "cash");
  const take = db.submitGuestPublicMenuOrder({
    order_kind: "takeaway",
    customer_name: "Take B",
    items: [item(ids.Sallate, "Sallatë", 4), item(ids.Birra, "Birra", 3)],
  });
  const takePending = db.listPendingCloudOrders().find((o) => o.id === take.order_id);
  const takeImp = db.importCloudOrderToLocal(takePending, waiter, { fromAcceptFlow: true });
  if (takeImp?.table_id) db.closeTable(takeImp.table_id, waiter, false, "karte");
  db.removePendingCloudOrders([take.order_id]);

  const walk = db.openWalkInClient({ client_name: "Klient B", phone: "044000000" });
  db.addWalkInService(walk.id, pishine.id, { quantity: 1, performer: { id: recepId, name: recep } });
  db.addWalkInService(walk.id, masazh.id, { quantity: 1, performer: { id: recepId, name: recep } });
  for (const line of db.getWalkInClient(walk.id).lines || []) db.setWalkInLineStatus(line.id, "done", recep);
  const walkPay = db.payWalkInClient(walk.id, { waiter_name: recep, payment_method: "cash" });

  const preview = {
    101: db.getCheckoutPreview(r101.id).bill,
    102: db.getCheckoutPreview(r102.id).bill,
    201: db.getCheckoutPreview(r201.id).bill,
  };
  const out101 = db.checkOutGuest(r101.id, { waiter_name: recep, payment_method: "cash" });
  const out102 = db.checkOutGuest(r102.id, { waiter_name: recep, payment_method: "cash" });
  const out201 = db.checkOutGuest(r201.id, { waiter_name: recep, payment_method: "cash" });

  const sumW = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  const sumR = db.getWaiterShiftSummary(recepId, { sessionRole: "recepsion" });
  const closedW = db.closeWaiterShift(kamId, sumW.expected_closing_cash, 0, { sessionRole: "kamarier" });
  const closedR = db.closeWaiterShift(recepId, sumR.expected_closing_cash, 0, { sessionRole: "recepsion" });
  const rep = books(db, advanced, day, day);
  const staff = advanced.getStaffReport(day, day);
  const shifts = advanced.getShiftsReport(day, day);
  const diary = db.listHotelDiary({});
  const stock = stockMap(db, ids);
  const sqlSum = db.db.prepare("SELECT ROUND(COALESCE(SUM(total),0),2) AS s, COUNT(*) AS n FROM daily_log WHERE status = 'completed'").get();
  const totals = [rep.ditari.total, rep.kontabilisti.total, rep.javore.total, rep.mujore.total];
  for (let i = 1; i < totals.length; i++) flagDiff(flags, "te gjitha raportet kane te njejtin total", totals[0], totals[i]);
  partsMatch(flags, "Ditari", rep.ditari);
  partsMatch(flags, "Kontabilisti", rep.kontabilisti);
  partsMatch(flags, "Javore", rep.javore);
  flagDiff(flags, "stafi.summary = Ditari", staff.summary?.total, rep.ditari.total);
  flagDiff(flags, "SUM daily_log = Ditari", sqlSum.s, rep.ditari.total);
  const waiterActivity = money((Number(sumW.cash_total) || 0) + (Number(sumW.card_total) || 0) + (Number(sumW.room_total) || 0));
  const out = {
    scenario: "B",
    db: dbPath,
    day,
    foliot: {
      101: { preview: money(preview[101].total), checkout: money(out101.bill?.total), charges: money(out101.bill?.charges_total), room: money(out101.bill?.room_total) },
      102: { preview: money(preview[102].total), checkout: money(out102.bill?.total), charges: money(out102.bill?.charges_total), room: money(out102.bill?.room_total) },
      201: { preview: money(preview[201].total), checkout: money(out201.bill?.total), charges: money(out201.bill?.charges_total), room: money(out201.bill?.room_total) },
    },
    walkin: { receipt: walkPay.receipt_number, total: money(walkPay.total), status: walkPay.client?.status },
    ditari: rep.ditari,
    kontabilisti: rep.kontabilisti,
    javore: rep.javore,
    mujore: rep.mujore,
    punonjesit: (staff.staff || []).map((s) => ({
      name: s.operator,
      total: money(s.total),
      shitje_totale: money(s.activity_total),
      cash: money(s.cash),
      card: money(s.card),
      room: money(s.room),
      services: money(s.services_total),
      station: s.station_label,
    })),
    stafi_summary: money(staff.summary?.total),
    nderrimet: (shifts.shifts || []).map((s) => ({
      name: s.waiter_name,
      role: s.staff_role,
      opened: s.opened_at,
      closed: s.closed_at,
      shitje: money(s.total_sales),
      cash: money(s.cash_sales_total),
      card: money(s.card_sales_total),
      room: money(s.room_total),
      shitje_totale: money((Number(s.cash_sales_total) || 0) + (Number(s.card_sales_total) || 0) + (Number(s.room_total) || 0)),
      open: !!s.is_open,
    })),
    ditari_hoteli_ngjarje: diary.length,
    ditari_hoteli_llojet: diary.reduce((m, r) => {
      const k = r.event_type || "";
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {}),
    kamarieri: {
      cash: money(sumW.cash_total),
      card: money(sumW.card_total),
      ne_dhoma: money(sumW.room_total),
      shitje: money(sumW.total_sales),
      shitje_totale: waiterActivity,
      mbyllje_cash: money(closedW.cash_total),
      mbyllje_card: money(closedW.card_total),
      mbyllje_room: money(closedW.room_total),
      mbyllje_shitje: money(closedW.total_sales),
      diferenca: money(closedW.cash_difference),
    },
    recepsioni: {
      cash: money(sumR.cash_total),
      card: money(sumR.card_total),
      total: money(sumR.total_sales),
      ne_dhoma: money(sumR.room_total),
      mbyllje_cash: money(closedR.cash_total),
      mbyllje_total: money(closedR.total_sales),
      diferenca: money(closedR.cash_difference),
    },
    stock,
    sql_daily_log: sqlSum,
    flags,
  };
  console.log(JSON.stringify(out, null, 2));
  if (flags.length) process.exitCode = 1;
}

async function scenarioC() {
  const { db, day, dbPath } = await boot("C");
  const flags = [];
  ensureCat(db, "Pije", "bar");
  const zeroId = db.addMenuItem({ name: "Zero Stok", category: "Pije", price: 1, vat_category: "18", stock_qty: 0, low_stock_threshold: 0 });
  const expId = db.addMenuItem({ name: "Skaduar", category: "Pije", price: 1, vat_category: "18", stock_qty: 5, low_stock_threshold: 0 });
  const kamId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier C', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep C', 'recepsion', '1919', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(kamId, 0);
  db.openWaiterShiftWithCash(recepId, 0);
  const waiter = "Kamarier C";
  const recep = "Recep C";
  const warned = db.getLowStockItems().some((r) => r.name === "Zero Stok");
  let zeroClosed = null;
  let zeroErr = null;
  try {
    zeroClosed = sell(db, tableByNumber(db, 1), waiter, [item(zeroId, "Zero Stok", 1)], "cash");
  } catch (e) {
    zeroErr = e.message;
  }
  const zeroAfter = qtyOf(db, zeroId);
  const ago = addDays(day, -3);
  db.updateMenuItem(expId, { expiry_date: ago });
  const expRow = db.getExpiringMenuItems().find((r) => r.name === "Skaduar") || null;
  let expClosed = null;
  let expErr = null;
  try {
    expClosed = sell(db, tableByNumber(db, 2), waiter, [item(expId, "Skaduar", 1)], "cash");
  } catch (e) {
    expErr = e.message;
  }
  const expAfter = qtyOf(db, expId);
  const empty = db.openWalkInClient({ client_name: "Pa sherbime" });
  const zeroPay = db.payWalkInClient(empty.id, { waiter_name: recep });
  const zeroClient = db.getWalkInClient(empty.id);
  if (zeroPay.message !== "Llogaria u mbyll pa pagesë" || zeroClient?.status !== "closed" || money(zeroPay.total) !== 0) {
    flags.push({ check: "walk-in 0 sherbime mbyllet", actual: { message: zeroPay.message, status: zeroClient?.status, total: money(zeroPay.total) } });
  }

  const room = roomByNumber(db, "103");
  db.db.prepare("UPDATE rooms SET price_per_night = 40, status = 'free' WHERE id = ?").run(room.id);
  const stay = db.checkInGuest({
    room_id: room.id, guest_name: "Harroi Dhomen", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 1), deposit: 0,
  });
  const kafe = db.addMenuItem({ name: "Kafe C", category: "Pije", price: 2.5, vat_category: "18", stock_qty: 5 });
  const forgotten = db.submitGuestRoomMenuOrder("103", [item(kafe, "Kafe C", 2.5)]);
  const forgottenPending = db.listPendingCloudOrders().find((o) => o.id === forgotten.order_id);
  db.importCloudOrderToLocal(forgottenPending, waiter, { fromAcceptFlow: true });
  db.removePendingCloudOrders([forgotten.order_id]);
  const closedForgot = db.checkOutGuest(room.id, { waiter_name: recep, payment_method: "cash" });
  const charged = (closedForgot.bill?.charges || []).some((c) => String(c.description || "").includes("Kafe"));
  if (!charged || !closedForgot.room_service_warning) {
    flags.push({
      check: "check-out faturon Room Service te harruar",
      actual: { warning: closedForgot.room_service_warning || "", charged, total: money(closedForgot.bill?.total) },
    });
  }

  const room2 = roomByNumber(db, "104");
  db.db.prepare("UPDATE rooms SET price_per_night = 30, status = 'free' WHERE id = ?").run(room2.id);
  db.checkInGuest({
    room_id: room2.id, guest_name: "I pari", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 1), deposit: 0,
  });
  let secondErr = null;
  let secondOk = false;
  try {
    db.checkInGuest({
      room_id: room2.id, guest_name: "I dyti", persons: 1,
      check_in_date: day, check_out_date: addDays(day, 1), deposit: 0,
    });
    secondOk = true;
  } catch (e) {
    secondErr = e.message;
  }
  if (secondOk) flags.push({ check: "check-in i dyfishte i bllokuar", actual: "u lejua" });

  const room0 = roomByNumber(db, "105");
  db.db.prepare("UPDATE rooms SET price_per_night = 0, status = 'free' WHERE id = ?").run(room0.id);
  const g0 = db.checkInGuest({
    room_id: room0.id, guest_name: "Folio Zero", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 1), deposit: 0,
  });
  let zeroOut = null;
  let zeroOutErr = null;
  try {
    zeroOut = db.checkOutGuest(room0.id, { waiter_name: recep, payment_method: "cash" });
  } catch (e) {
    zeroOutErr = e.message;
  }
  const guest0 = db.db.prepare("SELECT status, total_paid FROM guests WHERE id = ?").get(g0.guest.id);
  if (zeroOutErr || guest0?.status !== "checked_out" || money(zeroOut?.bill?.total) !== 0) {
    flags.push({
      check: "check-out 0€",
      actual: { error: zeroOutErr, status: guest0?.status, total: money(zeroOut?.bill?.total), paid: guest0?.total_paid },
    });
  }

  const out = {
    scenario: "C",
    db: dbPath,
    day,
    stok_zero: {
      warned,
      u_mbyll: !!zeroClosed,
      error: zeroErr,
      stock_pas: zeroAfter,
    },
    skaduar: {
      expiry_date: expRow?.expiry_date || null,
      expired: expRow ? !!expRow.expired : false,
      ne_liste: !!expRow,
      u_mbyll: !!expClosed,
      error: expErr,
      stock_pas: expAfter,
    },
    walkin_zero: {
      message: zeroPay.message,
      total: money(zeroPay.total),
      status: zeroClient?.status,
      receipt: zeroPay.receipt_number,
    },
    room_service_harruar: {
      warning: closedForgot.room_service_warning || "",
      auto: closedForgot.room_service_auto_charged || [],
      folio: money(closedForgot.bill?.total),
      charges: money(closedForgot.bill?.charges_total),
      room: money(closedForgot.bill?.room_total),
    },
    checkin_dyfish: { u_lejua: secondOk, error: secondErr },
    checkout_zero: {
      error: zeroOutErr,
      status: guest0?.status,
      total: money(zeroOut?.bill?.total),
      total_paid: guest0?.total_paid,
    },
    flags,
  };
  console.log(JSON.stringify(out, null, 2));
  if (flags.length) process.exitCode = 1;
}

async function scenarioD() {
  const { db, advanced, day, dbPath } = await boot("D");
  const flags = [];
  const d3 = day;
  const d2 = addDays(day, -1);
  const d1 = addDays(day, -2);
  ensureCat(db, "Ushqim", "kitchen");
  const prod = db.addMenuItem({ name: "Shitje Dite", category: "Ushqim", price: 50, vat_category: "18", stock_qty: 50 });
  const kamId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier D', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  const waiter = "Kamarier D";
  const room = roomByNumber(db, "106");
  db.db.prepare("UPDATE rooms SET price_per_night = 0, status = 'free' WHERE id = ?").run(room.id);

  function maxLog() {
    return Number(db.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM daily_log").get().id) || 0;
  }
  function stamp(since, ymdDay, shiftId) {
    db.db.prepare("UPDATE daily_log SET date = ? WHERE id > ?").run(ymdDay, since);
    db.db.prepare("UPDATE waiter_shifts SET opened_at = ?, closed_at = ? WHERE id = ?").run(
      `${ymdDay}T08:00:00`,
      `${ymdDay}T18:00:00`,
      shiftId,
    );
  }

  const mark1 = maxLog();
  db.openWaiterShiftWithCash(kamId, 0);
  const shift1 = db.db.prepare("SELECT id FROM waiter_shifts WHERE staff_id = ? AND closed_at IS NULL").get(kamId).id;
  sell(db, tableByNumber(db, 1), waiter, [item(prod, "Shitje Dite", 50)], "cash");
  const sum1 = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  db.closeWaiterShift(kamId, sum1.expected_closing_cash, 0, { sessionRole: "kamarier" });
  stamp(mark1, d1, shift1);

  const mark2 = maxLog();
  db.openWaiterShiftWithCash(kamId, 0);
  const shift2 = db.db.prepare("SELECT id FROM waiter_shifts WHERE staff_id = ? AND closed_at IS NULL").get(kamId).id;
  sell(db, tableByNumber(db, 2), waiter, [item(prod, "Shitje Dite", 30)], "cash");
  const guest = db.checkInGuest({
    room_id: room.id, guest_name: "Mysafir D", persons: 1,
    check_in_date: d2, check_out_date: d3, deposit: 0,
  }).guest;
  const t3 = tableByNumber(db, 3);
  db.sendOrder({ table_id: t3.id, waiter_name: waiter, items: [item(prod, "Shitje Dite", 20)] });
  db.chargeTableToRoomAtomic({
    tableId: t3.id, waiterName: waiter, guestId: guest.id, roomId: room.id, tableNumber: t3.number,
  });
  const sum2 = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  db.closeWaiterShift(kamId, sum2.expected_closing_cash, 0, { sessionRole: "kamarier" });
  stamp(mark2, d2, shift2);

  const mark3 = maxLog();
  db.openWaiterShiftWithCash(kamId, 0);
  const shift3 = db.db.prepare("SELECT id FROM waiter_shifts WHERE staff_id = ? AND closed_at IS NULL").get(kamId).id;
  const closedGuest = db.checkOutGuest(room.id, { waiter_name: waiter, payment_method: "cash", check_out_date: d3 });
  const sum3 = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  db.closeWaiterShift(kamId, sum3.expected_closing_cash, 0, { sessionRole: "kamarier" });
  stamp(mark3, d3, shift3);

  const b1 = books(db, advanced, d1, d1);
  const b2 = books(db, advanced, d2, d2);
  const b3 = books(db, advanced, d3, d3);
  const month = advanced.getMonthlyReport(String(d3).slice(0, 7));
  const shifts = advanced.getShiftsReport(d1, d3);
  const sumDays = money(b1.ditari.total + b2.ditari.total + b3.ditari.total);
  flagDiff(flags, "mujore = shuma e 3 diteve te Ditarit", month.summary?.total, sumDays);
  for (const [label, block] of [["d1", b1], ["d2", b2], ["d3", b3]]) {
    const foreign = (block.ditari.receipts || []).filter((r) => {
      const row = db.db.prepare("SELECT date FROM daily_log WHERE receipt_number IS ? AND ROUND(total,2) = ROUND(?,2)").get(r.receipt, r.total);
      return row && String(row.date).slice(0, 10) !== { d1, d2, d3 }[label];
    });
    if (foreign.length) flags.push({ check: `${label} ka kupon jashte dites`, actual: foreign });
  }
  const byDayTotal = { [d1]: b1.ditari.total, [d2]: b2.ditari.total, [d3]: b3.ditari.total };
  for (const s of shifts.shifts || []) {
    const closedDay = String(s.closed_at || "").slice(0, 10);
    if (byDayTotal[closedDay] == null) continue;
    flagDiff(flags, `nderrimi ${closedDay} shitje = ditari i dites`, s.total_sales, byDayTotal[closedDay]);
  }
  const shiftDays = (shifts.shifts || []).map((s) => String(s.closed_at || "").slice(0, 10));
  const wantDays = [d1, d2, d3].slice().sort();
  const gotDays = shiftDays.slice().sort();
  if (gotDays.length !== 3 || gotDays.join() !== wantDays.join()) {
    flags.push({ check: "3 nderrime ne 3 data", actual: (shifts.shifts || []).map((s) => ({ closed: s.closed_at, sales: money(s.total_sales), cash: money(s.cash_sales_total), room: money(s.room_total) })), expected_days: wantDays });
  }
  const out = {
    scenario: "D",
    db: dbPath,
    days: { d1, d2, d3 },
    checkout: { total: money(closedGuest.bill?.total), room: money(closedGuest.bill?.room_total), charges: money(closedGuest.bill?.charges_total) },
    ditari: {
      d1: b1.ditari,
      d2: b2.ditari,
      d3: b3.ditari,
      shuma: sumDays,
    },
    kontabilisti: { d1: b1.kontabilisti.total, d2: b2.kontabilisti.total, d3: b3.kontabilisti.total },
    mujore: money(month.summary?.total),
    nderrimet: (shifts.shifts || []).map((s) => ({
      name: s.waiter_name,
      opened: s.opened_at,
      closed: s.closed_at,
      shitje: money(s.total_sales),
      cash: money(s.cash_sales_total),
      card: money(s.card_sales_total),
      room: money(s.room_total),
      shitje_totale: money((Number(s.cash_sales_total) || 0) + (Number(s.card_sales_total) || 0) + (Number(s.room_total) || 0)),
    })),
    flags,
  };
  console.log(JSON.stringify(out, null, 2));
  if (flags.length) process.exitCode = 1;
}

const which = process.argv[2];
if (!which) {
  let fail = 0;
  for (const s of ["A", "B", "C", "D"]) {
    const r = spawnSync(process.execPath, [__filename, s], {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, HOTEL_DB_PLAIN: "1" },
    });
    if (r.status) fail += 1;
  }
  process.exit(fail ? 1 : 0);
}

const runners = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD };
if (!runners[which]) {
  console.error("Skenar i panjohur");
  process.exit(1);
}
runners[which]().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
