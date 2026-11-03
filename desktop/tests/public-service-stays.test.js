"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-svc-stay-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Sherbime Fiktive", admin_password: "1234", table_count: 2 });

  const request = {
    id: "svc-xhakuzi",
    status: "pending",
    service_name: "Xhakuzi",
    guest_name: "Hysen",
    guest_email: "hysen@hotel.test",
    requested_date: "2026-11-04",
    requested_time: "09:00",
  };
  db.reconcilePendingPublicServiceRequests([request]);
  db.reconcilePendingPublicServiceRequests([]);
  const pending = db.listPendingPublicServiceRequests();
  assert.strictEqual(pending.length, 1, "lista bosh e cloud nuk e fshin porosinë");
  assert.strictEqual(String(pending[0].id), "svc-xhakuzi");

  db.rememberPublicServiceRequests(pending);
  db.removePendingPublicServiceRequest("svc-xhakuzi");
  assert.strictEqual(db.listPendingPublicServiceRequests().length, 0);
  db.answerPublicServiceRequest("svc-xhakuzi", "accepted", "Recepsion", request);
  const active = db.listActiveServiceRegister().find((r) => r.ref_key === "public:svc-xhakuzi");
  assert.ok(active, "pas pranimit mbetet në listë");
  assert.strictEqual(active.status, "accepted");
  const shown = db.listStayServiceWork().find((r) => String(r.description).includes("Xhakuzi"));
  assert.ok(shown);
  assert.strictEqual(shown.status, "accepted");

  const queued = db.queueGuestServiceReply({
    kind: "accepted",
    service_name: "Xhakuzi",
    room_number: "102",
    email: "hysen@hotel.test",
    guest_name: "Hysen",
    ref_key: "public:svc-xhakuzi",
  });
  assert.strictEqual(queued.queued, true);
  const mail = db.listDueGuestServiceEmails().find((r) => r.to_email === "hysen@hotel.test");
  assert.strictEqual(mail.body, "Shërbimi juaj është pranuar — Xhakuzi, Dhoma 102. Faleminderit!");

  const skipped = db.queueGuestServiceReply({
    kind: "rejected",
    service_name: "Xhakuzi",
    email: "",
    guest_name: "Askush",
  });
  assert.strictEqual(skipped.skipped, true);

  const room = db.db.prepare("SELECT id FROM rooms WHERE room_number = '102'").get();
  db.db.prepare("UPDATE rooms SET price_per_night = 80, status = 'free' WHERE id = ?").run(room.id);
  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Recep', 'recepsion', '919191', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 50);
  const stay = db.checkInGuest({
    room_id: room.id,
    guest_name: "Arta Fiktive",
    phone: "044000000",
    email: "arta@hotel.test",
    check_in_date: "2026-11-03",
    check_out_date: "2026-11-04",
    persons: 1,
  });
  const byRoom = db.queueGuestServiceReply({
    kind: "rejected",
    service_name: "Pastrim",
    room_number: "102",
    email: "",
  });
  assert.strictEqual(byRoom.queued, true);
  const rejectMail = db.listDueGuestServiceEmails().find((r) => r.to_email === "arta@hotel.test");
  assert.strictEqual(
    rejectMail.body,
    "Na vjen keq, shërbimi Pastrim nuk është i disponueshëm momentalisht.",
  );

  db.answerPublicServiceRequest("svc-arta", "accepted", "Recepsion", {
    service_name: "Masazh",
    guest_name: "Arta Fiktive",
    guest_email: "arta@hotel.test",
    room_number: "102",
  });
  db.checkOutGuest(room.id, { waiter_name: "Fiktiv Recep", payment_method: "cash" });
  const after = db.listActiveServiceRegister();
  assert.ok(after.some((r) => r.ref_key === "public:svc-xhakuzi" && r.status === "accepted"));
  assert.ok(!after.some((r) => r.ref_key === "public:svc-arta"));
  const history = db.db.prepare(
    "SELECT status FROM hotel_service_register WHERE ref_key = 'public:svc-arta'",
  ).get();
  assert.strictEqual(history.status, "paid");

  const diary = db.listHotelDiary({});
  assert.ok(diary.some((r) => r.event_type === "check_in" && r.guest_name === "Arta Fiktive"));
  assert.ok(diary.some((r) => r.event_type === "check_out" && r.room_number === "102"));
  assert.ok(diary.some((r) => r.event_type === "payment"));
  assert.ok(diary.some((r) => r.event_type === "service_order" && String(r.detail).includes("Xhakuzi")));
  const filtered = db.listHotelDiary({ room: "102", event_type: "check_out" });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(stay.guest.guest_name, "Arta Fiktive");

  console.log("public-service-stays.test.js OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
