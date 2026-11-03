"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-svc-work-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  delete require.cache[require.resolve("../hotel-advanced-reports.js")];
  const db = require("../database.js");
  const advanced = require("../hotel-advanced-reports.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Sherbime Fiktive", admin_password: "1234", table_count: 2 });

  const room = db.db.prepare("SELECT id FROM rooms WHERE room_number = '102'").get()
    || db.db.prepare("SELECT id FROM rooms ORDER BY id LIMIT 1").get();
  db.db.prepare("UPDATE rooms SET room_number = '102', price_per_night = 80, status = 'free' WHERE id = ?").run(room.id);

  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Recep', 'recepsion', '919191', 1)",
  ).run().lastInsertRowid;
  const arbenId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Arben', 'pastrim', '717171', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 50);
  db.openWaiterShiftWithCash(arbenId, 0);

  const stay = db.checkInGuest({
    room_id: room.id,
    guest_name: "Arta Fiktive",
    phone: "044000000",
    check_in_date: "2026-11-03",
    check_out_date: "2026-11-04",
    persons: 1,
  });
  const guest = stay.guest;
  assert.ok(guest?.id);
  const svc = db.createHotelService({ name: "Pastrim prove", price: 12, vat_category: "18" });

  db.submitGuestRoomServiceOrder("102", [{ service_id: svc.id, quantity: 1 }]);
  const before = db.listStayServiceWork();
  const waiting = before.find((row) => row.status === "pending" && String(row.description).includes("Pastrim"));
  assert.ok(waiting, "porosia e papranuar del në pritje");
  assert.strictEqual(waiting.performed_by_name, "");

  const pendingOrder = db.listPendingCloudOrders().find((o) => o.order_kind === "guest_hotel_service");
  assert.ok(pendingOrder, "porosia pending");
  const applied = db.applyGuestHotelServiceOrder(pendingOrder, { id: arbenId, name: "Arben" });
  assert.strictEqual(applied.ok, true);
  const afterAccept = db.listStayServiceWork();
  const done = afterAccept.find((row) => row.status === "completed" && String(row.description).includes("Pastrim"));
  assert.ok(done, "pas pranimit shërbimi është i kryer");
  assert.strictEqual(done.performed_by_name, "Arben");
  assert.strictEqual(done.room_number, "102");
  assert.strictEqual(money(done.amount), 12);
  assert.strictEqual(done.guest_name, "Arta Fiktive");
  assert.ok(!afterAccept.some((row) => row.status === "pending" && String(row.description).includes("Pastrim")));

  const arbenShift = db.getWaiterShiftSummary(arbenId, { sessionRole: "pastrim" });
  assert.strictEqual(money(arbenShift.service_total), 12);
  assert.strictEqual(money(arbenShift.total_sales), 0);
  assert.strictEqual(arbenShift.services[0].performed_by_name, "Arben");

  const closed = db.checkOutGuest(room.id, { waiter_name: "Fiktiv Recep", payment_method: "cash" });
  assert.strictEqual(money(closed.bill.total), 92);
  const left = db.listStayServiceWork().filter((row) => row.guest_name === "Arta Fiktive");
  assert.strictEqual(left.length, 0);

  const day = "2026-11-03";
  const ditari = db.getDitari({ dateFrom: day, dateTo: "2026-11-04" });
  const ditariSum = money((ditari.entries || []).filter((e) => e.status !== "cancelled").reduce((s, e) => s + Number(e.total || 0), 0));
  assert.strictEqual(ditariSum, 92);
  const co = (ditari.entries || []).find((e) => String(e.receipt_number || "").startsWith("CO-"));
  assert.ok(String(co.artikujt || "").includes("Arben"));
  assert.ok(String(co.artikujt || "").includes("Pastrim"));

  const ledger = db.getSalesLedger({ from: day, to: "2026-11-04" });
  const ledgerSum = money(ledger.reduce((s, r) => s + (Number(r.total) || 0), 0));
  assert.strictEqual(ledgerSum, 92);

  const week = advanced.getWeeklyReport(day);
  assert.strictEqual(money(week.summary.total), 92);
  const staff = advanced.getStaffReport(day, "2026-11-04");
  const arben = (staff.staff || []).find((s) => s.operator === "Arben");
  assert.ok(arben && arben.services.length === 1);
  assert.strictEqual(money(staff.summary.total), 92);

  console.log("service-work-log.test.js OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
