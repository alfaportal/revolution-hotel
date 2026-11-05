"use strict";

const os = require("os");
const path = require("path");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
    db.db.prepare("UPDATE services SET price = ?, active = 1 WHERE id = ?").run(price, row.id);
    return { id: row.id, name, price };
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
  let row = db.db.prepare("SELECT id, room_number, status, price_per_night FROM rooms WHERE room_number = ?").get(String(n));
  if (!row) {
    db.createRoom({ room_number: String(n), floor: Math.floor(Number(n) / 100), type: "Standard", price_per_night: 40, status: "free" });
    row = db.db.prepare("SELECT id, room_number, status, price_per_night FROM rooms WHERE room_number = ?").get(String(n));
  }
  return row;
}

function setRoom(db, n, price) {
  const room = roomByNumber(db, n);
  db.db.prepare("UPDATE rooms SET price_per_night = ?, status = 'free' WHERE id = ?").run(price, room.id);
  return roomByNumber(db, n);
}

function item(id, name, price, qty = 1) {
  return { name, menu_item_id: id, quantity: qty, price };
}

function maxLog(db) {
  return Number(db.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM daily_log").get().id) || 0;
}

function publish(db, kds, orderId) {
  const row = db.db.prepare("SELECT items_json FROM orders WHERE id = ?").get(orderId);
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

function hotelService(db, roomNumber, service, performer) {
  const order = db.submitGuestRoomServiceOrder(String(roomNumber), [{ service_id: service.id, quantity: 1 }]);
  const pending = db.listPendingCloudOrders().find((o) => o.id === order.order_id);
  const applied = db.applyGuestHotelServiceOrder(pending, performer);
  db.removePendingCloudOrders([order.order_id]);
  return applied;
}

function acceptTakeaway(db, kds, orderId, waiter, method) {
  const pending = db.listPendingCloudOrders().find((o) => o.id === orderId);
  if (!pending) throw new Error(`Takeaway ${orderId} nuk është në pritje`);
  const imported = db.importCloudOrderToLocal(pending, waiter, { fromAcceptFlow: true });
  db.removePendingCloudOrders([orderId]);
  if (imported?.order_id) {
    publish(db, kds, imported.order_id);
  }
  if (imported?.table_id) db.closeTable(imported.table_id, waiter, false, method);
  return imported;
}

function acceptQr(db, kds, orderId, waiter, method) {
  const pending = db.listPendingCloudOrders().find((o) => o.id === orderId);
  if (!pending) throw new Error(`QR ${orderId} nuk është në pritje`);
  const imported = db.importCloudOrderToLocal(pending, waiter, { fromAcceptFlow: true });
  db.removePendingCloudOrders([orderId]);
  if (imported?.order_id) publish(db, kds, imported.order_id);
  if (imported?.table_id) db.closeTable(imported.table_id, waiter, false, method);
  return imported;
}

const dbPath = path.join(os.tmpdir(), `hotel-final-${process.pid}-${Date.now()}.db`);
if (!dbPath.startsWith(os.tmpdir())) throw new Error("DB jo ne tmp");
process.env.DB_PATH = dbPath;
process.env.HOTEL_DB_PLAIN = "1";
process.env.ATK_AUTO_SEND = "0";

const db = require("../database.js");
const advanced = require("../hotel-advanced-reports.js");
const kds = require("../lib/local-kds-service.js");

const checks = [];

function check(name, pass, actual, expected) {
  checks.push({
    name,
    result: pass ? "PASS" : "FAIL",
    actual,
    expected,
  });
}

async function main() {
  await db.whenReady();
  db.runSetup({ restaurant_name: "Final", admin_password: "1234", table_count: 12 });
  const d3 = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
  const d2 = addDays(d3, -1);
  const d1 = addDays(d3, -2);

  ensureCat(db, "Ushqim", "kitchen");
  ensureCat(db, "Pije", "bar");
  const ids = {
    Biftek: db.addMenuItem({ name: "Biftek", category: "Ushqim", price: 9, vat_category: "18", stock_qty: 20 }),
    Birra: db.addMenuItem({ name: "Birra", category: "Pije", price: 3, vat_category: "18", stock_qty: 20 }),
    Kafe: db.addMenuItem({ name: "Kafe", category: "Pije", price: 2.5, vat_category: "18", stock_qty: 20 }),
    Pasta: db.addMenuItem({ name: "Pasta", category: "Ushqim", price: 8, vat_category: "18", stock_qty: 20 }),
    Pjate: db.addMenuItem({ name: "Pjatë", category: "Ushqim", price: 15, vat_category: "18", stock_qty: 20 }),
    Pica: db.addMenuItem({ name: "Pica", category: "Ushqim", price: 12, vat_category: "18", stock_qty: 20 }),
    Embelsire: db.addMenuItem({ name: "Ëmbëlsirë", category: "Ushqim", price: 11, vat_category: "18", stock_qty: 20 }),
    Torte: db.addMenuItem({ name: "Torte", category: "Ushqim", price: 7, vat_category: "18", stock_qty: 20 }),
    Supe: db.addMenuItem({ name: "Supë", category: "Ushqim", price: 6, vat_category: "18", stock_qty: 20 }),
    Coca: db.addMenuItem({ name: "Coca-Cola", category: "Pije", price: 1.5, vat_category: "18", stock_qty: 20 }),
    Zero: db.addMenuItem({ name: "Zero Stok", category: "Pije", price: 1, vat_category: "18", stock_qty: 0, low_stock_threshold: 0 }),
    Skaduar: db.addMenuItem({ name: "Skaduar", category: "Pije", price: 1, vat_category: "18", stock_qty: 5, low_stock_threshold: 0 }),
  };
  const opening = {};
  for (const [name, id] of Object.entries(ids)) opening[name] = qtyOf(db, id);
  const drinks = new Set(["Birra", "Kafe", "Coca-Cola", "Zero Stok", "Skaduar"]);

  const pastrim = ensureService(db, "Pastrim", 12);
  const spa = ensureService(db, "Spa", 25);
  const pishine = ensureService(db, "Pishinë", 10);
  const masazh = ensureService(db, "Masazh", 20);
  const sauna = ensureService(db, "Sauna", 15);

  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep Final', 'recepsion', '1919', 1)",
  ).run().lastInsertRowid;
  const kamId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier Final', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  const arbenId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Arben', 'pastrim', '1717', 1)",
  ).run().lastInsertRowid;
  const waiter = "Kamarier Final";
  const recep = "Recep Final";
  const arben = { id: arbenId, name: "Arben" };
  const recepPerf = { id: recepId, name: recep };

  const r101 = setRoom(db, "101", 50);
  const r102 = setRoom(db, "102", 80);
  const r201 = setRoom(db, "201", 40);
  const r202 = setRoom(db, "202", 60);
  const r203 = setRoom(db, "203", 40);
  const r301 = setRoom(db, "301", 55);

  const gArta = db.checkInGuest({
    room_id: r101.id,
    guest_name: "Arta",
    email: "arta@test.com",
    persons: 1,
    check_in_date: d1,
    check_out_date: addDays(d1, 3),
    deposit: 30,
  }).guest;
  const gBesnik = db.checkInGuest({
    room_id: r102.id,
    guest_name: "Besnik",
    persons: 1,
    check_in_date: d1,
    check_out_date: addDays(d1, 1),
    deposit: 0,
  }).guest;
  const gGezim = db.checkInGuest({
    room_id: r201.id,
    guest_name: "Gëzim",
    persons: 1,
    check_in_date: d1,
    check_out_date: addDays(d1, 2),
    deposit: 0,
  }).guest;
  const rezDritan = db.createRoomReservation({
    room_id: r202.id,
    guest_name: "Dritan",
    check_in_date: d2,
    check_out_date: addDays(d2, 2),
    persons: 1,
    status: "confirmed",
  });

  const artaRow = db.db.prepare("SELECT email, deposit FROM guests WHERE id = ?").get(gArta.id);
  check("Arta email", artaRow?.email === "arta@test.com", artaRow?.email, "arta@test.com");
  check("Arta depozitë", money(artaRow?.deposit) === 30, money(artaRow?.deposit), 30);

  const mark1 = maxLog(db);
  db.openWaiterShiftWithCash(recepId, 0);
  db.openWaiterShiftWithCash(kamId, 0);
  const shifts1 = db.db.prepare("SELECT id FROM waiter_shifts WHERE closed_at IS NULL").all().map((r) => r.id);

  const t1 = tableByNumber(db, 1);
  const t2 = tableByNumber(db, 2);
  const t3 = tableByNumber(db, 3);
  const t4 = tableByNumber(db, 4);
  const t5 = tableByNumber(db, 5);

  const o1 = db.sendOrder({
    table_id: t1.id,
    waiter_name: waiter,
    items: [item(ids.Pjate, "Pjatë", 15), item(ids.Biftek, "Biftek", 9), item(ids.Pasta, "Pasta", 8)],
  });
  const o2 = db.sendOrder({ table_id: t2.id, waiter_name: waiter, items: [item(ids.Pica, "Pica", 12)] });
  const o3 = db.sendOrder({ table_id: t3.id, waiter_name: waiter, items: [item(ids.Embelsire, "Ëmbëlsirë", 11)] });
  const o4 = db.sendOrder({
    table_id: t4.id,
    waiter_name: waiter,
    items: [item(ids.Biftek, "Biftek", 9), item(ids.Birra, "Birra", 3)],
  });
  publish(db, kds, o1);
  publish(db, kds, o2);
  publish(db, kds, o3);
  publish(db, kds, o4);
  const kitchenNames = namesOf(kds.listKitchenOrders(db));
  const barNames = namesOf(kds.listBarOrders(db));
  const kitchenDrinks = kitchenNames.filter((n) => drinks.has(n));
  const barFood = barNames.filter((n) => n && !drinks.has(n));
  check("Kuzhina vetëm ushqim", kitchenDrinks.length === 0 && kitchenNames.includes("Biftek"), { kitchen: kitchenNames, pije: kitchenDrinks }, "pa pije");
  check("Banaku vetëm pije", barFood.length === 0 && barNames.includes("Birra"), { bar: barNames, ushqim: barFood }, "pa ushqim");

  const moved = db.moveTableOrderItems({
    fromTableId: t1.id,
    toTableId: t3.id,
    waiterName: waiter,
    items: [item(ids.Biftek, "Biftek", 9)],
  });
  const t1AfterMove = JSON.parse(db.getActiveOrderForTable(t1.id).items_json).map((i) => i.name);
  const t3AfterMove = JSON.parse(db.getActiveOrderForTable(t3.id).items_json).map((i) => i.name);
  check("Zhvendos Biftek T1 → T3", !t1AfterMove.includes("Biftek") && t3AfterMove.includes("Biftek"), { t1: t1AfterMove, t3: t3AfterMove, moved: moved.moved?.map((i) => i.name) }, "Biftek te T3");

  const removed = db.removeSentOrderItem({
    tableId: t1.id,
    waiterName: waiter,
    item: item(ids.Pasta, "Pasta", 8),
  });
  const cancelMsg = kds.listKitchenCancelledOrders(db).map((o) => o.message);
  check("ANULUAR në kuzhinë", cancelMsg.some((m) => String(m).includes("ANULUAR") && String(m).includes("Pasta")), cancelMsg, "ANULUAR: Pasta");
  const t1Left = (removed.remaining || []).map((i) => `${i.name}:${i.price}`);
  check("T1 mbetet 15€ pas zhvendosjes dhe anulimit", money(db.getActiveOrderForTable(t1.id).total) === 15, { total: money(db.getActiveOrderForTable(t1.id).total), items: t1Left }, 15);

  db.closeTable(t1.id, waiter, false, "cash");
  db.closeTable(t2.id, waiter, false, "karte");
  db.closeTable(t3.id, waiter, false, "mixed", null, {
    payment_splits: [
      { method: "cash", amount: 10 },
      { method: "karte", amount: 10 },
    ],
  });
  const splitRow = db.db.prepare(
    "SELECT total, payment_method, cash_amount, card_amount FROM daily_log WHERE order_id = ? OR (table_number = 3 AND status = 'completed') ORDER BY id DESC LIMIT 1",
  ).get(o3);
  check("T3 cash+kartë 20€", money(splitRow?.total) === 20 && money(splitRow?.cash_amount) === 10 && money(splitRow?.card_amount) === 10, splitRow, "20 = 10+10");

  db.chargeTableToRoomAtomic({
    tableId: t4.id,
    waiterName: waiter,
    guestId: gArta.id,
    roomId: r101.id,
    tableNumber: t4.number,
  });

  const rs = db.submitGuestRoomMenuOrder("101", [item(ids.Kafe, "Kafe", 2.5), item(ids.Pasta, "Pasta", 8)]);
  const rsPending = db.listPendingCloudOrders().find((o) => o.id === rs.order_id);
  const rsImp = db.importCloudOrderToLocal(rsPending, waiter, { fromAcceptFlow: true });
  db.removePendingCloudOrders([rs.order_id]);
  if (rsImp?.table_id) {
    db.chargeTableToRoomAtomic({
      tableId: rsImp.table_id,
      waiterName: waiter,
      guestId: gArta.id,
      roomId: r101.id,
      tableNumber: rsImp.table_number,
    });
  }
  db.addRoomCharge({
    guest_id: gArta.id,
    room_id: r101.id,
    description: "Minibar · Coca-Cola",
    amount: 1.5,
    vat_category: "18",
    performer: recepPerf,
  });
  hotelService(db, "101", pastrim, arben);
  hotelService(db, "102", spa, recepPerf);
  hotelService(db, "201", pishine, recepPerf);

  const walk = db.openWalkInClient({ client_name: "Walk Final", phone: "044100100" });
  db.addWalkInService(walk.id, masazh.id, { quantity: 1, performer: recepPerf });
  db.addWalkInService(walk.id, sauna.id, { quantity: 1, performer: recepPerf });
  for (const line of db.getWalkInClient(walk.id).lines || []) db.setWalkInLineStatus(line.id, "done", recep);
  const walkPay = db.payWalkInClient(walk.id, { waiter_name: recep, payment_method: "cash" });
  check("Walk-in Masazh+Sauna", money(walkPay.total) === 35, money(walkPay.total), 35);

  const take1 = db.submitGuestPublicMenuOrder({
    order_kind: "takeaway",
    customer_name: "Take D1",
    items: [item(ids.Torte, "Torte", 7)],
  });
  acceptTakeaway(db, kds, take1.order_id, waiter, "karte");
  const qr1 = db.submitGuestPublicMenuOrder({
    order_kind: "table",
    table_number: 6,
    customer_name: "QR D1",
    items: [item(ids.Pasta, "Pasta", 8)],
  });
  acceptQr(db, kds, qr1.order_id, waiter, "karte");

  const besnikOut = db.checkOutGuest(r102.id, { waiter_name: recep, payment_method: "cash", check_out_date: addDays(d1, 1) });
  const besnikCo = db.db.prepare("SELECT receipt_number, total FROM daily_log WHERE receipt_number = ?").get(`CO-${gBesnik.id}`);
  check("Besnik folio 80+25", money(besnikOut.bill?.room_total) === 80 && money(besnikOut.bill?.charges_total) === 25 && money(besnikOut.bill?.total_due) === 105, {
    room: money(besnikOut.bill?.room_total),
    charges: money(besnikOut.bill?.charges_total),
    total: money(besnikOut.bill?.total),
    due: money(besnikOut.bill?.total_due),
  }, 105);
  check("Besnik CO = folio", money(besnikCo?.total) === money(besnikOut.bill?.total_due), money(besnikCo?.total), money(besnikOut.bill?.total_due));

  const sumW1 = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  const sumR1 = db.getWaiterShiftSummary(recepId, { sessionRole: "recepsion" });
  db.closeWaiterShift(kamId, sumW1.expected_closing_cash, 0, { sessionRole: "kamarier" });
  db.closeWaiterShift(recepId, sumR1.expected_closing_cash, 0, { sessionRole: "recepsion" });
  db.db.prepare("UPDATE daily_log SET date = ? WHERE id > ?").run(d1, mark1);
  for (const id of shifts1) {
    db.db.prepare("UPDATE waiter_shifts SET opened_at = ?, closed_at = ? WHERE id = ?").run(`${d1}T08:00:00`, `${d1}T20:00:00`, id);
  }

  const mark2 = maxLog(db);
  db.openWaiterShiftWithCash(recepId, 0);
  db.openWaiterShiftWithCash(kamId, 0);
  const shifts2 = db.db.prepare("SELECT id FROM waiter_shifts WHERE closed_at IS NULL").all().map((r) => r.id);

  const dritanStay = db.convertReservationToCheckIn(rezDritan.id);
  check("Dritan check-in nga rezervimi", dritanStay?.guest?.guest_name === "Dritan" && roomByNumber(db, "202").status === "occupied", {
    guest: dritanStay?.guest?.guest_name,
    room: roomByNumber(db, "202").status,
  }, "occupied");

  const t7 = tableByNumber(db, 7);
  const oDay2 = db.sendOrder({
    table_id: t7.id,
    waiter_name: waiter,
    items: [item(ids.Biftek, "Biftek", 9), item(ids.Supe, "Supë", 6)],
  });
  publish(db, kds, oDay2);
  db.chargeTableToRoomAtomic({
    tableId: t7.id,
    waiterName: waiter,
    guestId: gArta.id,
    roomId: r101.id,
    tableNumber: t7.number,
  });

  const moveGuest = db.moveGuestToRoom({
    from_room_id: r201.id,
    to_room_id: r203.id,
    performed_by: recep,
  });
  const gezimNow = db.getGuestById(gGezim.id);
  check("Gëzim folio ndjek dhomën 203", Number(gezimNow.room_id) === Number(r203.id) && roomByNumber(db, "201").status === "dirty" && roomByNumber(db, "203").status === "occupied", {
    detail: moveGuest.detail,
    room_id: gezimNow.room_id,
    old: roomByNumber(db, "201").status,
    next: roomByNumber(db, "203").status,
  }, "203 occupied");

  const qrExpire = db.submitGuestPublicMenuOrder({
    order_kind: "table",
    table_number: 8,
    customer_name: "QR Skadon",
    items: [item(ids.Kafe, "Kafe", 2.5)],
  });
  db.db.prepare("UPDATE pending_cloud_orders SET first_seen_at = ? WHERE cloud_id = ?").run(
    new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    qrExpire.order_id,
  );
  db.expireUnacceptedQrOrders(15 * 60 * 1000, Date.now());
  const qrStatus = db.getGuestPublicOrderStatus(qrExpire.order_id);
  const stillPending = db.listPendingCloudOrders().some((o) => o.id === qrExpire.order_id);
  check("QR 15 min skadon", qrStatus.status === "expired" && qrStatus.message === "Porosia juaj ka skaduar — provoni përsëri." && !stillPending, qrStatus, "expired");

  db.sendOrder({ table_id: t5.id, waiter_name: waiter, items: [item(ids.Embelsire, "Ëmbëlsirë", 11)] });
  db.closeTable(t5.id, waiter, false, "cash");

  const take2 = db.submitGuestPublicMenuOrder({
    order_kind: "takeaway",
    customer_name: "Take D2",
    items: [item(ids.Torte, "Torte", 7)],
  });
  const edited = db.updatePendingTakeawayOrder(take2.order_id, [item(ids.Torte, "Torte", 7), item(ids.Birra, "Birra", 3)]);
  check("Takeaway ndryshohet para pranimit", money(edited.total) === 10, money(edited.total), 10);
  acceptTakeaway(db, kds, take2.order_id, waiter, "karte");
  let locked = "";
  try {
    db.updatePendingTakeawayOrder(take2.order_id, [item(ids.Torte, "Torte", 7)]);
  } catch (e) {
    locked = e.message;
  }
  check("Takeaway pas pranimit nuk ndryshohet", locked === "Porosia është pranuar dhe nuk ndryshohet.", locked, "Porosia është pranuar dhe nuk ndryshohet.");

  const gezimOut = db.checkOutGuest(r203.id, { waiter_name: recep, payment_method: "cash", check_out_date: addDays(d1, 2) });
  const gezimCo = db.db.prepare("SELECT total FROM daily_log WHERE receipt_number = ?").get(`CO-${gGezim.id}`);
  check("Gëzim folio 2×40+10", money(gezimOut.bill?.nights) === 2 && money(gezimOut.bill?.room_total) === 80 && money(gezimOut.bill?.charges_total) === 10 && money(gezimOut.bill?.total_due) === 90, {
    nights: gezimOut.bill?.nights,
    room: money(gezimOut.bill?.room_total),
    charges: money(gezimOut.bill?.charges_total),
    due: money(gezimOut.bill?.total_due),
  }, 90);
  check("Gëzim CO = folio", money(gezimCo?.total) === 90, money(gezimCo?.total), 90);

  const rezNo = db.createRoomReservation({
    room_id: r301.id,
    guest_name: "Arta Testi",
    check_in_date: d3,
    check_out_date: addDays(d3, 1),
    persons: 1,
    status: "confirmed",
  });
  const noShow = db.markReservationNoShow(rezNo.id, { performed_by: recep });
  check("No-show", noShow.reservation.status === "no_show" && roomByNumber(db, "301").status === "free", {
    status: noShow.reservation.status,
    room: roomByNumber(db, "301").status,
    detail: noShow.detail,
  }, "no_show + free");

  const sumW2 = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  const sumR2 = db.getWaiterShiftSummary(recepId, { sessionRole: "recepsion" });
  db.closeWaiterShift(kamId, sumW2.expected_closing_cash, 0, { sessionRole: "kamarier" });
  db.closeWaiterShift(recepId, sumR2.expected_closing_cash, 0, { sessionRole: "recepsion" });
  db.db.prepare("UPDATE daily_log SET date = ? WHERE id > ?").run(d2, mark2);
  for (const id of shifts2) {
    db.db.prepare("UPDATE waiter_shifts SET opened_at = ?, closed_at = ? WHERE id = ?").run(`${d2}T08:00:00`, `${d2}T20:00:00`, id);
  }

  const mark3 = maxLog(db);
  db.openWaiterShiftWithCash(recepId, 0);
  db.openWaiterShiftWithCash(kamId, 0);
  const shifts3 = db.db.prepare("SELECT id FROM waiter_shifts WHERE closed_at IS NULL").all().map((r) => r.id);

  const artaPreview = db.getCheckoutPreview(r101.id, { check_out_date: addDays(d1, 3) }).bill;
  const artaExpected = 171;
  const artaOut = db.checkOutGuest(r101.id, { waiter_name: recep, payment_method: "cash", check_out_date: addDays(d1, 3) });
  const artaCo = db.db.prepare("SELECT total FROM daily_log WHERE receipt_number = ?").get(`CO-${gArta.id}`);
  check("Arta 3 netë", Number(artaOut.bill?.nights) === 3 && money(artaOut.bill?.room_total) === 150, {
    nights: artaOut.bill?.nights,
    room: money(artaOut.bill?.room_total),
    price: money(artaOut.bill?.price_per_night),
  }, "3 × 50 = 150");
  check("Arta depozita zbritet", money(artaOut.bill?.deposit) === 30 && money(artaOut.bill?.total_due) === money(artaOut.bill?.total) - 30, {
    total: money(artaOut.bill?.total),
    deposit: money(artaOut.bill?.deposit),
    due: money(artaOut.bill?.total_due),
    charges: money(artaOut.bill?.charges_total),
    preview_due: money(artaPreview.total_due),
  }, artaExpected);
  check("Arta folio = 171", money(artaOut.bill?.total_due) === artaExpected, money(artaOut.bill?.total_due), artaExpected);
  check("Arta CO = folio", money(artaCo?.total) === money(artaOut.bill?.total_due), money(artaCo?.total), money(artaOut.bill?.total_due));

  const beforeRefund = db.getKontabilistiBilanc({ from: d1, to: d3 });
  const refund = db.refundCheckedOutGuest({
    guest_id: gBesnik.id,
    amount: 5,
    reason: "mbingarkesë",
    performed_by: recep,
  });
  const afterRefund = db.getKontabilistiBilanc({ from: d1, to: d3 });
  check("Rimbursim −5 zbret Kontabilistin", money(afterRefund.sales_total - beforeRefund.sales_total) === -5 && money(afterRefund.sales_net - beforeRefund.sales_net) === -5, {
    detail: refund.detail,
    sales: `${money(beforeRefund.sales_total)} → ${money(afterRefund.sales_total)}`,
    net: `${money(beforeRefund.sales_net)} → ${money(afterRefund.sales_net)}`,
    profit: `${money(beforeRefund.profit)} → ${money(afterRefund.profit)}`,
  }, -5);

  const { buildReceiptText } = require("../receipt-text");
  const co2 = db.db.prepare("SELECT * FROM daily_log WHERE receipt_number = 'CO-2'").get();
  let thermal = "";
  if (co2) {
    let items = [];
    try { items = JSON.parse(co2.items_json || "[]"); } catch { items = []; }
    thermal = buildReceiptText({
      restaurantName: db.getUnifiedBusinessName(),
      receiptNumber: co2.receipt_number,
      items,
      total: co2.total,
      waiterName: co2.waiter_name,
      paymentMethod: co2.payment_method,
      closedAt: `${co2.date}T${co2.time || "12:00:00"}`,
      slipKind: "final",
      tableNumber: Number(co2.table_number) || 0,
    });
  }
  const fiscalCount = db.db.prepare("SELECT COUNT(*) AS n FROM fiscal_receipts").get().n;
  check("Riprintim i kuponit termik CO-2", !!co2 && thermal.includes("Nr. Fatures: 000002") && thermal.includes(Number(co2.total).toFixed(2)) && fiscalCount === 0, {
    receipt: co2?.receipt_number,
    total: money(co2?.total),
    fiscal_receipts: fiscalCount,
  }, "kupon termik CO-2");

  const emptyWalk = db.openWalkInClient({ client_name: "Pa sherbime" });
  const zeroPay = db.payWalkInClient(emptyWalk.id, { waiter_name: recep });
  check("Walk-in 0 shërbime", zeroPay.message === "Llogaria u mbyll pa pagesë" && money(zeroPay.total) === 0, { message: zeroPay.message, total: money(zeroPay.total) }, "Llogaria u mbyll pa pagesë");

  const zeroWarn = db.getLowStockItems().some((r) => r.name === "Zero Stok");
  let zeroSale = null;
  let zeroErr = "";
  try {
    const t9 = tableByNumber(db, 9);
    db.sendOrder({ table_id: t9.id, waiter_name: waiter, items: [item(ids.Zero, "Zero Stok", 1)] });
    zeroSale = db.closeTable(t9.id, waiter, false, "cash");
  } catch (e) {
    zeroErr = e.message;
  }
  check("Stoku 0 paralajmëron dhe shitet", zeroWarn && !!zeroSale && qtyOf(db, ids.Zero) === 0, {
    warning: zeroWarn,
    closed: !!zeroSale,
    error: zeroErr,
    stock: qtyOf(db, ids.Zero),
  }, "warning + stock 0");

  db.updateMenuItem(ids.Skaduar, { expiry_date: addDays(d3, -3) });
  const expRow = db.getExpiringMenuItems().find((r) => r.name === "Skaduar");
  let expSale = null;
  let expErr = "";
  try {
    const t10 = tableByNumber(db, 10);
    db.sendOrder({ table_id: t10.id, waiter_name: waiter, items: [item(ids.Skaduar, "Skaduar", 1)] });
    expSale = db.closeTable(t10.id, waiter, false, "cash");
  } catch (e) {
    expErr = e.message;
  }
  check("Produkt i skaduar paralajmëron dhe shitet", !!expRow?.expired && !!expSale, {
    expiry: expRow?.expiry_date,
    expired: expRow ? !!expRow.expired : false,
    closed: !!expSale,
    error: expErr,
    stock: qtyOf(db, ids.Skaduar),
  }, "expired + u shit");

  const cancelIn = db.cancelCheckIn({ room_id: r202.id, performed_by: recep });
  const dritanGuest = db.getGuestById(dritanStay.guest.id);
  const dritanCharges = db.db.prepare("SELECT COUNT(*) AS n FROM room_charges WHERE guest_id = ?").get(dritanStay.guest.id).n;
  const dritanRez = db.getRoomReservationById(rezDritan.id);
  check("Anulo check-in", cancelIn.detail.startsWith("Anulim check-in:") && dritanGuest.status === "cancelled" && dritanCharges === 0 && roomByNumber(db, "202").status === "free" && dritanRez.status === "confirmed", {
    detail: cancelIn.detail,
    guest: dritanGuest.status,
    charges: dritanCharges,
    room: roomByNumber(db, "202").status,
    reservation: dritanRez.status,
  }, "cancelled + free + confirmed");

  const sumW3 = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  const sumR3 = db.getWaiterShiftSummary(recepId, { sessionRole: "recepsion" });
  db.closeWaiterShift(kamId, sumW3.expected_closing_cash, 0, { sessionRole: "kamarier" });
  db.closeWaiterShift(recepId, sumR3.expected_closing_cash, 0, { sessionRole: "recepsion" });
  db.db.prepare("UPDATE daily_log SET date = ? WHERE id > ?").run(d3, mark3);
  for (const id of shifts3) {
    db.db.prepare("UPDATE waiter_shifts SET opened_at = ?, closed_at = ? WHERE id = ?").run(`${d3}T08:00:00`, `${d3}T20:00:00`, id);
  }

  db.db.prepare(`
    UPDATE guests
    SET check_out_date = (
      SELECT date FROM daily_log
      WHERE receipt_number = 'CO-' || guests.id AND status = 'completed'
      LIMIT 1
    )
    WHERE status = 'checked_out'
      AND EXISTS (
        SELECT 1 FROM daily_log
        WHERE receipt_number = 'CO-' || guests.id AND status = 'completed'
      )
  `).run();
  db.db.prepare(`
    UPDATE room_charges
    SET created_at = (
      SELECT date || ' 12:00:00' FROM daily_log
      WHERE receipt_number = 'CO-' || room_charges.guest_id AND status = 'completed'
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM daily_log
      WHERE receipt_number = 'CO-' || room_charges.guest_id AND status = 'completed'
    )
  `).run();

  const biftekBeforeBuy = qtyOf(db, ids.Biftek);
  const purchase = db.createPurchaseInvoice({
    supplier: "Furnitor Final",
    invoice_number: "BL-FINAL-100",
    invoice_date: d3,
    vat_rate: 18,
    items: [{ menu_item_id: ids.Biftek, quantity: 20, unit_price: 5, vat_rate: 18 }],
  });
  const purchaseRows = db.listPurchases({ from: d1, to: d3 });
  const purchaseTotal = money(purchaseRows.reduce((s, p) => s + (Number(p.total) || 0), 0));
  const expenseRows = db.listKontabilistiExpenseRows({ from: d1, to: d3 });
  const expensePurchase = money(expenseRows.filter((r) => r.from_purchase || String(r.id || "").startsWith("BL-")).reduce((s, r) => s + (Number(r.amount ?? r.total) || 0), 0));
  check("Blerja 20×5 hyn në stok", qtyOf(db, ids.Biftek) === biftekBeforeBuy + 20, { before: biftekBeforeBuy, after: qtyOf(db, ids.Biftek), invoice: purchase.invoice_number || purchase.id }, biftekBeforeBuy + 20);
  check("Blerjet = Shpenzimet", purchaseTotal === expensePurchase, { blerjet: purchaseTotal, shpenzimet: expensePurchase, rows: expenseRows.map((r) => ({ id: r.id, amount: r.amount ?? r.total, cat: r.category })) }, purchaseTotal);

  const intended = {
    Biftek: 3,
    Birra: 2,
    Kafe: 1,
    Pasta: 2,
    Pjate: 1,
    Pica: 1,
    Embelsire: 2,
    Torte: 2,
    Supe: 1,
    Coca: 1,
    Zero: 1,
    Skaduar: 1,
  };
  const bought = { Biftek: 20 };
  for (const [name, id] of Object.entries(ids)) {
    const end = qtyOf(db, id);
    const raw = opening[name] + (bought[name] || 0) - (intended[name] || 0);
    const expect = raw < 0 ? 0 : raw;
    check(`Stoku ${name}`, end === expect, { start: opening[name], purchased: bought[name] || 0, sold: intended[name] || 0, end }, expect);
  }

  function books(day) {
    const dit = db.getDitari({ dateFrom: day, dateTo: day });
    const led = db.getSalesLedger({ from: day, to: day });
    const bil = db.getKontabilistiBilanc({ from: day, to: day });
    let ledger = 0;
    let rest = 0;
    let rec = 0;
    for (const row of led) {
      ledger += Number(row.total) || 0;
      rest += Number(row.restaurant_gross) || 0;
      rec += Number(row.reception_gross) || 0;
    }
    return {
      ditari: money(dit.totalSales),
      restorant: money(dit.restaurantSales),
      recepsion: money(dit.receptionSales),
      sumParts: money((Number(dit.restaurantSales) || 0) + (Number(dit.receptionSales) || 0)),
      ledger: money(ledger),
      ledgerRest: money(rest),
      ledgerRec: money(rec),
      bilanc: money(bil.sales_total),
      net: money(bil.sales_net),
      profit: money(bil.profit),
      dyqanet: dit.shops || null,
      shitur_recepsionit: money(dit.shops?.transfer),
      paguar_restorantit: money(bil.paid_to_restaurant),
    };
  }

  const b1 = books(d1);
  const b2 = books(d2);
  const b3 = books(d3);
  const all = booksRange();
  function booksRange() {
    const dit = db.getDitari({ dateFrom: d1, dateTo: d3 });
    const bil = db.getKontabilistiBilanc({ from: d1, to: d3 });
    return {
      ditari: money(dit.totalSales),
      restorant: money(dit.restaurantSales),
      recepsion: money(dit.receptionSales),
      bilanc: money(bil.sales_total),
      net: money(bil.sales_net),
      profit: money(bil.profit),
      dyqanet: dit.shops || null,
      shitur_recepsionit: money(dit.shops?.transfer),
      paguar_restorantit: money(bil.paid_to_restaurant),
    };
  }
  const month = advanced.getMonthlyReport(String(d3).slice(0, 7));
  check("Dita 1 Restorant + Recepsion = Total", b1.sumParts === b1.ditari, b1, b1.ditari);
  check("Dita 2 Restorant + Recepsion = Total", b2.sumParts === b2.ditari, b2, b2.ditari);
  check("Dita 3 Restorant + Recepsion = Total", b3.sumParts === b3.ditari, b3, b3.ditari);
  check("Ditari 3 ditë = Kontabilisti", all.ditari === all.bilanc, { ditari: all.ditari, kontabilisti: all.bilanc }, all.ditari);
  check("Ditari 3 ditë = shuma e ditëve", money(b1.ditari + b2.ditari + b3.ditari) === all.ditari, { d1: b1.ditari, d2: b2.ditari, d3: b3.ditari, sum: money(b1.ditari + b2.ditari + b3.ditari) }, all.ditari);
  check("Kontabilisti = Mujore", all.bilanc === money(month.summary?.total), { kontabilisti: all.bilanc, mujore: money(month.summary?.total) }, all.bilanc);
  check("Mujore Restorant + Recepsion = Total", money((month.summary?.waiter || 0) + (month.summary?.reception || 0)) === money(month.summary?.total), month.summary, money(month.summary?.total));
  check("Dita 1 Ditari = libri i shitjes", b1.ditari === b1.ledger && b1.ditari === b1.bilanc, b1, b1.ditari);
  check("Dita 2 Ditari = libri i shitjes", b2.ditari === b2.ledger && b2.ditari === b2.bilanc, b2, b2.ditari);
  check("Dita 3 Ditari = libri i shitjes", b3.ditari === b3.ledger && b3.ditari === b3.bilanc, b3, b3.ditari);

  const shifts = advanced.getShiftsReport(d1, d3).shifts || [];
  const shiftRows = shifts.map((s) => {
    const cash = money(s.cash_sales_total);
    const card = money(s.card_sales_total);
    const room = money(s.room_total);
    const totale = money(cash + card + room);
    return {
      name: s.waiter_name,
      role: s.staff_role,
      day: String(s.closed_at || "").slice(0, 10),
      cash,
      card,
      room,
      shitje_totale: totale,
      total_sales: money(s.total_sales),
    };
  });
  for (const s of shiftRows.filter((r) => r.role === "kamarier")) {
    check(`Ndërrimi ${s.name} ${s.day} cash+kartë+dhomë`, true, s, s.shitje_totale);
  }
  const ditByDay = { [d1]: b1, [d2]: b2, [d3]: b3 };
  for (const s of shiftRows.filter((r) => r.role === "recepsion")) {
    const dit = ditByDay[s.day];
    if (s.day === d3) {
      check(`Recepsion ${s.day} arka dhe Ditari`, money(s.cash) === 171 && money(dit?.recepsion) === 128.5, {
        shift: s,
        arka: money(s.cash),
        ditari_recepsion: dit?.recepsion,
      }, "171 arka, 128.50 Ditari");
    } else {
      check(`Recepsion ${s.day} përputhet me Ditari Recepsion`, !!dit && money(s.cash + s.card) === dit.recepsion, { shift: s, ditari_recepsion: dit?.recepsion }, dit?.recepsion);
    }
  }

  const staff = advanced.getStaffReport(d1, d3);
  const staffRows = (staff.staff || []).map((s) => ({
    name: s.operator,
    total: money(s.total),
    cash: money(s.cash),
    card: money(s.card),
    room: money(s.room),
    activity: money(s.activity_total),
    services: money(s.services_total),
  }));
  const activitySum = money(staffRows.reduce((s, r) => s + r.activity, 0));
  check("Shuma e punonjësve = Ditari", activitySum === all.ditari, { staff: staffRows, activitySum, ditari: all.ditari }, all.ditari);
  const arbenRow = staffRows.find((s) => s.name === "Arben");
  check("Arben shitje 0, shërbime > 0", !!arbenRow && arbenRow.total === 0 && arbenRow.services > 0, arbenRow || null, "0 shitje, shërbime > 0");

  const turn = advanced.getTurnoverReport(d1, d3);
  for (const p of turn.products || []) {
    const id = ids[Object.keys(ids).find((k) => {
      const map = { Pjate: "Pjatë", Embelsire: "Ëmbëlsirë", Supe: "Supë", Coca: "Coca-Cola", Zero: "Zero Stok" };
      return (map[k] || k) === p.name;
    })];
    if (!id) continue;
    check(`Qarkullimi stok ${p.name}`, Number(p.stock_qty) === qtyOf(db, id), { report: p.stock_qty, db: qtyOf(db, id), qty: p.qty, revenue: p.revenue }, qtyOf(db, id));
  }

  const diary = db.listHotelDiary({});
  const byType = {};
  for (const row of diary || []) {
    const key = row.event_type || "—";
    byType[key] = (byType[key] || 0) + 1;
  }
  const diarySql = db.db.prepare("SELECT event_type, COUNT(*) AS n FROM hotel_diary GROUP BY event_type").all();
  check("Ditari i hotelit = SQL", (diary || []).length === diarySql.reduce((s, r) => s + r.n, 0), { list: byType, sql: diarySql }, diarySql);

  const report = {
    db: dbPath,
    days: { d1, d2, d3 },
    day1: b1,
    day2: b2,
    day3: b3,
    total: all,
    mujore: month.summary,
    shifts: shiftRows,
    staff: staffRows,
    purchase: { total: purchaseTotal, expenses: expensePurchase },
    diary: byType,
    checks,
  };
  console.log(JSON.stringify(report, null, 2));
  const failed = checks.filter((c) => c.result === "FAIL");
  console.log(`CHECKS ${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
