"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(os.tmpdir(), `hotel-disc-3n-${process.pid}-${Date.now()}.db`);
process.env.HOTEL_DB_PLAIN = "1";

function euro(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const db = require("../database");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Discount 3N Hotel",
    admin_password: "test1234",
    table_count: 4,
  });

  const day = ymd();
  db.addStaff("DiscKamarier", "1234", "kamarier");
  const waiter = db.findStaffByName("DiscKamarier");
  db.openWaiterShiftWithCash(waiter.id, 0);

  db.addCategory("DiscCat", "bar");
  const aId = db.addMenuItem({ name: "Artikull 10", category: "DiscCat", price: 10, vat_category: "18" });
  const bId = db.addMenuItem({ name: "Artikull 5", category: "DiscCat", price: 5, vat_category: "18" });
  const cId = db.addMenuItem({ name: "Artikull 8", category: "DiscCat", price: 8, vat_category: "18" });

  const table = db.getTableByNumber(1);
  db.sendOrder({
    table_id: table.id,
    waiter_name: waiter.name,
    items: [
      { menu_item_id: aId, name: "Artikull 10", price: 10, quantity: 1 },
      { menu_item_id: bId, name: "Artikull 5", price: 5, quantity: 1 },
      { menu_item_id: cId, name: "Artikull 8", price: 8, quantity: 1 },
    ],
  });
  const closed = db.closeTable(table.id, waiter.name, false, "cash", {
    subtotal: 23,
    discount_total: 3,
    total: 20,
    promotion_name: "Test 3N",
  });
  assert.ok(closed, "closeTable");
  assert.strictEqual(euro(closed.total), 20);
  assert.strictEqual(euro(closed.discount_total), 3);
  assert.strictEqual(euro(closed.subtotal), 23);

  const ditari = db.getDitari({ dateFrom: day, dateTo: day });
  const restRow = (ditari.entries || []).find(
    (e) => e.status === "completed" && !String(e.receipt_number || "").toUpperCase().startsWith("CO-"),
  );
  assert.ok(restRow, "rresht restorant te Ditari");
  assert.strictEqual(euro(restRow.shitja), 23, `Ditari rresht shitja=${restRow.shitja}`);
  assert.strictEqual(euro(restRow.zbritje), 3, `Ditari rresht zbritje=${restRow.zbritje}`);
  assert.strictEqual(euro(restRow.pagesa), 20, `Ditari rresht pagesa=${restRow.pagesa}`);
  assert.strictEqual(euro(ditari.shitja), 23, `Ditari shitja=${ditari.shitja}`);
  assert.strictEqual(euro(ditari.zbritja), 3, `Ditari zbritja=${ditari.zbritja}`);
  assert.strictEqual(euro(ditari.pagesa), 20, `Ditari pagesa=${ditari.pagesa}`);
  assert.strictEqual(euro(ditari.restaurantGross), 23);
  assert.strictEqual(euro(ditari.restaurantDiscount), 3);
  assert.strictEqual(euro(ditari.restaurantSales), 20);

  const vatSum = euro((Number(restRow.pa_tvsh) || 0) + (Number(restRow.tvsh) || 0));
  assert.ok(Math.abs(vatSum - 20) < 0.03, `TVSH mbi neto: pa_tvsh+tvsh=${vatSum} duhet 20`);
  const vatOn23 = euro(23 - 23 / 1.18);
  assert.ok(euro(restRow.tvsh) < vatOn23 - 0.01, `TVSH jo mbi 23: tvsh=${restRow.tvsh} vatOn23=${vatOn23}`);

  const reports = db.getReports(day, day);
  assert.strictEqual(euro(reports.shitja), 23, `Raportet shitja=${reports.shitja}`);
  assert.strictEqual(euro(reports.zbritja), 3, `Raportet zbritja=${reports.zbritja}`);
  assert.strictEqual(euro(reports.pagesa), 20, `Raportet pagesa=${reports.pagesa}`);
  assert.strictEqual(euro(reports.restaurantGross), 23);
  assert.strictEqual(euro(reports.restaurantDiscount), 3);

  const dash = db.getDashboardOverview();
  assert.strictEqual(euro(dash.daily_revenue.restaurant), 20, `Pasqyra restorant pagesa=${dash.daily_revenue.restaurant}`);
  assert.strictEqual(euro(dash.daily_revenue.restaurant_discount), 3);
  assert.strictEqual(euro(dash.daily_revenue.restaurant_gross), 23);
  assert.strictEqual(euro(dash.daily_revenue.zbritja), 3);

  const bal = db.getDailyBalanceReport(day);
  assert.strictEqual(euro(bal.shitja), 23, `Barazimi shitja=${bal.shitja}`);
  assert.strictEqual(euro(bal.zbritja), 3, `Barazimi zbritja=${bal.zbritja}`);
  assert.strictEqual(euro(bal.pagesa), 20, `Barazimi pagesa=${bal.pagesa}`);
  assert.strictEqual(euro(bal.restaurant.shitja), 23);
  assert.strictEqual(euro(bal.restaurant.zbritja), 3);
  assert.strictEqual(euro(bal.restaurant.pagesa), 20);

  const shifts = db.listShiftReports({ from: day, to: day, include_open: true });
  const waiterShift = shifts.find((s) => s.waiter_name === waiter.name);
  assert.ok(waiterShift, "ndërrimi i kamarierit");
  assert.strictEqual(euro(waiterShift.shitja), 23, `Ndërrimi shitja=${waiterShift.shitja}`);
  assert.strictEqual(euro(waiterShift.zbritja), 3, `Ndërrimi zbritja=${waiterShift.zbritja}`);
  assert.strictEqual(euro(waiterShift.pagesa), 20, `Ndërrimi pagesa=${waiterShift.pagesa}`);

  db.addStaff("DiscRecepsion", "2222", "recepsion");
  const recep = db.findStaffByName("DiscRecepsion");
  db.openWaiterShiftWithCash(recep.id, 0);
  const room = db.listRooms().find((r) => r.status === "free");
  assert.ok(room, "dhomë e lirë");
  db.updateRoom(room.id, { price_per_night: 23 });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  db.checkInGuest({
    room_id: room.id,
    guest_name: "Mysafir Zbritje",
    persons: 1,
    check_in_date: day,
    check_out_date: ymd(tomorrow),
  });
  db.checkOutGuest(room.id, {
    check_out_date: ymd(tomorrow),
    payment_method: "cash",
    waiter_name: recep.name,
    discount_total: 3,
  });

  const ditari2 = db.getDitari({ dateFrom: day, dateTo: day });
  const recRow = (ditari2.entries || []).find((e) =>
    String(e.receipt_number || "").toUpperCase().startsWith("CO-"),
  );
  assert.ok(recRow, "rresht recepsion CO- te Ditari");
  assert.strictEqual(euro(recRow.zbritje), 3, `Recepsion zbritje=${recRow.zbritje}`);
  assert.strictEqual(euro(recRow.pagesa), euro(recRow.total), "recepsion pagesa = total neto");
  assert.strictEqual(euro(recRow.shitja), euro(recRow.pagesa + recRow.zbritje), "recepsion shitja = pagesa + zbritje");
  assert.ok(euro(ditari2.receptionDiscount) >= 3, `Ditari receptionDiscount=${ditari2.receptionDiscount}`);
  assert.ok(euro(ditari2.restaurantDiscount) >= 3, `Ditari restaurantDiscount=${ditari2.restaurantDiscount}`);

  const reports2 = db.getReports(day, day);
  assert.ok(euro(reports2.receptionDiscount) >= 3, `Raportet receptionDiscount=${reports2.receptionDiscount}`);
  assert.ok(euro(reports2.restaurantDiscount) >= 3);

  const dash2 = db.getDashboardOverview();
  assert.ok(euro(dash2.daily_revenue.reception_discount) >= 3, `Pasqyra reception_discount=${dash2.daily_revenue.reception_discount}`);

  const recVat = euro((Number(recRow.pa_tvsh) || 0) + (Number(recRow.tvsh) || 0));
  assert.ok(
    Math.abs(recVat - euro(recRow.pagesa)) < 0.05,
    `Recepsion TVSH mbi neto: pa_tvsh+tvsh=${recVat} pagesa=${recRow.pagesa}`,
  );

  console.log(JSON.stringify({
    restorant: {
      ditari_rresht: { shitja: restRow.shitja, zbritja: restRow.zbritje, pagesa: restRow.pagesa, pa_tvsh: restRow.pa_tvsh, tvsh: restRow.tvsh },
      ditari: { shitja: ditari.shitja, zbritja: ditari.zbritja, pagesa: ditari.pagesa, restaurantSales: ditari.restaurantSales, restaurantGross: ditari.restaurantGross, restaurantDiscount: ditari.restaurantDiscount },
      raportet: { shitja: reports.shitja, zbritja: reports.zbritja, pagesa: reports.pagesa, restaurantGross: reports.restaurantGross, restaurantDiscount: reports.restaurantDiscount },
      pasqyra: dash.daily_revenue,
      barazimi: { shitja: bal.shitja, zbritja: bal.zbritja, pagesa: bal.pagesa, restaurant: bal.restaurant },
      nderrimi: { shitja: waiterShift.shitja, zbritja: waiterShift.zbritja, pagesa: waiterShift.pagesa },
    },
    recepsion: {
      ditari_rresht: { shitja: recRow.shitja, zbritja: recRow.zbritje, pagesa: recRow.pagesa, pa_tvsh: recRow.pa_tvsh, tvsh: recRow.tvsh, total: recRow.total, subtotal: recRow.subtotal, discount_total: recRow.discount_total },
      ditari: { receptionSales: ditari2.receptionSales, receptionGross: ditari2.receptionGross, receptionDiscount: ditari2.receptionDiscount },
      raportet: { receptionSales: reports2.receptionSales, receptionGross: reports2.receptionGross, receptionDiscount: reports2.receptionDiscount },
      pasqyra: {
        reception: dash2.daily_revenue.reception,
        reception_gross: dash2.daily_revenue.reception_gross,
        reception_discount: dash2.daily_revenue.reception_discount,
      },
    },
  }, null, 2));
  console.log("discount-three-numbers.test.js OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
