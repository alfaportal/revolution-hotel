"use strict";

const os = require("os");
const path = require("path");
const crypto = require("crypto");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function item(id, name, price, qty = 1) {
  return { name, menu_item_id: id, quantity: qty, price };
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
  let row = db.db.prepare("SELECT id, room_number, status, price_per_night FROM rooms WHERE room_number = ?").get(String(n));
  if (!row) {
    db.createRoom({ room_number: String(n), floor: Math.floor(Number(n) / 100), type: "Standard", price_per_night: 50, status: "free" });
    row = db.db.prepare("SELECT id, room_number, status, price_per_night FROM rooms WHERE room_number = ?").get(String(n));
  }
  db.db.prepare("UPDATE rooms SET price_per_night = 50, status = 'free' WHERE id = ?").run(row.id);
  return db.db.prepare("SELECT id, room_number, status, price_per_night FROM rooms WHERE id = ?").get(row.id);
}

function ensureCat(db, name, route) {
  const row = db.db.prepare("SELECT id FROM categories WHERE name = ?").get(name);
  if (!row) db.addCategory(name, route);
}

function publish(db, kds, orderId) {
  const row = db.db.prepare("SELECT items_json FROM orders WHERE id = ?").get(orderId);
  if (!row) return;
  db.recordPrintedBatch(orderId, row.items_json);
  kds.touchOrderAfterSend(db, orderId);
}

function namesOf(orders) {
  const out = [];
  for (const o of orders || []) {
    const raw = o.items_json || o.items || [];
    const list = Array.isArray(raw) ? raw : [];
    for (const it of list) out.push(String(it.name || it.emri || ""));
  }
  return out;
}

function linesOf(order) {
  if (!order) return [];
  const raw = order.items_json || order.items || "[]";
  const list = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
  return list;
}

function sumLines(list) {
  return money(list.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0));
}

function acceptOpen(db, kds, orderId, waiter) {
  const pending = db.listPendingCloudOrders().find((o) => o.id === orderId);
  if (!pending) throw new Error(`Porosia ${orderId} nuk është në pritje`);
  const imported = db.importCloudOrderToLocal(pending, waiter, { fromAcceptFlow: true });
  db.removePendingCloudOrders([orderId]);
  if (imported?.order_id) publish(db, kds, imported.order_id);
  return imported;
}

const dbPath = path.join(os.tmpdir(), `hotel-stress-${process.pid}-${Date.now()}.db`);
if (!dbPath.startsWith(os.tmpdir())) throw new Error("DB jo ne tmp");
process.env.DB_PATH = dbPath;
process.env.HOTEL_DB_PLAIN = "1";
process.env.ATK_AUTO_SEND = "0";

const db = require("../database.js");
const advanced = require("../hotel-advanced-reports.js");
const kds = require("../lib/local-kds-service.js");
const promo = require("../promotion-service.js");
const { buildReceiptText } = require("../receipt-text");

const checks = [];
const sales = [];

function check(name, pass, actual, expected) {
  checks.push({ name, result: pass ? "PASS" : "FAIL", actual, expected });
}

function books(day) {
  const dit = db.getDitari({ dateFrom: day, dateTo: day });
  const bil = db.getKontabilistiBilanc({ from: day, to: day });
  return {
    ditari: money(dit.totalSales),
    restorant: money(dit.restaurantSales),
    recepsion: money(dit.receptionSales),
    kontabilisti: money(bil.sales_total),
    kontabilisti_restorant: money(bil.sales_restaurant),
    neto: money(bil.sales_net),
    dyqanet: dit.shops || null,
    shitur_recepsionit: money(dit.shops?.transfer),
    paguar_restorantit: money(bil.paid_to_restaurant),
  };
}

function shiftOf(staffId, day) {
  const rows = db.listShiftReports({ from: day, to: day, staff_id: staffId, include_open: true });
  const s = rows[0];
  if (!s) return null;
  const cash = money(s.cash_sales_total);
  const card = money(s.card_sales_total);
  const room = money(s.room_total);
  return {
    name: s.waiter_name,
    cash,
    card,
    room,
    shitje_totale: money(cash + card + room),
    total_sales: money(s.total_sales),
  };
}

