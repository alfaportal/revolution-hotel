"use strict";

const os = require("os");
const path = require("path");

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

function qtyOf(db, id) {
  return Number(db.db.prepare("SELECT COALESCE(stock_qty,0) AS q FROM menu_items WHERE id = ?").get(id)?.q) || 0;
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
  return db.closeTable(table.id, waiter, false, method);
}

function chargeRoom(db, table, waiter, guest, room, items) {
  db.sendOrder({ table_id: table.id, waiter_name: waiter, items });
  return db.chargeTableToRoomAtomic({
    tableId: table.id,
    waiterName: waiter,
    guestId: guest.id,
    roomId: room.id,
    tableNumber: table.number,
  });
}

function acceptMenu(db, orderId, waiterName, staff) {
  const pending = db.listPendingCloudOrders().find((o) => o.id === orderId);
  if (!pending) throw new Error(`Porosia ${orderId} nuk u gjet`);
  const imported = db.importCloudOrderToLocal(pending, waiterName, { fromAcceptFlow: true });
  db.removePendingCloudOrders([orderId]);
  return imported;
}

const dbPath = path.join(os.tmpdir(), `hotel-cross-${process.pid}-${Date.now()}.db`);
if (!dbPath.startsWith(os.tmpdir())) throw new Error("DB jo ne tmp");
process.env.DB_PATH = dbPath;
process.env.HOTEL_DB_PLAIN = "1";

const db = require("../database.js");
const advanced = require("../hotel-advanced-reports.js");
const exp = require("../hotel-advanced-reports-export.js");

function flag(flags, check, a, b, extra) {
  const row = {
    check,
    tab1: money(a),
    tab2: money(b),
    match: same(a, b),
    delta: money((Number(a) || 0) - (Number(b) || 0)),
  };
  if (extra) Object.assign(row, extra);
  flags.push(row);
}

