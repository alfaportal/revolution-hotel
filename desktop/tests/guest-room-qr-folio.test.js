"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-qr-folio-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "QR Folio", admin_password: "1234", table_count: 2 });

  const room = db.db.prepare("SELECT id FROM rooms WHERE room_number = '102'").get()
    || db.db.prepare("SELECT id FROM rooms ORDER BY id LIMIT 1").get();
  db.db.prepare(
    "UPDATE rooms SET room_number = '102', price_per_night = 40, status = 'free' WHERE id = ?",
  ).run(room.id);

  const day = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  const out = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Kamarier', 'kamarier', '818181', 1)",
  ).run();
  const waiter = db.findStaffByName("Fiktiv Kamarier");
  db.openWaiterShiftWithCash(waiter.id, 10);

  if (!db.db.prepare("SELECT id FROM categories WHERE name = 'Pije'").get()) db.addCategory("Pije");
  const espresso = db.addMenuItem({ name: "Espresso QR", category: "Pije", price: 0.8, vat_category: "18" });
  const cola = db.addMenuItem({ name: "Cola QR", category: "Pije", price: 1.5, vat_category: "18" });
  const sandwich = db.addMenuItem({ name: "Sanduic QR", category: "Pije", price: 4, vat_category: "18" });

  const stay = db.checkInGuest({
    room_id: room.id,
    guest_name: "Mysafir QR Folio",
    persons: 1,
    check_in_date: day,
    check_out_date: out,
    deposit: 0,
  });

  const items = [
    { name: "Espresso QR", quantity: 1, price: 0.8, menu_item_id: espresso },
    { name: "Cola QR", quantity: 1, price: 1.5, menu_item_id: cola },
    { name: "Sanduic QR", quantity: 1, price: 4, menu_item_id: sandwich },
  ];
  let chargesSum = 0;
  for (const it of items) {
    const submitted = db.submitGuestRoomMenuOrder("102", [it]);
    assert.strictEqual(submitted.waiter_pending, true);
    const pending = db.listPendingCloudOrders().find((o) => o.id === submitted.order_id);
    assert.ok(pending, "pending QR dhomë");
    const imported = db.importCloudOrderToLocal(pending, waiter.name, { fromAcceptFlow: true });
    assert.strictEqual(imported.ok, true);
    assert.strictEqual(imported.room_menu, true);
    db.removePendingCloudOrders([submitted.order_id]);
    chargesSum = money(chargesSum + it.price);
    const preview = db.getCheckoutPreview(room.id);
    assert.ok(
      (preview.bill.charges || []).some((c) => String(c.description || "").includes(it.name)),
      `folio mungon ${it.name}`,
    );
    assert.strictEqual(money(preview.bill.charges_total), chargesSum);
    assert.strictEqual(money(preview.bill.room_total), 40);
    assert.strictEqual(money(preview.bill.total), money(40 + chargesSum));
  }

  const last = db.getCheckoutPreview(room.id);
  assert.strictEqual(money(last.bill.charges_total), 6.3);
  assert.strictEqual(money(last.bill.total), 46.3);
  console.log("guest-room-qr-folio.test.js OK", {
    room_total: last.bill.room_total,
    charges_total: last.bill.charges_total,
    total: last.bill.total,
    guest: stay.guest.guest_name,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