async function main() {
  await db.whenReady();
  db.runSetup({ restaurant_name: "Stress", admin_password: "1234", table_count: 20 });
  if (typeof db.ensureHotelFnbZones === "function") db.ensureHotelFnbZones();
  const day = db.db.prepare("SELECT date('now','localtime') AS d").get().d;

  ensureCat(db, "Ushqim", "kitchen");
  ensureCat(db, "Pije", "bar");
  const foods = [];
  const drinks = [];
  for (let i = 1; i <= 10; i += 1) {
    const fp = 10 + i;
    const dp = 1 + i;
    foods.push({
      name: `Ushqim ${i}`,
      price: fp,
      id: db.addMenuItem({ name: `Ushqim ${i}`, category: "Ushqim", price: fp, vat_category: "18", stock_qty: 50, low_stock_threshold: 0 }),
    });
    drinks.push({
      name: `Pije ${i}`,
      price: dp,
      id: db.addMenuItem({ name: `Pije ${i}`, category: "Pije", price: dp, vat_category: "18", stock_qty: 50, low_stock_threshold: 0 }),
    });
  }
  const zero = {
    name: "Zero Stok",
    price: 1,
    id: db.addMenuItem({ name: "Zero Stok", category: "Pije", price: 1, vat_category: "18", stock_qty: 0, low_stock_threshold: 0 }),
  };
  const expired = {
    name: "Skaduar Stress",
    price: 1,
    id: db.addMenuItem({ name: "Skaduar Stress", category: "Pije", price: 1, vat_category: "18", stock_qty: 50, low_stock_threshold: 0 }),
  };
  const catalog = [...foods, ...drinks, zero, expired];
  const opening = {};
  for (const p of catalog) opening[p.name] = qtyOf(db, p.id);
  const foodNames = new Set(foods.map((p) => p.name));
  const drinkNames = new Set(drinks.map((p) => p.name));

  const sold = {};
  function note(list) {
    for (const it of list || []) {
      const id = Number(it.menu_item_id);
      const q = Number(it.quantity) || 0;
      if (!id || q <= 0) continue;
      sold[id] = (sold[id] || 0) + q;
    }
  }
  function remember(label, closed, method) {
    const list = linesOf(closed);
    note(list);
    const total = money(closed?.total);
    sales.push({ label, method, total, items: list.map((it) => `${it.name}×${it.quantity}`) });
    return total;
  }

  const aId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier A', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  const bId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier B', 'kamarier', '1919', 1)",
  ).run().lastInsertRowid;
  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep Stress', 'recepsion', '1717', 1)",
  ).run().lastInsertRowid;
  const waiterA = "Kamarier A";
  const waiterB = "Kamarier B";
  const recep = "Recep Stress";
  db.openWaiterShiftWithCash(aId, 0);
  db.openWaiterShiftWithCash(bId, 0);
  db.openWaiterShiftWithCash(recepId, 0);

  const rooms = {};
  const guests = {};
  for (const n of ["101", "102", "103", "104", "105"]) {
    rooms[n] = roomByNumber(db, n);
    guests[n] = db.checkInGuest({
      room_id: rooms[n].id,
      guest_name: `Mysafir ${n}`,
      persons: 1,
      check_in_date: day,
      check_out_date: day,
    }).guest;
  }

  const T = {};
  for (let n = 1; n <= 20; n += 1) T[n] = tableByNumber(db, n);
  const F = foods;
  const D = drinks;
  const line = (p, qty = 1, price = p.price) => item(p.id, p.name, price, qty);

  const orders = {};
  function place(num, waiter, items) {
    const id = db.sendOrder({ table_id: T[num].id, waiter_name: waiter, items });
    publish(db, kds, id);
    orders[num] = id;
    return id;
  }

  place(1, waiterA, [line(F[0]), line(F[1]), line(F[2]), line(D[0])]);
  place(2, waiterA, [line(D[1])]);
  place(3, waiterA, [line(F[3]), line(F[4]), line(D[2]), line(D[3])]);
  place(4, waiterA, [line(F[5]), line(D[4])]);
  place(5, waiterA, [line(F[6]), line(D[5])]);
  place(6, waiterA, [line(F[7]), line(D[6])]);
  place(7, waiterA, [line(F[8])]);
  place(8, waiterA, [line(F[9], 2), line(D[8])]);
  place(9, waiterB, [line(F[0]), line(D[9])]);
  place(10, waiterB, [line(F[1]), line(D[0])]);
  place(11, waiterB, [line(F[2]), line(F[3]), line(D[1])]);
  place(12, waiterB, [line(F[4]), line(D[2])]);

  const take = db.submitGuestPublicMenuOrder({
    order_kind: "takeaway",
    customer_name: "Take Stress",
    items: [line(F[5])],
  });
  const takeImp = acceptOpen(db, kds, take.order_id, waiterA);

  const qr = db.submitGuestPublicMenuOrder({
    order_kind: "table",
    table_number: 14,
    customer_name: "QR Stress",
    items: [line(D[3])],
  });
  const qrImp = acceptOpen(db, kds, qr.order_id, waiterB);

  const webId = crypto.randomUUID();
  db.upsertPendingCloudOrders([{
    id: webId,
    source: "online",
    source_label: "Web",
    customer_name: "Web Stress",
    device_id: "WEB-PUBLIC",
    table_number: 0,
    items: [line(F[6])],
    items_json: [line(F[6])],
    total: F[6].price,
    ordered_at: new Date().toISOString(),
  }]);
  const webImp = acceptOpen(db, kds, webId, waiterB);

  const kitchenNames = namesOf(kds.listKitchenOrders(db));
  const barNames = namesOf(kds.listBarOrders(db));
  const kitchenDrinks = kitchenNames.filter((n) => drinkNames.has(n));
  const barFood = barNames.filter((n) => foodNames.has(n));
  check("Kuzhina vetëm ushqim", kitchenDrinks.length === 0 && kitchenNames.some((n) => foodNames.has(n)), {
    kuzhina: kitchenNames,
    pije: kitchenDrinks,
  }, "pa pije");
  check("Banaku vetëm pije", barFood.length === 0 && barNames.some((n) => drinkNames.has(n)), {
    banaku: barNames,
    ushqim: barFood,
  }, "pa ushqim");

  const readyIds = [orders[1], orders[3], orders[4], orders[5]];
  for (const id of readyIds) kds.markKitchenOrderReady(db, id);
  const barReady = kds.markBarItemReady(db, orders[2], "Pije 2");
  const readyNotes = [
    ...kds.listWaiterReadyKitchenOrders(db),
    ...kds.listWaiterReadyBarOrders(db),
  ];
  check("5 porosi gati te kamarieri", readyNotes.length === 5 && barReady[0]?.message === "Gati: Pije 2, Tavolina 2", {
    n: readyNotes.length,
    tavolina: readyNotes.map((r) => r.table_number),
    banaku: barReady.map((r) => r.message),
  }, "Gati: Pije 2, Tavolina 2");

  const cancelA = db.removeSentOrderItem({ tableId: T[8].id, waiterName: waiterA, item: line(F[9]) });
  const cancelB = db.removeSentOrderItem({ tableId: T[8].id, waiterName: waiterA, item: line(F[9]) });
  const cancelMsg = kds.listKitchenCancelledOrders(db).map((o) => o.message);
  const anuluar = cancelMsg.filter((m) => String(m).includes("ANULUAR") && String(m).includes(F[9].name));
  check("ANULUAR për 2 artikuj", anuluar.length >= 2, { njoftime: cancelMsg, a: cancelA.notice, b: cancelB.notice }, 2);

  const moved = db.moveTableOrderItems({
    fromTableId: T[1].id,
    toTableId: T[2].id,
    waiterName: waiterA,
    items: [line(F[0]), line(F[1]), line(F[2])],
  });
  const t1Left = linesOf(db.getActiveOrderForTable(T[1].id)).map((i) => i.name);
  const t2Now = linesOf(db.getActiveOrderForTable(T[2].id)).map((i) => i.name);
  check("Zhvendos 3 artikuj T1 → T2", t1Left.length === 1 && t1Left[0] === D[0].name && moved.moved.length === 3 && t2Now.length === 4, {
    t1: t1Left,
    t2: t2Now,
  }, "T1 mbetet 1, T2 ka 4");

  const half = db.moveTableOrderItems({
    fromTableId: T[3].id,
    toTableId: T[16].id,
    waiterName: waiterA,
    items: [line(F[3]), line(F[4])],
  });
  const t3Left = sumLines(linesOf(db.getActiveOrderForTable(T[3].id)));
  const t16Sum = sumLines(linesOf(db.getActiveOrderForTable(T[16].id)));
  check("Ndaje T3 përgjysmë te T16", half.moved.length === 2 && t3Left === 9 && t16Sum === 29, {
    t3: t3Left,
    t16: t16Sum,
  }, "9 + 29");

  db.sendOrder({
    table_id: T[6].id,
    waiter_name: waiterA,
    items: [line(F[7], 1, 10), line(D[6])],
  });
  const t6 = money(db.getActiveOrderForTable(T[6].id).total);
  check("Çmimi i Ushqim 8 në T6 u bë 10", t6 === 18, t6, 18);

  const disc = db.createPromotion({
    name: "Zbritje 10",
    discount_type: "percent",
    discount_value: 10,
    applies_to: "order",
    date_from: day,
    date_to: day,
    active: true,
  });
  const happy = db.createPromotion({
    name: "Happy Hour",
    discount_type: "percent",
    discount_value: 50,
    applies_to: "order",
    date_from: day,
    date_to: day,
    time_from: "00:00",
    time_to: "23:59",
    active: true,
  });

  function pay(num, waiter, method, extra) {
    const order = db.getActiveOrderForTable(T[num].id);
    const items = linesOf(order);
    let pricing = null;
    if (extra?.promotionId) {
      pricing = promo.resolvePromotionDiscount(db, items, extra.promotionId);
    }
    const closed = db.closeTable(T[num].id, waiter, false, method, pricing, extra?.opts || {});
    remember(`T${num}`, closed, method);
    return closed;
  }

  pay(1, waiterA, "cash");
  pay(2, waiterA, "cash");
  pay(3, waiterA, "cash");
  pay(16, waiterA, "cash");
  const t4 = pay(4, waiterA, "cash", { promotionId: disc.id });
  const t5 = pay(5, waiterA, "cash", { promotionId: happy.id });
  pay(6, waiterA, "karte");
  const t7first = pay(7, waiterA, "cash");
  place(7, waiterA, [line(D[7])]);
  const t7second = pay(7, waiterA, "cash");
  pay(8, waiterA, "karte");

  const t9order = linesOf(db.getActiveOrderForTable(T[9].id));
  const t9total = sumLines(t9order);
  const t9cash = money(Math.round((t9total / 2) * 100) / 100);
  const t9card = money(t9total - t9cash);
  const t9 = db.closeTable(T[9].id, waiterB, false, "mixed", null, {
    payment_splits: [
      { method: "cash", amount: t9cash },
      { method: "karte", amount: t9card },
    ],
  });
  remember("T9", t9, "mixed");
  const t10order = linesOf(db.getActiveOrderForTable(T[10].id));
  const t10total = sumLines(t10order);
  const t10cash = money(Math.round((t10total / 2) * 100) / 100);
  const t10card = money(t10total - t10cash);
  const t10 = db.closeTable(T[10].id, waiterB, false, "mixed", null, {
    payment_splits: [
      { method: "cash", amount: t10cash },
      { method: "karte", amount: t10card },
    ],
  });
  remember("T10", t10, "mixed");

  function charge(num, waiter, roomNo) {
    const before = linesOf(db.getActiveOrderForTable(T[num].id));
    const stockBefore = before.map((it) => ({ name: it.name, q: qtyOf(db, it.menu_item_id) }));
    const out = db.chargeTableToRoomAtomic({
      tableId: T[num].id,
      waiterName: waiter,
      guestId: guests[roomNo].id,
      roomId: rooms[roomNo].id,
      tableNumber: num,
    });
    remember(`T${num}→${roomNo}`, out.order, "room");
    const stockAfter = before.map((it) => ({ name: it.name, q: qtyOf(db, it.menu_item_id) }));
    return { out, stockBefore, stockAfter, items: before };
  }

  const c11 = charge(11, waiterB, "101");
  const c12 = charge(12, waiterB, "102");
  check("T11 stoku zbret një herë", c11.stockAfter.every((r, i) => r.q === c11.stockBefore[i].q - 1), {
    para: c11.stockBefore,
    pas: c11.stockAfter,
  }, "−1 për artikull");
  check("T12 stoku zbret një herë", c12.stockAfter.every((r, i) => r.q === c12.stockBefore[i].q - 1), {
    para: c12.stockBefore,
    pas: c12.stockAfter,
  }, "−1 për artikull");

  function closeImported(imp, waiter, method) {
    const closed = db.closeTable(imp.table_id, waiter, false, method);
    remember(method === "cash" ? "takeaway/web" : "qr", closed, method);
    return { closed, table: imp.table_number };
  }
  const takeClosed = closeImported(takeImp, waiterA, "cash");
  const qrClosed = closeImported(qrImp, waiterB, "karte");
  const webClosed = closeImported(webImp, waiterB, "cash");

  function roomService(roomNo, waiter, items, chargeNow) {
    const rs = db.submitGuestRoomMenuOrder(roomNo, items);
    const pending = db.listPendingCloudOrders().find((o) => o.id === rs.order_id);
    const imp = db.importCloudOrderToLocal(pending, waiter, { fromAcceptFlow: true });
    db.removePendingCloudOrders([rs.order_id]);
    if (!imp?.table_id) return { rs, imp, charged: false };
    if (!chargeNow) return { rs, imp, charged: false, items };
    const before = items.map((it) => ({ name: it.name, q: qtyOf(db, it.menu_item_id) }));
    const out = db.chargeTableToRoomAtomic({
      tableId: imp.table_id,
      waiterName: waiter,
      guestId: guests[roomNo].id,
      roomId: rooms[roomNo].id,
      tableNumber: imp.table_number,
    });
    remember(`RS ${roomNo}`, out.order, "room");
    const after = items.map((it) => ({ name: it.name, q: qtyOf(db, it.menu_item_id) }));
    return { rs, imp, out, before, after, charged: true };
  }

  const rs103 = roomService("103", waiterA, [line(F[7]), line(D[4])], true);
  check("RS 103 stoku një herë", rs103.after.every((r, i) => r.q === rs103.before[i].q - 1), {
    para: rs103.before,
    pas: rs103.after,
  }, "−1");

  const rs104items = [line(F[8]), line(D[5])];
  const rs104 = roomService("104", waiterB, rs104items, false);
  const stock104before = rs104items.map((it) => ({ name: it.name, q: qtyOf(db, it.menu_item_id) }));
  const out104 = db.checkOutGuest(rooms["104"].id, { waiter_name: recep, payment_method: "cash", check_out_date: day });
  const stock104after = rs104items.map((it) => ({ name: it.name, q: qtyOf(db, it.menu_item_id) }));
  if ((out104.room_service_auto_charged || []).length) note(rs104items);
  sales.push({
    label: "RS 104 auto",
    method: "room",
    total: money(rs104.imp?.total || sumLines(rs104items)),
    items: rs104items.map((it) => it.name),
  });
  check("RS 104 harrohet, check-out e ngarkon", (out104.room_service_auto_charged || []).some((r) => String(r.room_number) === "104") && stock104after.every((r, i) => r.q === stock104before[i].q - 1), {
    charged: out104.room_service_auto_charged,
    para: stock104before,
    pas: stock104after,
    folio: money(out104.bill?.charges_total),
  }, "një herë në folio");

  for (const n of ["101", "102", "103", "105"]) {
    db.checkOutGuest(rooms[n].id, { waiter_name: recep, payment_method: "cash", check_out_date: day });
  }

  function folio(roomNo) {
    const rows = db.listRoomChargesForGuest(guests[roomNo].id) || [];
    return {
      n: rows.length,
      total: money(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
      items: rows.map((r) => `${r.description}: ${money(r.amount)}`),
    };
  }
  const f101 = folio("101");
  const f102 = folio("102");
  const f103 = folio("103");
  const f104 = folio("104");
  const f105 = folio("105");
  check("Folio 101 = 30, 3 artikuj", f101.total === 30 && f101.n === 3, f101, 30);
  check("Folio 102 = 19, 2 artikuj", f102.total === 19 && f102.n === 2, f102, 19);
  check("Folio 103 = 24, 2 artikuj", f103.total === 24 && f103.n === 2, f103, 24);
  check("Folio 104 = 26, 2 artikuj", f104.total === 26 && f104.n === 2, f104, 26);
  check("Folio 105 pa restorant", f105.total === 0, f105, 0);

  const liveA = shiftOf(aId, day);
  const liveB = shiftOf(bId, day);
  const roomWaiters = money((liveA?.room || 0) + (liveB?.room || 0));
  const folioFood = money(f101.total + f102.total + f103.total + f104.total);
  check("Në dhomë e kamarierëve = foliot", roomWaiters === folioFood, {
    a: liveA,
    b: liveB,
    shuma: roomWaiters,
    foliot: folioFood,
  }, folioFood);

  db.sendOrder({ table_id: T[18].id, waiter_name: waiterA, items: [line(F[0])] });
  let secondClose = "";
  try {
    db.closeTable(T[18].id, waiterB, false, "cash");
    secondClose = "u mbyll";
  } catch (e) {
    secondClose = e.message;
  }
  const t18 = db.closeTable(T[18].id, waiterA, false, "cash");
  remember("T18", t18, "cash");
  const t18logs = db.db.prepare("SELECT COUNT(*) AS n FROM daily_log WHERE table_number = 18 AND status = 'completed'").get().n;
  check("Dy kamarierë, një mbyllje", secondClose.includes(waiterA) && t18logs === 1, {
    gabimi: secondClose,
    rreshta: t18logs,
  }, "vetëm Kamarier A");

  const logBeforeEmpty = Number(db.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM daily_log").get().id) || 0;
  const emptyClose = db.closeTable(T[19].id, waiterA, false, "cash");
  const logAfterEmpty = Number(db.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM daily_log").get().id) || 0;
  let emptyOrder = "";
  try {
    db.sendOrder({ table_id: T[19].id, waiter_name: waiterA, items: [] });
    emptyOrder = "u krijua";
  } catch (e) {
    emptyOrder = e.message;
  }
  const emptyStill = db.getActiveOrderForTable(T[19].id);
  let emptySale = null;
  if (emptyStill) {
    try {
      emptySale = db.closeTable(T[19].id, waiterA, false, "cash");
    } catch (e) {
      emptyOrder = `${emptyOrder}; mbyllja: ${e.message}`;
    }
    const stillOrder = db.getActiveOrderForTable(T[19].id);
    const tbl = db.db.prepare("SELECT status FROM tables WHERE id = ?").get(T[19].id);
    emptyOrder = `${emptyOrder}; status=${tbl?.status || ""}`;
    if (stillOrder && tbl?.status === "occupied") emptyOrder += "; hapur";
    if (stillOrder) db.cancelActiveOrder(T[19].id);
  }
  const completedEmpty = db.db.prepare(
    "SELECT COUNT(*) AS n FROM daily_log WHERE table_number = 19 AND status = 'completed' AND id > ?",
  ).get(logBeforeEmpty).n;
  check("Tavolina pa artikuj nuk shet", emptyClose == null && logAfterEmpty === logBeforeEmpty && completedEmpty === 0 && emptyOrder.includes("Tavolina është e zbrazët — shto artikuj para mbylljes.") && emptyOrder.includes("hapur"), {
    mbyllja: emptyClose,
    porosia_bosh: emptyOrder,
    totali: emptyStill ? money(emptyStill.total) : null,
    shitje: emptySale ? money(emptySale.total) : null,
    rreshta: completedEmpty,
  }, "pa shitje");

  db.updateMenuItem(expired.id, { expiry_date: "2020-01-01" });
  const expRow = db.getExpiringMenuItems().find((r) => r.name === expired.name);
  const expBefore = qtyOf(db, expired.id);
  db.sendOrder({ table_id: T[17].id, waiter_name: waiterA, items: [line(expired)] });
  const expClosed = db.closeTable(T[17].id, waiterA, false, "cash");
  remember("Skaduar", expClosed, "cash");
  check("I skaduar paralajmëron dhe shitet", !!expRow?.expired && !!expClosed && qtyOf(db, expired.id) === expBefore - 1, {
    skaduar: !!expRow?.expired,
    stoku: qtyOf(db, expired.id),
  }, expBefore - 1);

  const zeroWarn = db.getLowStockItems().some((r) => r.name === zero.name);
  db.sendOrder({ table_id: T[20].id, waiter_name: waiterA, items: [line(zero)] });
  let zeroClosed = null;
  let zeroErr = "";
  try {
    zeroClosed = db.closeTable(T[20].id, waiterA, false, "cash");
    if (zeroClosed) remember("Zero", zeroClosed, "cash");
  } catch (e) {
    zeroErr = e.message;
  }
  check("Stoku 0 paralajmëron, shitet, mbetet 0", zeroWarn && !!zeroClosed && qtyOf(db, zero.id) === 0, {
    paralajmerim: zeroWarn,
    mbyllur: !!zeroClosed,
    gabim: zeroErr,
    stoku: qtyOf(db, zero.id),
  }, 0);

  const qrExpire = db.submitGuestPublicMenuOrder({
    order_kind: "table",
    table_number: 15,
    customer_name: "QR Skadon",
    items: [line(D[9])],
  });
  db.db.prepare("UPDATE pending_cloud_orders SET first_seen_at = ? WHERE cloud_id = ?").run(
    new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    qrExpire.order_id,
  );
  db.expireUnacceptedQrOrders(15 * 60 * 1000, Date.now());
  const qrStatus = db.getGuestPublicOrderStatus(qrExpire.order_id);
  check("QR 15 min skadon", qrStatus.status === "expired" && qrStatus.message === "Porosia juaj ka skaduar — provoni përsëri.", qrStatus, "expired");

  const takeEdit = db.submitGuestPublicMenuOrder({
    order_kind: "takeaway",
    customer_name: "Take Ndrysho",
    items: [line(F[9])],
  });
  const edited = db.updatePendingTakeawayOrder(takeEdit.order_id, [line(F[9]), line(D[8])]);
  check("Takeaway ndryshohet para pranimit", money(edited.total) === 30, money(edited.total), 30);
  const editImp = acceptOpen(db, kds, takeEdit.order_id, waiterA);
  const editClosed = db.closeTable(editImp.table_id, waiterA, false, "cash");
  remember("Takeaway ndryshuar", editClosed, "cash");
  let locked = "";
  try {
    db.updatePendingTakeawayOrder(takeEdit.order_id, [line(F[9])]);
  } catch (e) {
    locked = e.message;
  }
  check("Takeaway pas pranimit nuk ndryshohet", locked === "Porosia është pranuar dhe nuk ndryshohet.", locked, "Porosia është pranuar dhe nuk ndryshohet.");

  const coupon = db.db.prepare(
    "SELECT * FROM daily_log WHERE status = 'completed' AND COALESCE(receipt_number,'') != '' ORDER BY id ASC LIMIT 1",
  ).get();
  let thermal = "";
  if (coupon) {
    let couponItems = [];
    try { couponItems = JSON.parse(coupon.items_json || "[]"); } catch { couponItems = []; }
    thermal = buildReceiptText({
      restaurantName: db.getUnifiedBusinessName(),
      receiptNumber: coupon.receipt_number,
      items: couponItems,
      total: coupon.total,
      waiterName: coupon.waiter_name,
      paymentMethod: coupon.payment_method,
      closedAt: `${coupon.date}T${coupon.time || "12:00:00"}`,
      slipKind: "final",
      tableNumber: Number(coupon.table_number) || 0,
    });
  }
  check("Riprintim i kuponit lokal", !!coupon && thermal.includes(Number(coupon.total).toFixed(2)), {
    receipt: coupon?.receipt_number,
    total: money(coupon?.total),
    fiscal: db.db.prepare("SELECT COUNT(*) AS n FROM fiscal_receipts").get().n,
  }, "kupon termik");

  const tableSum = money(sales.reduce((s, r) => s + r.total, 0));
  const beforeShift = books(day);
  const shiftA = shiftOf(aId, day);
  const shiftB = shiftOf(bId, day);
  const shiftSum = money((shiftA?.shitje_totale || 0) + (shiftB?.shitje_totale || 0));
  check("Shuma e tavolinave = Ditari Restorant", tableSum === beforeShift.restorant, { tavolinat: tableSum, ditari_restorant: beforeShift.restorant, ditari: beforeShift.ditari }, beforeShift.restorant);
  check("Shuma e tavolinave = Kontabilisti restorant", tableSum === beforeShift.kontabilisti_restorant, { tavolinat: tableSum, kontabilisti_restorant: beforeShift.kontabilisti_restorant, kontabilisti: beforeShift.kontabilisti }, beforeShift.kontabilisti_restorant);
  check("Shuma e tavolinave = ndërrimet", tableSum === shiftSum, { tavolinat: tableSum, a: shiftA, b: shiftB, shuma: shiftSum }, shiftSum);

  const ditariRows = db.db.prepare(
    "SELECT table_number, total, payment_method, discount_total, receipt_number, waiter_name FROM daily_log WHERE status = 'completed' ORDER BY id",
  ).all().map((r) => ({
    tavolina: r.table_number,
    total: money(r.total),
    pagesa: r.payment_method,
    zbritje: money(r.discount_total),
    kupon: r.receipt_number,
    kamarier: r.waiter_name,
  }));
  check("T4 zbritje 10% = 19.80", money(t4.total) === 19.8 && money(t4.discount_total) === 2.2, {
    total: money(t4.total),
    zbritje: money(t4.discount_total),
  }, 19.8);
  check("T5 Happy Hour 50% = 12", money(t5.total) === 12 && money(t5.discount_total) === 12, {
    total: money(t5.total),
    zbritje: money(t5.discount_total),
  }, 12);
  const t7rows = ditariRows.filter((r) => String(r.tavolina) === "7");
  check("T7 dy mbyllje 19 + 9", money(t7first.total) === 19 && money(t7second.total) === 9 && t7rows.length === 2, {
    e_para: money(t7first.total),
    e_dyta: money(t7second.total),
    ditari: t7rows,
  }, 28);

  const stockBeforeBuy = catalog.map((p) => {
    const end = qtyOf(db, p.id);
    const raw = opening[p.name] - (sold[p.id] || 0);
    const expect = raw < 0 ? 0 : raw;
    return { name: p.name, start: opening[p.name], sold: sold[p.id] || 0, end, expect };
  });
  for (const row of stockBeforeBuy) {
    check(`Stoku ${row.name} = 50 − shitur`, row.end === row.expect, row, row.expect);
  }

  const purchase = db.createPurchaseInvoice({
    supplier: "Furnitor Stress",
    invoice_number: "BL-STRESS-10",
    invoice_date: day,
    vat_rate: 18,
    items: foods.map((p) => ({ menu_item_id: p.id, quantity: 10, unit_price: 5, vat_rate: 18 })),
  });
  for (const p of foods) {
    const end = qtyOf(db, p.id);
    const expect = (opening[p.name] - (sold[p.id] || 0)) + 10;
    check(`Blerja +10 ${p.name}`, end === expect, { end, sold: sold[p.id] || 0, fatura: purchase.invoice_number || purchase.id }, expect);
  }

  const turn = advanced.getTurnoverReport(day, day);
  const turnRows = turn.products || turn.rows || [];
  for (const p of catalog) {
    const row = turnRows.find((r) => Number(r.product_id || r.menu_item_id || r.id) === Number(p.id) || r.name === p.name);
    const dbQty = qtyOf(db, p.id);
    if (!row && !(sold[p.id] || 0)) continue;
    check(`Qarkullimi ${p.name}`, !!row && Number(row.stock_qty) === dbQty, {
      raporti: row ? { qty: row.qty, xhiro: row.revenue, stoku: row.stock_qty } : null,
      db: dbQty,
      shitur: sold[p.id] || 0,
    }, dbQty);
  }

  const sumA = db.getWaiterShiftSummary(aId, { sessionRole: "kamarier" });
  const sumB = db.getWaiterShiftSummary(bId, { sessionRole: "kamarier" });
  db.closeWaiterShift(aId, sumA.expected_closing_cash, 0, { sessionRole: "kamarier" });
  db.closeWaiterShift(bId, sumB.expected_closing_cash, 0, { sessionRole: "kamarier" });
  const closedA = shiftOf(aId, day);
  const closedB = shiftOf(bId, day);
  const closedSum = money((closedA?.shitje_totale || 0) + (closedB?.shitje_totale || 0));
  const after = books(day);
  check("Kamarier A + Kamarier B = totali i restorantit", closedSum === tableSum, {
    a: closedA,
    b: closedB,
    shuma: closedSum,
    tavolinat: tableSum,
  }, tableSum);
  check("Ditari = Kontabilisti", after.ditari === after.kontabilisti, after, after.ditari);
  check("Restoranti në Ditari = shuma e restorantit", after.restorant === tableSum, {
    ditari_restorant: after.restorant,
    tavolinat: tableSum,
    ditari: after.ditari,
    recepsion: after.recepsion,
  }, tableSum);

  const failN = checks.filter((c) => c.result === "FAIL").length;
  const moneyOk = after.restorant === tableSum && after.ditari === after.kontabilisti && closedSum === tableSum;
  const score = moneyOk ? (failN === 0 ? 10 : 8) : Math.max(1, Math.round(((checks.length - failN) / checks.length) * 10));
  const report = {
    db: dbPath,
    day,
    tavolinat: tableSum,
    zbritje_t4: { total: money(t4.total), zbritje: money(t4.discount_total) },
    happy_t5: { total: money(t5.total), zbritje: money(t5.discount_total) },
    t7: { para: money(t7first.total), pas: money(t7second.total) },
    kanale: {
      takeaway: { tavolina: takeClosed.table, total: money(takeClosed.closed?.total) },
      qr: { tavolina: qrClosed.table, total: money(qrClosed.closed?.total) },
      web: { tavolina: webClosed.table, total: money(webClosed.closed?.total) },
    },
    foliot: { f101, f102, f103, f104, f105 },
    nderrimet: { a: closedA, b: closedB, shuma: closedSum },
    librat: after,
    shitjet: sales,
    ditari_rreshtat: ditariRows,
    stoku: catalog.map((p) => ({ name: p.name, start: opening[p.name], sold: sold[p.id] || 0, end: qtyOf(db, p.id) })),
    nota: score,
    kontrolle: `${checks.length - failN}/${checks.length}`,
    checks,
  };
  console.log(JSON.stringify(report, null, 2));
  console.log(`CHECKS ${checks.length - failN}/${checks.length} PASS`);
  console.log(`NOTA ${score}/10`);
  if (failN) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
