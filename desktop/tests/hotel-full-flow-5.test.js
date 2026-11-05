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

function sumLedger(rows) {
  return money((rows || []).reduce((s, r) => s + (Number(r.total) || 0), 0));
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-full-flow-5-${process.pid}-${Date.now()}.db`);
  if (!dbPath.startsWith(os.tmpdir())) throw new Error("DB jo ne tmp");
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  delete require.cache[require.resolve("../hotel-advanced-reports.js")];
  const db = require("../database.js");
  const advanced = require("../hotel-advanced-reports.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Flow 5 Fiktiv", admin_password: "1234", table_count: 8 });

  const day = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
  const tomorrow = addDays(day, 1);
  const checks = [];
  const stockLog = [];
  const note = (id, ok, actual, expected) => {
    checks.push({ id, ok: !!ok, actual, expected });
  };

  function qty(id) {
    const row = db.db.prepare("SELECT COALESCE(stock_qty, 0) AS q FROM menu_items WHERE id = ?").get(id);
    return Number(row?.q) || 0;
  }
  function snap(label, ids) {
    const row = { label };
    for (const [name, id] of Object.entries(ids)) row[name] = qty(id);
    stockLog.push(row);
  }

  const room102 = db.db.prepare("SELECT id FROM rooms WHERE room_number = '102'").get();
  const room201 = db.db.prepare("SELECT id FROM rooms WHERE room_number = '201'").get();
  if (!room102 || !room201) throw new Error("Dhomat 102/201 mungojne");
  db.db.prepare("UPDATE rooms SET price_per_night = 50, status = 'free' WHERE id = ?").run(room102.id);
  db.db.prepare("UPDATE rooms SET price_per_night = 40, status = 'free' WHERE id = ?").run(room201.id);

  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep Testi', 'recepsion', '1919', 1)",
  ).run().lastInsertRowid;
  const kamarierId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier Testi', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  const arbenId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Arben', 'recepsion', '1717', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 100);
  db.openWaiterShiftWithCash(kamarierId, 50);

  for (const name of ["Pije", "Ushqim", "Minibar"]) {
    if (!db.db.prepare("SELECT id FROM categories WHERE name = ?").get(name)) db.addCategory(name);
  }
  const kafe = db.addMenuItem({ name: "Kafe", category: "Pije", price: 2.5, vat_category: "18", stock_qty: 10 });
  const sanduic = db.addMenuItem({ name: "Sanduiç", category: "Ushqim", price: 4, vat_category: "18", stock_qty: 10 });
  const coca = db.addMenuItem({ name: "Coca-Cola", category: "Minibar", price: 1.5, vat_category: "18", stock_qty: 10 });
  const biftek = db.addMenuItem({ name: "Biftek", category: "Ushqim", price: 9, vat_category: "18", stock_qty: 10 });
  const sallate = db.addMenuItem({ name: "Sallatë", category: "Ushqim", price: 4, vat_category: "18", stock_qty: 10 });
  const mini5 = db.addMenuItem({ name: "Minibar Besnik", category: "Minibar", price: 5, vat_category: "18", stock_qty: 10 });
  const pasta = db.addMenuItem({ name: "Pasta", category: "Ushqim", price: 8, vat_category: "18", stock_qty: 10 });
  const birra = db.addMenuItem({ name: "Birra", category: "Pije", price: 3, vat_category: "18", stock_qty: 10 });
  const ids = { kafe, sanduic, coca, biftek, sallate, mini5, pasta, birra };
  const pastrim = db.createHotelService({ name: "Pastrim", price: 12, vat_category: "18" });
  const pishine = db.createHotelService({ name: "Pishinë", price: 10, vat_category: "18" });
  const spa = db.createHotelService({ name: "Spa", price: 25, vat_category: "18" });
  snap("start", ids);

  const table5 = db.db.prepare("SELECT id, number FROM tables WHERE number = 5").get();
  const tableRoom = db.db.prepare("SELECT id, number FROM tables WHERE number = 1").get();
  if (!table5 || !tableRoom) throw new Error("Tavolinat 1/5 mungojne");

  const t1 = {};
  const stay = db.checkInGuest({
    room_id: room102.id,
    guest_name: "Arta Testi",
    email: "arta@test.com",
    persons: 1,
    check_in_date: day,
    check_out_date: addDays(day, 2),
    deposit: 0,
  });
  const guest = stay.guest;
  t1.email = guest.email;
  t1.nights_dates = { in: guest.check_in_date, out: guest.check_out_date };

  const rs = db.submitGuestRoomMenuOrder("102", [
    { name: "Kafe", quantity: 1, price: 2.5, menu_item_id: kafe },
    { name: "Sanduiç", quantity: 1, price: 4, menu_item_id: sanduic },
  ]);
  const rsPending = db.listPendingCloudOrders().find((o) => o.id === rs.order_id);
  const importedRs = db.importCloudOrderToLocal(rsPending, "Kamarier Testi", { fromAcceptFlow: true });
  db.removePendingCloudOrders([rs.order_id]);
  if (importedRs?.table_id) {
    db.chargeTableToRoomAtomic({
      tableId: importedRs.table_id,
      waiterName: "Kamarier Testi",
      guestId: guest.id,
      roomId: room102.id,
      tableNumber: importedRs.table_number,
    });
  }
  snap("pas-room-service", ids);

  const mini = db.submitGuestRoomMenuOrder("102", [
    { name: "Coca-Cola", quantity: 1, price: 1.5, category: "Minibar", menu_item_id: coca },
  ]);
  const miniPending = db.listPendingCloudOrders().find((o) => o.id === mini.order_id);
  db.tryApplyCloudRoomMenuOrder(miniPending, { id: recepId, name: "Recep Testi" });
  db.removePendingCloudOrders([mini.order_id]);
  snap("pas-minibar-arta", ids);

  db.sendOrder({
    table_id: tableRoom.id,
    waiter_name: "Kamarier Testi",
    items: [
      { name: "Biftek", menu_item_id: biftek, quantity: 1, price: 9 },
      { name: "Sallatë", menu_item_id: sallate, quantity: 1, price: 4 },
    ],
  });
  db.chargeTableToRoomAtomic({
    tableId: tableRoom.id,
    waiterName: "Kamarier Testi",
    guestId: guest.id,
    roomId: room102.id,
    tableNumber: tableRoom.number,
  });
  snap("pas-charge-dhome", ids);

  const clean = db.submitGuestRoomServiceOrder("102", [{ service_id: pastrim.id, quantity: 1 }]);
  const cleanPending = db.listPendingCloudOrders().find((o) => o.id === clean.order_id);
  db.applyGuestHotelServiceOrder(cleanPending, { id: arbenId, name: "Arben" });
  db.removePendingCloudOrders([clean.order_id]);

  const preview = db.getCheckoutPreview(room102.id);
  t1.folio = {
    nights: preview.bill.nights,
    room: money(preview.bill.room_total),
    charges: money(preview.bill.charges_total),
    total: money(preview.bill.total),
    lines: (preview.bill.charges || []).map((c) => ({ d: c.description, a: money(c.amount), by: c.performed_by_name || "" })),
  };
  const arbenLine = (preview.bill.charges || []).find((c) => String(c.description || "").includes("Pastrim"));
  const closed1 = db.checkOutGuest(room102.id, { waiter_name: "Recep Testi", payment_method: "cash" });
  snap("pas-checkout-arta", ids);
  const co1 = db.db.prepare("SELECT receipt_number, total, payment_method FROM daily_log WHERE receipt_number = ?").get(`CO-${guest.id}`);
  const dit1 = db.getDitari({ dateFrom: day, dateTo: day });
  const led1 = db.getSalesLedger({ from: day, to: day });
  const adv1 = advanced.getWeeklyReport(day);
  const roomAfter1 = db.getRoomById(room102.id);
  t1.checkout_room_status = roomAfter1.status;
  t1.co = { receipt: co1?.receipt_number, total: money(co1?.total), pay: co1?.payment_method };
  t1.ditari = money(dit1.totalSales);
  t1.kontabilisti = sumLedger(led1);
  t1.avancuara = money(adv1.summary.total);
  t1.performer = arbenLine?.performed_by_name || "";
  note("T1 folio 133", t1.folio.total === 133, t1.folio, 133);
  note("T1 ditari 133", t1.ditari === 133, t1.ditari, 133);
  note("T1 kontabilisti 133", t1.kontabilisti === 133, t1.kontabilisti, 133);
  const coRow = led1.find((r) => String(r.receipt_number || "").startsWith("CO-"));
  note(
    "T1 CO burimi 19.50 restorant + 113.50 recepsion",
    coRow && money(coRow.restaurant_gross) === 19.5 && money(coRow.reception_gross) === 113.5 && money(coRow.total) === 133,
    coRow && { r: coRow.restaurant_gross, c: coRow.reception_gross, b: coRow.burimi, t: coRow.total },
    { r: 19.5, c: 113.5, t: 133 },
  );
  note(
    "T1 ditari = kontabilisti ndarje",
    money(dit1.restaurantSales) === 19.5
      && money(dit1.receptionSales) === 113.5
      && money(dit1.restaurantSales + dit1.receptionSales) === 133
      && money(dit1.totalSales) === 133,
    { restaurant: money(dit1.restaurantSales), reception: money(dit1.receptionSales), total: money(dit1.totalSales) },
    { restaurant: 19.5, reception: 113.5, total: 133 },
  );
  const bil1 = db.getKontabilistiBilanc({ from: day, to: day });
  note(
    "T1 bilanc ndarja = totali",
    money(bil1.sales_restaurant + bil1.sales_reception) === money(bil1.sales_total) && bil1.sales_restaurant > 0 && bil1.sales_reception > 0,
    { restaurant: money(bil1.sales_restaurant), reception: money(bil1.sales_reception), total: money(bil1.sales_total) },
    "te dyja, shuma e njejte",
  );
  note("T1 avancuara 133", t1.avancuara === 133, t1.avancuara, 133);
  note("T1 Arben te pastrimi", t1.performer === "Arben", t1.performer, "Arben");
  note("T1 email", t1.email === "arta@test.com", t1.email, "arta@test.com");
  note("T1 nete 2 x 50", t1.folio.nights === 2 && t1.folio.room === 100, { nights: t1.folio.nights, room: t1.folio.room }, { nights: 2, room: 100 });
  note("T1 dhoma e papaster pas check-out", roomAfter1.status === "dirty", roomAfter1.status, "dirty");
  const hk1 = db.db.prepare(
    "SELECT status FROM housekeeping_tasks WHERE room_id = ? ORDER BY id DESC LIMIT 1",
  ).get(room102.id);
  note("T1 task pastrimi", hk1 && hk1.status === "dirty", hk1 && hk1.status, "dirty");
  const cleaned1 = db.markRoomClean(room102.id);
  note("T1 e lire vetem pas pastrimit", cleaned1.status === "free", cleaned1.status, "free");

  const t2 = {};
  const rez = db.createRoomReservation({
    room_id: room201.id,
    guest_name: "Besnik Testi",
    persons: 1,
    check_in_date: tomorrow,
    check_out_date: addDays(tomorrow, 3),
    deposit: 0,
  });
  const listed = db.listRoomReservations({}).filter((r) => r.guest_name === "Besnik Testi");
  t2.listed = listed.map((r) => ({ id: r.id, status: r.status, room: r.room_number, in: r.check_in_date, out: r.check_out_date }));
  const converted = db.convertReservationToCheckIn(rez.id);
  const roomMid = db.getRoomById(room201.id);
  const rezMid = db.getRoomReservationById(rez.id);
  const activeRez = db.listRoomReservations({ status: "active" }).some((r) => r.id === rez.id);
  db.submitGuestRoomMenuOrder("201", [
    { name: "Minibar Besnik", quantity: 1, price: 5, category: "Minibar", menu_item_id: mini5 },
  ]);
  const miniB = db.listPendingCloudOrders().find((o) => String(o.room_number || o.customer_label || "").includes("201") || (o.items || []).some((it) => it.name === "Minibar Besnik"));
  if (miniB) {
    db.tryApplyCloudRoomMenuOrder(miniB, { id: recepId, name: "Recep Testi" });
    db.removePendingCloudOrders([miniB.id]);
  }
  snap("pas-minibar-besnik", ids);
  const prev2 = db.getCheckoutPreview(room201.id);
  t2.folio = {
    nights: prev2.bill.nights,
    room: money(prev2.bill.room_total),
    charges: money(prev2.bill.charges_total),
    total: money(prev2.bill.total),
  };
  const closed2 = db.checkOutGuest(room201.id, { waiter_name: "Recep Testi", payment_method: "cash" });
  const roomEnd2 = db.getRoomById(room201.id);
  const dit2 = db.getDitari({ dateFrom: day, dateTo: day });
  t2.room_after_checkin = roomMid.status;
  t2.rez_after_checkin = rezMid.status;
  t2.still_in_active_list = activeRez;
  t2.room_after_checkout = roomEnd2.status;
  t2.checkout_total = money(closed2.bill.total);
  t2.ditari = money(dit2.totalSales);
  t2.ditari_delta = money(t2.ditari - t1.ditari);
  note("T2 rezervimi ne liste", listed.length === 1 && listed[0].status === "confirmed", t2.listed, "confirmed");
  note("T2 dhoma e zene pas check-in", roomMid.status === "occupied", roomMid.status, "occupied");
  note("T2 folio 125", t2.folio.total === 125, t2.folio, 125);
  note("T2 ditari +125", t2.ditari_delta === 125, t2.ditari_delta, 125);
  note("T2 dhoma e papaster pas check-out", roomEnd2.status === "dirty", roomEnd2.status, "dirty");
  const cleaned2 = db.markRoomClean(room201.id);
  note("T2 e lire vetem pas pastrimit", cleaned2.status === "free", cleaned2.status, "free");

  const t3 = {};
  const walk = db.openWalkInClient({ client_name: "Gëzim Testi", email: "gezim@test.com" });
  db.addWalkInService(walk.id, pishine.id, { quantity: 1, performer: { id: recepId, name: "Recep Testi" } });
  db.addWalkInService(walk.id, spa.id, { quantity: 1, performer: { id: recepId, name: "Recep Testi" } });
  const openWalk = db.getWalkInClient(walk.id);
  const activeBeforePay = db.listActiveHotelOrdersForWaiter({ sessionRole: "recepsion" }).orders;
  t3.before = {
    status: openWalk.status,
    total: money(openWalk.total),
    lines: (openWalk.lines || []).map((l) => ({ d: l.description, a: money(l.amount), st: l.work_status })),
    in_open_clients: db.listOpenWalkInClients().some((c) => c.id === walk.id),
    pasta_in_recep: activeBeforePay.some((o) => String(o.products || "").includes("Pasta")),
  };
  const paid = db.payWalkInClient(walk.id, { waiter_name: "Recep Testi", payment_method: "cash" });
  const afterWalk = db.getWalkInClient(walk.id);
  const dit3 = db.getDitari({ dateFrom: day, dateTo: day });
  const kl = db.db.prepare("SELECT receipt_number, total, payment_method FROM daily_log WHERE receipt_number = ?").get(paid.receipt_number);
  t3.pay = { receipt: paid.receipt_number, total: money(paid.total), status: afterWalk.status, kl: money(kl?.total) };
  t3.still_open = db.listOpenWalkInClients().some((c) => c.id === walk.id);
  t3.ditari = money(dit3.totalSales);
  t3.ditari_delta = money(t3.ditari - t2.ditari);
  note("T3 ne porosi derisa te paguhet", t3.before.in_open_clients && t3.before.lines.length === 2, t3.before, "2 rreshta te hapura");
  note("T3 kupon 35", t3.pay.receipt.startsWith("KL-") && t3.pay.total === 35 && t3.pay.kl === 35, t3.pay, 35);
  note("T3 ditari +35", t3.ditari_delta === 35, t3.ditari_delta, 35);
  note("T3 llogaria e mbyllur", afterWalk.status === "paid" && t3.still_open === false, { status: afterWalk.status, open: t3.still_open }, "paid");

  const t4 = {};
  const pastaBefore = qty(pasta);
  const birraBefore = qty(birra);
  db.sendOrder({
    table_id: table5.id,
    waiter_name: "Kamarier Testi",
    items: [
      { name: "Pasta", menu_item_id: pasta, quantity: 1, price: 8 },
      { name: "Birra", menu_item_id: birra, quantity: 1, price: 3 },
    ],
  });
  const recepWhileOpen = db.listActiveHotelOrdersForWaiter({ sessionRole: "recepsion" }).orders;
  const waiterWhileOpen = db.listActiveHotelOrdersForWaiter({ sessionRole: "kamarier" }).orders;
  t4.while_open = {
    recep_has_pasta: recepWhileOpen.some((o) => String(o.products || "").includes("Pasta") || String(o.source || "").includes("Pasta")),
    waiter_has_table5: waiterWhileOpen.some((o) => Number(o.table_number) === 5 || String(o.source || "").includes("5")),
  };
  db.closeTable(table5.id, "Kamarier Testi", false, "cash");
  snap("pas-cash-tavolina-5", ids);
  const cashLog = db.db.prepare(`
    SELECT receipt_number, total, payment_method, items_json
    FROM daily_log
    WHERE status = 'completed' AND payment_method = 'cash' AND waiter_name = 'Kamarier Testi'
    ORDER BY id DESC LIMIT 1
  `).get();
  const shiftW = db.getWaiterShiftSummary(kamarierId, { sessionRole: "kamarier" });
  const dit4 = db.getDitari({ dateFrom: day, dateTo: day });
  const rep4 = db.getReports(day, day);
  const recepAfter = db.listActiveHotelOrdersForWaiter({ sessionRole: "recepsion" }).orders;
  t4.log = { receipt: cashLog?.receipt_number || null, total: money(cashLog?.total), pay: cashLog?.payment_method };
  t4.shift = {
    cash: money(shiftW.cash_total),
    card: money(shiftW.card_total),
    room: money(shiftW.room_total),
    sales: money(shiftW.total_sales),
    opening: money(shiftW.opening_cash),
  };
  t4.ditari = money(dit4.totalSales);
  t4.ditari_delta = money(t4.ditari - t3.ditari);
  t4.restaurant = {
    sales: money(rep4.restaurantSales),
    cash: money(rep4.restaurant_payments?.cash),
    card: money(rep4.restaurant_payments?.card),
    room: money(rep4.restaurant_payments?.room),
  };
  t4.recep_still_has_pasta = recepAfter.some((o) => String(o.products || "").includes("Pasta"));
  t4.stock = { pasta: qty(pasta) - pastaBefore, birra: qty(birra) - birraBefore };
  note("T4 nuk eshte te porosit e recepsionit", t4.while_open.recep_has_pasta === false && t4.recep_still_has_pasta === false, t4.while_open, false);
  note("T4 kupon cash 11", t4.log.total === 11 && t4.log.pay === "cash" && !!t4.log.receipt, t4.log, "kupon + 11");
  note("T4 ditari +11", t4.ditari_delta === 11, t4.ditari_delta, 11);
  note("T4 raporti restorant cash 11", t4.restaurant.cash === 11, t4.restaurant, { cash: 11, room: 13 });

  const t5 = {};
  const beforeCloseW = db.getWaiterShiftSummary(kamarierId, { sessionRole: "kamarier" });
  const beforeCloseR = db.getWaiterShiftSummary(recepId, { sessionRole: "recepsion" });
  const expectW = money((Number(beforeCloseW.opening_cash) || 0) + (Number(beforeCloseW.cash_total) || 0));
  const expectR = money((Number(beforeCloseR.opening_cash) || 0) + (Number(beforeCloseR.cash_total) || 0));
  const closedW = db.closeWaiterShift(kamarierId, expectW, 0, { sessionRole: "kamarier" });
  const closedR = db.closeWaiterShift(recepId, expectR, 0, { sessionRole: "recepsion" });
  const shifts = advanced.getShiftsReport(day, day).shifts || [];
  const dit5 = db.getDitari({ dateFrom: day, dateTo: day });
  const rep5 = db.getReports(day, day);
  const week = advanced.getWeeklyReport(day);
  const month = advanced.getMonthlyReport(String(day).slice(0, 7));
  const staff = advanced.getStaffReport(day, day);
  const led5 = db.getSalesLedger({ from: day, to: day });
  const rawRows = db.db.prepare("SELECT receipt_number, total, payment_method FROM daily_log WHERE status = 'completed'").all();
  const rawSum = money(rawRows.reduce((s, r) => s + Number(r.total || 0), 0));
  t5.close_waiter = {
    opening: money(closedW.opening_cash),
    cash: money(closedW.cash_total),
    room: money(closedW.room_total),
    card: money(closedW.card_total),
    sales: money(closedW.total_sales),
    expected: money(closedW.expected_closing_cash),
    actual: money(closedW.closing_cash_actual),
    diff: money(closedW.cash_difference),
  };
  t5.close_recep = {
    opening: money(closedR.opening_cash),
    cash: money(closedR.cash_total),
    room: money(closedR.room_total),
    sales: money(closedR.total_sales),
    expected: money(closedR.expected_closing_cash),
    actual: money(closedR.closing_cash_actual),
    diff: money(closedR.cash_difference),
  };
  t5.nderrimet = shifts.map((s) => ({
    name: s.waiter_name,
    role: s.staff_role,
    open: s.is_open,
    opening: money(s.opening_cash),
    cash: money(s.cash_sales_total),
    card: money(s.card_sales_total),
    sales: money(s.total_sales),
    room: s.room_total == null ? null : money(s.room_total),
    expected: s.expected_closing_cash == null ? null : money(s.expected_closing_cash),
    actual: s.closing_cash_actual == null ? null : money(s.closing_cash_actual),
    diff: s.cash_difference == null ? null : money(s.cash_difference),
  }));
  t5.ditari = money(dit5.totalSales);
  t5.ditari_cash = money(dit5.totalCash);
  t5.ditari_room = money(dit5.totalRoom);
  t5.raport = {
    total: money(rep5.totalSales),
    restaurant: money(rep5.restaurantSales),
    cash: money(rep5.restaurant_payments?.cash),
    card: money(rep5.restaurant_payments?.card),
    room: money(rep5.restaurant_payments?.room),
  };
  t5.ledger = sumLedger(led5);
  t5.ledger_rows = led5.map((r) => ({ receipt: r.receipt_number, total: money(r.total) }));
  t5.week = money(week.summary.total);
  t5.month = money(month.summary.total);
  t5.week_split = { reception: money(week.summary.reception), waiter: money(week.summary.waiter), cash: money(week.summary.cash) };
  t5.staff = (staff.staff || []).map((s) => ({
    name: s.operator,
    total: money(s.total),
    services_total: money(s.services_total),
    station: s.station_label,
    services: (s.services || []).map((x) => `${x.description} ${money(x.amount)}`).slice(0, 8),
  }));
  t5.staff_summary = money(staff.summary.total);
  t5.raw_daily_log_sum = rawSum;
  t5.raw_rows = rawRows.map((r) => ({ receipt: r.receipt_number, total: money(r.total), pay: r.payment_method }));
  const bothClosed = t5.nderrimet.filter((s) => s.name === "Recep Testi" || s.name === "Kamarier Testi");
  note("T5 te dy nderrimet ne raport", bothClosed.length === 2 && bothClosed.every((s) => s.open === false), t5.nderrimet, "2 te mbyllura");
  note("T5 diferenca cash 0", t5.close_waiter.diff === 0 && t5.close_recep.diff === 0, { w: t5.close_waiter, r: t5.close_recep }, 0);
  note("T5 kamarieri cash 11", t5.close_waiter.cash === 11, t5.close_waiter.cash, 11);
  note("T5 kamarieri ne dhoma 19.50", t5.close_waiter.room === 19.5, t5.close_waiter.room, 19.5);
  note("T5 recepsioni cash 293", t5.close_recep.cash === 293, t5.close_recep.cash, 293);
  note("T5 ditari 304", t5.ditari === 304, t5.ditari, 304);
  const ledRest = money(led5.reduce((s, r) => s + Number(r.restaurant_gross || 0), 0));
  const ledRec = money(led5.reduce((s, r) => s + Number(r.reception_gross || 0), 0));
  note(
    "T5 ditari = kontabilisti ndarje",
    money(dit5.restaurantSales) === ledRest
      && money(dit5.receptionSales) === ledRec
      && money(dit5.restaurantSales + dit5.receptionSales) === 304
      && money(week.summary.waiter) === ledRest
      && money(week.summary.reception) === ledRec
      && money(dit5.active_unpaid_total || 0) === 0,
    {
      ditari: { restaurant: money(dit5.restaurantSales), reception: money(dit5.receptionSales) },
      kontabilisti: { restaurant: ledRest, reception: ledRec },
      javore: { restaurant: money(week.summary.waiter), reception: money(week.summary.reception) },
    },
    "barazim",
  );
  const traceSum = money((dit5.trace_entries || []).reduce((s, e) => s + Number(e.total || 0), 0));
  const mainHasTrace = (dit5.entries || []).some((e) => e.audit_trail || (e.folio_settled && e.payment_method === "room"));
  note("T5 gjurma jasht listes", traceSum === 19.5 && mainHasTrace === false, { trace: traceSum, mainHasTrace }, { trace: 19.5, mainHasTrace: false });
  note("T5 kontabilisti 304", t5.ledger === 304, t5.ledger, 304);
  const bil5 = db.getKontabilistiBilanc({ from: day, to: day });
  note(
    "T5 bilanc ndarja = totali",
    money(bil5.sales_restaurant + bil5.sales_reception) === money(bil5.sales_total),
    { restaurant: money(bil5.sales_restaurant), reception: money(bil5.sales_reception), total: money(bil5.sales_total) },
    "shuma e njejte",
  );
  note("T5 javore 304", t5.week === 304, t5.week, 304);
  note("T5 mujore 304", t5.month === 304, t5.month, 304);
  note("T5 stafi 304", t5.staff_summary === 304, t5.staff_summary, 304);
  const arbenStaff = t5.staff.find((s) => s.name === "Arben");
  note("T5 Arben shitje 0", arbenStaff && arbenStaff.total === 0, arbenStaff, 0);
  note("T5 Arben sherbime 12", arbenStaff && arbenStaff.services_total === 12, arbenStaff, 12);
  const waiterShiftRow = t5.nderrimet.find((s) => s.name === "Kamarier Testi");
  note("T5 Nderrimet tregon ne dhoma", waiterShiftRow && waiterShiftRow.room === 19.5, waiterShiftRow, 19.5);

  const diary = db.listHotelDiary({});
  const diaryBrief = diary.map((r) => ({
    ev: r.event_type,
    room: r.room_number,
    guest: r.guest_name,
    amount: money(r.amount),
    by: r.performed_by,
    detail: r.detail,
  }));
  const need = [
    ["check_in", "Arta Testi"],
    ["check_out", "Arta Testi"],
    ["check_in", "Besnik Testi"],
    ["check_out", "Besnik Testi"],
    ["walkin_open", "Gëzim Testi"],
    ["payment", "Gëzim Testi"],
  ];
  for (const [ev, guestName] of need) {
    note(`ditari ${ev} ${guestName}`, diaryBrief.some((r) => r.ev === ev && r.guest === guestName), guestName, ev);
  }
  note(
    "ditari restorant ne dhoma",
    diaryBrief.some((r) => r.ev === "room_charge" && String(r.detail || "").includes("Biftek") && String(r.detail || "").includes("Kamarier")),
    diaryBrief.filter((r) => r.ev === "room_charge").map((r) => r.detail),
    "Biftek",
  );
  note(
    "ditari rezervim",
    diaryBrief.some((r) => r.ev === "reservation" && r.guest === "Besnik Testi"),
    diaryBrief.filter((r) => r.ev === "reservation"),
    "Besnik",
  );
  note(
    "ditari shitje cash tavoline",
    diaryBrief.some((r) => r.ev === "table_cash" && r.amount === 11 && r.by === "Kamarier Testi"),
    diaryBrief.filter((r) => r.ev === "table_cash"),
    11,
  );
  note(
    "ditari nderrim hapur",
    diaryBrief.some((r) => r.ev === "shift_open" && r.by === "Kamarier Testi"),
    diaryBrief.filter((r) => r.ev === "shift_open").map((r) => r.by),
    "Kamarier Testi",
  );
  note(
    "ditari nderrim mbyllur",
    diaryBrief.some((r) => r.ev === "shift_close" && r.by === "Kamarier Testi"),
    diaryBrief.filter((r) => r.ev === "shift_close").map((r) => r.by),
    "Kamarier Testi",
  );
  note(
    "ditari pastrim",
    diaryBrief.some((r) => String(r.detail || "").includes("Pastrim") || String(r.guest || "") === "Arta Testi" && r.ev === "service_done"),
    diaryBrief.filter((r) => String(r.detail || "").includes("Pastrim") || r.ev === "service_order" || r.ev === "service_done").map((r) => `${r.ev}:${r.detail}`),
    "Pastrim",
  );

  const stockEnd = {
    kafe: qty(kafe),
    sanduic: qty(sanduic),
    coca: qty(coca),
    biftek: qty(biftek),
    sallate: qty(sallate),
    mini5: qty(mini5),
    pasta: qty(pasta),
    birra: qty(birra),
  };
  note("stok room service -1", stockEnd.kafe === 9 && stockEnd.sanduic === 9 && stockEnd.coca === 9, { kafe: stockEnd.kafe, sanduic: stockEnd.sanduic, coca: stockEnd.coca }, 9);
  note("stok ne dhoma -1 jo dyfish", stockEnd.biftek === 9 && stockEnd.sallate === 9, { biftek: stockEnd.biftek, sallate: stockEnd.sallate }, 9);
  note("stok cash -1", stockEnd.pasta === 9 && stockEnd.birra === 9, { pasta: stockEnd.pasta, birra: stockEnd.birra }, 9);
  note("stok minibar besnik -1", stockEnd.mini5 === 9, stockEnd.mini5, 9);

  const roomRs = db.getRoomById(room102.id);
  if (roomRs.status !== "free") db.markRoomClean(room102.id);
  const stayRs = db.checkInGuest({
    room_id: room102.id,
    guest_name: "Lira Testi",
    persons: 1,
    check_in_date: day,
    check_out_date: addDays(day, 1),
    deposit: 0,
  });
  const forgotten = db.submitGuestRoomMenuOrder("102", [
    { name: "Kafe", quantity: 1, price: 2.5, menu_item_id: kafe },
  ]);
  const forgottenPending = db.listPendingCloudOrders().find((o) => o.id === forgotten.order_id);
  db.importCloudOrderToLocal(forgottenPending, "Kamarier Testi", { fromAcceptFlow: true });
  db.removePendingCloudOrders([forgotten.order_id]);
  const recepRs = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep RS', 'recepsion', '1515', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepRs, 0);
  const closedForgotten = db.checkOutGuest(room102.id, { waiter_name: "Recep RS", payment_method: "cash" });
  const forgottenCharge = (closedForgotten.bill.charges || []).some((c) => String(c.description || "").includes("Kafe"));
  note(
    "RS e harruar hyn ne folio ne check-out",
    forgottenCharge && money(closedForgotten.bill.charges_total) >= 2.5,
    { charges: money(closedForgotten.bill.charges_total), guest: stayRs.guest.guest_name },
    2.5,
  );
  note(
    "RS paralajmerim ne check-out",
    closedForgotten.room_service_warning === "Ka porosi Room Service të pa faturuara — po faturohen automatikisht.",
    closedForgotten.room_service_warning,
    "Ka porosi Room Service të pa faturuara — po faturohen automatikisht.",
  );
  note(
    "RS e harruar dhoma dirty",
    db.getRoomById(room102.id).status === "dirty",
    db.getRoomById(room102.id).status,
    "dirty",
  );

  if (db.getRoomById(room201.id).status !== "free") db.markRoomClean(room201.id);
  db.checkInGuest({
    room_id: room201.id,
    guest_name: "Driton Testi",
    persons: 1,
    check_in_date: day,
    check_out_date: addDays(day, 1),
    deposit: 0,
  });
  const kam2 = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier RS', 'kamarier', '1616', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(kam2, 0);
  const forgottenShift = db.submitGuestRoomMenuOrder("201", [
    { name: "Kafe", quantity: 1, price: 2.5, menu_item_id: kafe },
  ]);
  const forgottenShiftPending = db.listPendingCloudOrders().find((o) => o.id === forgottenShift.order_id);
  db.importCloudOrderToLocal(forgottenShiftPending, "Kamarier RS", { fromAcceptFlow: true });
  db.removePendingCloudOrders([forgottenShift.order_id]);
  const sumRs = db.getWaiterShiftSummary(kam2, { sessionRole: "kamarier" });
  note(
    "RS nuk bllokon mbylljen",
    sumRs.active_tables === 0 && sumRs.room_service_uncharged === 1,
    { tables: sumRs.active_tables, open: sumRs.room_service_uncharged, warn: sumRs.room_service_warning },
    1,
  );
  const closedRs = db.closeWaiterShift(kam2, 0, 0, { sessionRole: "kamarier" });
  const folioRs = db.getCheckoutPreview(room201.id);
  const shiftCharged = (folioRs.bill.charges || []).some((c) => String(c.description || "").includes("Kafe"));
  note(
    "RS faturohet ne mbyllje nderrimi",
    closedRs.room_service_warning === "Ka porosi Room Service të pa faturuara — po faturohen automatikisht." && shiftCharged,
    { warn: closedRs.room_service_warning, charged: shiftCharged, n: (closedRs.room_service_auto_charged || []).length },
    "warning + folio",
  );

  const failed = checks.filter((c) => !c.ok);
  const report = {
    db: dbPath,
    day,
    tomorrow,
    test1: t1,
    test2: t2,
    test3: t3,
    test4: t4,
    test5: t5,
    stock: stockLog.concat([{ label: "end", ...stockEnd }]),
    diary: diaryBrief,
    checks_failed: failed,
    pass: checks.length - failed.length,
    fail: failed.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