async function main() {
  await db.whenReady();
  db.runSetup({ restaurant_name: "Cross Tab", admin_password: "1234", table_count: 12 });
  const day = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
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
  const opening = {
    Biftek: qtyOf(db, ids.Biftek),
    Kafe: qtyOf(db, ids.Kafe),
    Birra: qtyOf(db, ids.Birra),
    Pasta: qtyOf(db, ids.Pasta),
    Sallate: qtyOf(db, ids.Sallate),
  };
  const pastrim = ensureService(db, "Pastrim", 12);
  const pishine = ensureService(db, "Pishinë", 10);
  const spa = ensureService(db, "Spa", 25);
  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep X', 'recepsion', '1919', 1)",
  ).run().lastInsertRowid;
  const kamId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier X', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  const arbenId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Arben', 'pastrim', '1717', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 0);
  db.openWaiterShiftWithCash(kamId, 0);
  const waiter = "Kamarier X";
  const recep = "Recep X";
  const r101 = roomByNumber(db, "101");
  const r102 = roomByNumber(db, "102");
  db.db.prepare("UPDATE rooms SET price_per_night = 40, status = 'free' WHERE id = ?").run(r101.id);
  db.db.prepare("UPDATE rooms SET price_per_night = 60, status = 'free' WHERE id = ?").run(r102.id);
  const g101 = db.checkInGuest({
    room_id: r101.id, guest_name: "Mysafir 101", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 1), deposit: 0,
  }).guest;
  const g102 = db.checkInGuest({
    room_id: r102.id, guest_name: "Mysafir 102", persons: 1,
    check_in_date: day, check_out_date: addDays(day, 1), deposit: 0,
  }).guest;

  const purchase = db.createPurchaseInvoice({
    supplier: "Furnitor X",
    invoice_number: "BL-X-1",
    invoice_date: day,
    vat_rate: 18,
    items: [{ menu_item_id: ids.Biftek, quantity: 10, unit_price: 5, vat_rate: 18 }],
  });

  sell(db, tableByNumber(db, 1), waiter, [item(ids.Biftek, "Biftek", 9)], "cash");
  sell(db, tableByNumber(db, 2), waiter, [item(ids.Biftek, "Biftek", 9)], "cash");
  sell(db, tableByNumber(db, 3), waiter, [item(ids.Biftek, "Biftek", 9)], "cash");
  sell(db, tableByNumber(db, 4), waiter, [item(ids.Pasta, "Pasta", 8), item(ids.Sallate, "Sallatë", 4)], "karte");
  chargeRoom(db, tableByNumber(db, 5), waiter, g101, r101, [item(ids.Biftek, "Biftek", 9), item(ids.Sallate, "Sallatë", 4)]);

  const rs = db.submitGuestRoomMenuOrder("101", [
    item(ids.Kafe, "Kafe", 2.5),
    item(ids.Kafe, "Kafe", 2.5, 2),
  ]);
  const rsImp = acceptMenu(db, rs.order_id, waiter, { id: kamId, name: waiter });
  if (rsImp?.table_id) {
    db.chargeTableToRoomAtomic({
      tableId: rsImp.table_id,
      waiterName: waiter,
      guestId: g101.id,
      roomId: r101.id,
      tableNumber: rsImp.table_number,
    });
  }
  db.addRoomCharge({
    guest_id: g101.id,
    room_id: r101.id,
    description: "Minibar",
    amount: 1.5,
    vat_category: "18",
    performer: { id: recepId, name: recep },
  });
  const clean = db.submitGuestRoomServiceOrder("101", [{ service_id: pastrim.id, quantity: 1 }]);
  const cleanPending = db.listPendingCloudOrders().find((o) => o.id === clean.order_id);
  db.applyGuestHotelServiceOrder(cleanPending, { id: arbenId, name: "Arben" });
  db.removePendingCloudOrders([clean.order_id]);
  const spaOrder = db.submitGuestRoomServiceOrder("102", [{ service_id: spa.id, quantity: 1 }]);
  const spaPending = db.listPendingCloudOrders().find((o) => o.id === spaOrder.order_id);
  db.applyGuestHotelServiceOrder(spaPending, { id: recepId, name: recep });
  db.removePendingCloudOrders([spaOrder.order_id]);

  const walk = db.openWalkInClient({ client_name: "Klient X", phone: "044111111" });
  db.addWalkInService(walk.id, pishine.id, { quantity: 1, performer: { id: recepId, name: recep } });
  for (const line of db.getWalkInClient(walk.id).lines || []) db.setWalkInLineStatus(line.id, "done", recep);
  const walkPay = db.payWalkInClient(walk.id, { waiter_name: recep, payment_method: "cash" });

  const preview101 = db.getCheckoutPreview(r101.id).bill;
  const preview102 = db.getCheckoutPreview(r102.id).bill;
  const out101 = db.checkOutGuest(r101.id, { waiter_name: recep, payment_method: "cash" });
  const out102 = db.checkOutGuest(r102.id, { waiter_name: recep, payment_method: "cash" });

  const sumW = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  const sumR = db.getWaiterShiftSummary(recepId, { sessionRole: "recepsion" });
  const closedW = db.closeWaiterShift(kamId, sumW.expected_closing_cash, 0, { sessionRole: "kamarier" });
  const closedR = db.closeWaiterShift(recepId, sumR.expected_closing_cash, 0, { sessionRole: "recepsion" });

  const dit = db.getDitari({ dateFrom: day, dateTo: day });
  const led = db.getSalesLedger({ from: day, to: day });
  const week = advanced.getWeeklyReport(day);
  const staff = advanced.getStaffReport(day, day);
  const shifts = advanced.getShiftsReport(day, day);
  const turn = advanced.getTurnoverReport(day, day);
  const bil = db.getKontabilistiBilanc({ from: day, to: day });
  const purchases = db.listPurchases({ from: day, to: day });
  const expenseRows = db.listKontabilistiExpenseRows({ from: day, to: day });
  const work = db.listServiceWorkInRange(day, day);
  const diary = db.listHotelDiary({});
  const diarySql = db.db.prepare("SELECT COUNT(*) AS n FROM hotel_diary").get();
  const csv = exp.exportTurnoverCsv(day, day).csv;
  const pdf = exp.exportTurnoverPdf(day, day).html;
  const products = db.getMenuItems(false).filter((m) => ids[m.name] || m.name === "Sallatë");
  const stockDb = {
    Biftek: qtyOf(db, ids.Biftek),
    Kafe: qtyOf(db, ids.Kafe),
    Birra: qtyOf(db, ids.Birra),
    Pasta: qtyOf(db, ids.Pasta),
    Sallate: qtyOf(db, ids.Sallate),
  };
  const soldPlan = { Biftek: 4, Kafe: 3, Birra: 0, Pasta: 1, Sallate: 2 };
  const boughtPlan = { Biftek: 10, Kafe: 0, Birra: 0, Pasta: 0, Sallate: 0 };
  const turnByName = new Map((turn.products || []).map((p) => [p.name, p]));
  let ledRest = 0;
  let ledRec = 0;
  let ledTotal = 0;
  for (const row of led) {
    ledTotal += Number(row.total) || 0;
    ledRest += Number(row.restaurant_gross) || 0;
    ledRec += Number(row.reception_gross) || 0;
  }
  const purchaseListTotal = (purchases || []).reduce((s, p) => s + (Number(p.total) || 0), 0);
  const expensePurchase = (expenseRows || [])
    .filter((r) => r.from_purchase)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const co101 = db.db.prepare(
    "SELECT total, receipt_number FROM daily_log WHERE receipt_number = ? AND status = 'completed'",
  ).get(`CO-${g101.id}`);
  const co102 = db.db.prepare(
    "SELECT total, receipt_number FROM daily_log WHERE receipt_number = ? AND status = 'completed'",
  ).get(`CO-${g102.id}`);
  const waiterShift = (shifts.shifts || []).find((s) => s.waiter_name === waiter) || {};
  const recepShift = (shifts.shifts || []).find((s) => s.waiter_name === recep) || {};
  const ditariCashWaiter = (dit.entries || [])
    .filter((e) => String(e.waiter_name || "") === waiter && String(e.payment_method || "") === "cash")
    .reduce((s, e) => s + (Number(e.total) || 0), 0);
  const ditariReceptionCash = (dit.entries || [])
    .filter((e) => String(e.waiter_name || "") === recep && String(e.payment_method || "") !== "karte")
    .reduce((s, e) => s + (Number(e.total) || 0), 0);
  const arbenStaff = (staff.staff || []).find((s) => s.operator === "Arben") || {};
  const arbenWork = (work || []).filter((w) => String(w.performed_by_name || "") === "Arben");
  const arbenWorkSum = arbenWork.reduce((s, w) => s + (Number(w.amount) || 0), 0);
  const staffSum = (staff.staff || []).reduce((s, r) => s + (Number(r.total) || 0), 0);
  const types = diary.reduce((m, r) => {
    const k = r.event_type || "";
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const biftekTurn = turnByName.get("Biftek");
  const biftekProduct = products.find((p) => p.id === ids.Biftek || p.name === "Biftek");

  flag(flags, "Sales total Ditari vs Kontabilisti", dit.totalSales, ledTotal);
  flag(flags, "Sales total Ditari vs Javore", dit.totalSales, week.summary?.total);
  flag(flags, "Restorant Ditari vs Kontabilisti", dit.restaurantSales, ledRest);
  flag(flags, "Recepsion Ditari vs Kontabilisti", dit.receptionSales, ledRec);
  flag(flags, "Blerja 50€ Blerjet vs Shpenzime", purchaseListTotal, expensePurchase);
  flag(flags, "Stoku Biftek Produktet vs Qarkullimi", biftekProduct?.stock_qty, biftekTurn?.stock_qty);
  flag(flags, "Biftek shitur Qarkullimi", biftekTurn?.qty, 4);
  flag(flags, "Biftek te ardhura Qarkullimi", biftekTurn?.revenue, 36);
  const kafeTurn = turnByName.get("Kafe");
  flag(flags, "Kafe stoku Qarkullimi", kafeTurn?.stock_qty, stockDb.Kafe);
  flag(flags, "Kafe shitur Qarkullimi", kafeTurn?.qty, 3);
  const sallateTurn = turnByName.get("Sallatë");
  flag(flags, "Sallate shitur Qarkullimi", sallateTurn?.qty, 2);
  for (const name of Object.keys(stockDb)) {
    const expect = opening[name] - soldPlan[name] + boughtPlan[name];
    flag(flags, `Stoku ${name} 20 - shitur + blerje vs DB`, expect, stockDb[name], {
      start: opening[name],
      sold: soldPlan[name],
      purchased: boughtPlan[name],
    });
  }
  flag(flags, "Kamarier cash Nderrimi vs Ditari", waiterShift.cash_sales_total, ditariCashWaiter);
  flag(flags, "Kamarier ne dhoma vs Nga restoranti", waiterShift.room_total, sumR.from_restaurant);
  flag(flags, "Recepsion cash Nderrimi vs Ditari", recepShift.cash_sales_total, ditariReceptionCash);
  flag(flags, "Folio 101 vs kupon CO", preview101.total, co101?.total);
  flag(flags, "Folio 102 vs kupon CO", preview102.total, co102?.total);
  flag(flags, "Arben Punonjesit vs Sherbimet", arbenStaff.services_total, arbenWorkSum);
  flag(flags, "Shuma e punonjesve vs Ditari", staffSum, dit.totalSales);
  flag(flags, "Ngjarje Ditari i hotelit vs SQL", diary.length, diarySql.n);

  const expectedEvents = { check_in: 2, check_out: 2, table_cash: 3, table_sale: 1 };
  for (const [k, n] of Object.entries(expectedEvents)) {
    if ((types[k] || 0) !== n) {
      flags.push({
        check: `Ngjarje ${k}`,
        tab1: types[k] || 0,
        tab2: n,
        match: false,
        delta: (types[k] || 0) - n,
      });
    }
  }
  const stockInCsv = /Stoku/.test(csv) && /Biftek/.test(csv) && String(stockDb.Biftek).length > 0 && csv.includes(String(stockDb.Biftek));
  const stockInPdf = /Stoku/.test(pdf) && /Biftek/.test(pdf) && pdf.includes(String(stockDb.Biftek));
  if (!stockInCsv) flags.push({ check: "CSV Qarkullimi ka Stoku", match: false, csv_head: csv.split("\n")[0] });
  if (!stockInPdf) flags.push({ check: "PDF Qarkullimi ka Stoku", match: false });

  const mismatches = flags.filter((f) => f.match === false);
  const out = {
    day,
    db: dbPath,
    input: {
      night_101: 40,
      night_102: 60,
      purchase_unit: 5,
      purchase_qty: 10,
      cash_tables: 27,
      card_table: 12,
      room_charge_101: 13,
      room_service: 7.5,
      minibar: 1.5,
      pastrim: 12,
      spa: 25,
      pishine: 10,
    },
    ditari: {
      total: money(dit.totalSales),
      restorant: money(dit.restaurantSales),
      recepsion: money(dit.receptionSales),
      entries: (dit.entries || []).map((e) => ({
        receipt: e.receipt_number,
        waiter: e.waiter_name,
        total: money(e.total),
        pay: e.payment_method,
      })),
    },
    kontabilisti: {
      total: money(ledTotal),
      restorant: money(ledRest),
      recepsion: money(ledRec),
      rows: led.map((r) => ({
        receipt: r.receipt_number,
        total: money(r.total),
        restorant: money(r.restaurant_gross),
        recepsion: money(r.reception_gross),
      })),
    },
    javore: {
      total: money(week.summary?.total),
      restorant: money(week.summary?.waiter),
      recepsion: money(week.summary?.reception),
    },
    blerja: {
      invoice_total: money(purchase?.total),
      lista: money(purchaseListTotal),
      shpenzime_blerje: money(expensePurchase),
      bilanc_purchases_net: money(bil.purchases_total),
      bilanc_expenses_total: money(bil.expenses_total),
      bilanc_sales_total: money(bil.sales_total),
    },
    stoku: {
      db: stockDb,
      produktet: products.map((p) => ({ name: p.name, stock_qty: p.stock_qty, price: p.price })),
      qarkullimi: turn.products || [],
    },
    nderrimet: {
      kamarier: {
        cash: money(waiterShift.cash_sales_total),
        card: money(waiterShift.card_sales_total),
        ne_dhoma: money(waiterShift.room_total),
        shitje: money(waiterShift.total_sales),
        mbyllje_cash: money(closedW.cash_total),
        mbyllje_room: money(closedW.room_total),
      },
      recepsion: {
        cash: money(recepShift.cash_sales_total),
        card: money(recepShift.card_sales_total),
        ne_dhoma: money(recepShift.room_total),
        shitje: money(recepShift.total_sales),
        nga_restoranti: money(sumR.from_restaurant),
        mbyllje_cash: money(closedR.cash_total),
        mbyllje_nga_restoranti: money(closedR.from_restaurant),
      },
    },
    folio: {
      101: {
        preview: money(preview101.total),
        room: money(preview101.room_total),
        charges: money(preview101.charges_total),
        checkout: money(out101.bill?.total),
        kupon: money(co101?.total),
        receipt: co101?.receipt_number || null,
      },
      102: {
        preview: money(preview102.total),
        room: money(preview102.room_total),
        charges: money(preview102.charges_total),
        checkout: money(out102.bill?.total),
        kupon: money(co102?.total),
        receipt: co102?.receipt_number || null,
      },
    },
    walkin: { total: money(walkPay.total), receipt: walkPay.receipt_number },
    punonjesit: (staff.staff || []).map((s) => ({
      name: s.operator,
      total: money(s.total),
      cash: money(s.cash),
      card: money(s.card),
      room: money(s.room),
      activity: money(s.activity_total),
      services: money(s.services_total),
    })),
    arben_sherbimet: arbenWork.map((w) => ({
      desc: w.description,
      amount: money(w.amount),
      status: w.status || w.work_status,
    })),
    ditari_hoteli: {
      lista: diary.length,
      sql: diarySql.n,
      llojet: types,
      rreshta: diary.map((r) => ({
        type: r.event_type,
        amount: money(r.amount),
        who: r.performed_by,
        detail: r.detail,
      })),
    },
    checks: flags,
    mismatches,
  };
  console.log(JSON.stringify(out, null, 2));
  if (mismatches.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
