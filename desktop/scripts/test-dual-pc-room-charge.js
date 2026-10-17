"use strict";
/**
 * Prova 2 PC: faturë «në dhomë» Arka 2 → Kryesorja (LAN + import si relay).
 * Printerët off — vetëm DB/API logjikë. ≤ ~5 min.
 *
 * node scripts/test-dual-pc-room-charge.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-dual-pc-"));
const MASTER_DB = path.join(TMP, "master.db");
const SEC_DB = path.join(TMP, "secondary.db");
const STATE = path.join(TMP, "state.json");
const DEVICE_B = "AABBCCDDEEFF";
const DEVICE_C = "112233445566";
const TERT_DB = path.join(TMP, "tertiary.db");

function runPhase(label, dbPath, role, scriptBody) {
  const file = path.join(TMP, `${label}.js`);
  fs.writeFileSync(
    file,
    `
"use strict";
process.env.HOTEL_DB_PLAIN = "1";
process.env.DB_PATH = ${JSON.stringify(dbPath)};
process.env.HOTEL_TERMINAL_ROLE = ${JSON.stringify(role)};
const db = require(${JSON.stringify(path.join(ROOT, "database.js"))});
db.whenReady().then(() => {
${scriptBody}
}).catch((e) => { console.error(e); process.exit(1); });
`,
    "utf8",
  );
  const r = spawnSync(process.execPath, [file], { encoding: "utf8", cwd: ROOT });
  if (r.status !== 0) {
    console.error(`[dual-pc] Faza ${label} DËSHTOI:\n`, r.stdout, r.stderr);
    process.exit(r.status || 1);
  }
  return (r.stdout || "").trim();
}

console.log("[dual-pc] TMP:", TMP);

runPhase(
  "master-setup",
  MASTER_DB,
  "arka1",
  `
db.runSetup({ restaurant_name: "Dual PC Test", admin_password: "x", table_count: 5 });
const rooms = db.listRooms();
const room = rooms.find((r) => String(r.room_number) === "101") || rooms[0];
const { guest } = db.checkInGuest({
  room_id: room.id,
  guest_name: "Test Mysafir",
  check_in_date: new Date().toISOString().slice(0, 10),
  check_out_date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
  persons: 1,
});
db.addCategory("T");
const mid = db.addMenuItem({ name: "Lunch", category: "T", price: 10 });
require("fs").writeFileSync(${JSON.stringify(STATE)}, JSON.stringify({
  room_number: room.room_number,
  room_id: room.id,
  guest_id: guest.id,
  menu_item_id: mid,
}), "utf8");
db.setSetting("max_registers", "3");
console.log("OK master-setup");
`,
);

const state = JSON.parse(fs.readFileSync(STATE, "utf8"));

runPhase(
  "secondary-enqueue",
  SEC_DB,
  "arka2",
  `
db.runSetup({ restaurant_name: "Dual PC Sec", admin_password: "x", table_count: 5 });
db.setLanOutboxEnabled(true);
db.cacheTerminalOccupiedRoomsFromMaster([{
  room_number: ${JSON.stringify(String(state.room_number))},
  room_id: ${Number(state.room_id)},
  guest_name: "Test Mysafir",
  guest_id: ${Number(state.guest_id)},
  check_in_date: new Date().toISOString().slice(0, 10),
  persons: 1,
}]);
db.enqueueRoomChargeToMaster({
  ref: 9001,
  room_number: ${JSON.stringify(String(state.room_number))},
  guest_name: "Test Mysafir",
  table_number: 1,
  items: [{ name: "Lunch", price: 10, quantity: 1, menu_item_id: ${Number(state.menu_item_id)} }],
  fallback_total: 10,
});
const row = db.getLanOutboxPending(10).find((x) => x.kind === "room_charge");
if (!row) throw new Error("room_charge nuk u enqueue");
require("fs").writeFileSync(${JSON.stringify(path.join(TMP, "payload1.json"))}, JSON.stringify(row.payload), "utf8");
console.log("OK secondary-enqueue");
`,
);

const payload1 = JSON.parse(fs.readFileSync(path.join(TMP, "payload1.json"), "utf8"));

runPhase(
  "master-lan-import",
  MASTER_DB,
  "arka1",
  `
const payload = ${JSON.stringify(payload1)};
const src = { device_id: ${JSON.stringify(DEVICE_B)}, register_number: 2 };
const a = db.importRoomChargesFromTerminal([payload], src);
if (!a.accepted.length) throw new Error("LAN import dështoi: " + JSON.stringify(a.rejected));
const sum = db.sumRoomChargesForGuest(${Number(state.guest_id)});
if (Math.abs(sum - 10) > 0.01) throw new Error("Folio duhet 10€, got " + sum);
const dup = db.importRoomChargesFromTerminal([payload], src);
const sum2 = db.sumRoomChargesForGuest(${Number(state.guest_id)});
if (Math.abs(sum2 - 10) > 0.01) throw new Error("Dyfishim pas re-import: " + sum2);
console.log("OK master-lan-import sum=" + sum2);
`,
);

runPhase(
  "secondary-relay-enqueue",
  SEC_DB,
  "arka2",
  `
db.setLanOutboxEnabled(true);
db.enqueueRoomChargeToMaster({
  ref: 9002,
  room_number: ${JSON.stringify(String(state.room_number))},
  guest_name: "Test Mysafir",
  table_number: 2,
  items: [{ name: "Lunch", price: 10, quantity: 1 }],
  fallback_total: 10,
});
const row = db.getLanOutboxPending(10).filter((x) => x.kind === "room_charge" && x.ref === 9002)[0];
if (!row) throw new Error("relay payload mungon");
require("fs").writeFileSync(${JSON.stringify(path.join(TMP, "payload2.json"))}, JSON.stringify(row.payload), "utf8");
console.log("OK secondary-relay-enqueue");
`,
);

const payload2 = JSON.parse(fs.readFileSync(path.join(TMP, "payload2.json"), "utf8"));

runPhase(
  "master-relay-import",
  MASTER_DB,
  "arka1",
  `
const payload = ${JSON.stringify(payload2)};
const src = { device_id: ${JSON.stringify(DEVICE_B)}, register_number: 2 };
db.importRoomChargesFromTerminal([payload], src);
const sum = db.sumRoomChargesForGuest(${Number(state.guest_id)});
if (Math.abs(sum - 20) > 0.01) throw new Error("Pas relay duhet 20€, got " + sum);
db.touchRemoteRegister(${JSON.stringify(DEVICE_B)}, 2, { pending_room_charges: 1, via: "cloud" }, "127.0.0.1");
const warn = db.getCheckoutPendingRoomChargeWarning();
if (!warn.has_pending) throw new Error("Checkout duhet paralajmërim pending");
console.log("OK master-relay-import sum=" + sum + " warn=" + warn.pending_count);
`,
);

runPhase(
  "master-checkout",
  MASTER_DB,
  "arka1",
  `
db.touchRemoteRegister(${JSON.stringify(DEVICE_B)}, 2, { pending_room_charges: 0, via: "cloud" }, "127.0.0.1");
const preview = db.getCheckoutPreview(${Number(state.room_id)});
const chargesTotal = (preview.bill.charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
if (Math.abs(chargesTotal - 20) > 0.01) throw new Error("Checkout preview charges " + chargesTotal);
const { buildOwnerDailySnapshot } = require(${JSON.stringify(path.join(ROOT, "owner-report-snapshot.js"))});
const day = new Date().toISOString().slice(0, 10);
const snap = buildOwnerDailySnapshot(db, day);
const rest = Number(snap?.analytics?.restaurantSales?.total ?? snap?.restaurantSales?.total ?? 0);
if (rest > 0.01) {
  console.warn("[dual-pc] vërejtje: restaurantSales=" + rest + " (room charges nuk duhet dyfishuar këtu)");
}
console.log("OK master-checkout charges=" + chargesTotal);
`,
);

runPhase(
  "secondary-reject-free-room",
  SEC_DB,
  "arka2",
  `
db.setLanOutboxEnabled(true);
db.cacheTerminalOccupiedRoomsFromMaster([{
  room_number: ${JSON.stringify(String(state.room_number))},
  guest_name: "Test Mysafir",
  guest_id: ${Number(state.guest_id)},
}]);
const rooms = db.listRooms();
const freeRoom = rooms.find((r) => String(r.room_number) !== ${JSON.stringify(String(state.room_number))}) || rooms[1];
if (!freeRoom) throw new Error("Ska dhomë të lirë për provë");
try {
  db.assertChargeToRoomAgainstMasterOccupiedList(freeRoom.id);
  throw new Error("Duhet refuzuar dhomë jo e zënë te Kryesorja");
} catch (e) {
  if (!String(e.message || "").includes("nuk është e zënë")) throw e;
}
try {
  db.cacheTerminalOccupiedRoomsFromMaster([]);
  db.assertChargeToRoomAgainstMasterOccupiedList(${Number(state.room_id)});
  throw new Error("Duhet refuzuar kur lista mungon");
} catch (e2) {
  if (!String(e2.message || "").includes("mungon")) throw e2;
}
console.log("OK secondary-reject-free-room");
`,
);

runPhase(
  "master-reject-no-guest",
  MASTER_DB,
  "arka1",
  `
const payload = {
  ref: 9099,
  room_number: "9999",
  guest_name: "",
  table_number: 1,
  items: [{ name: "X", price: 5, quantity: 1 }],
  fallback_total: 5,
};
const r = db.importRoomChargesFromTerminal([payload], { device_id: ${JSON.stringify(DEVICE_B)}, register_number: 2 });
if (!r.rejected.length) throw new Error("Kryesorja duhet refuzuar dhomë pa mysafir");
console.log("OK master-reject-no-guest: " + r.rejected[0].gabim);
`,
);

runPhase(
  "tertiary-enqueue",
  TERT_DB,
  "arka3",
  `
db.runSetup({ restaurant_name: "Dual PC Arka3", admin_password: "x", table_count: 5 });
db.setLanOutboxEnabled(true);
db.cacheTerminalOccupiedRoomsFromMaster([{
  room_number: ${JSON.stringify(String(state.room_number))},
  room_id: ${Number(state.room_id)},
  guest_name: "Test Mysafir",
  guest_id: ${Number(state.guest_id)},
}]);
db.enqueueRoomChargeToMaster({
  ref: 9003,
  room_number: ${JSON.stringify(String(state.room_number))},
  guest_name: "Test Mysafir",
  table_number: 3,
  items: [{ name: "Lunch", price: 10, quantity: 1 }],
  fallback_total: 10,
});
const row = db.getLanOutboxPending(10).find((x) => x.kind === "room_charge" && x.ref === 9003);
if (!row) throw new Error("Arka 3 room_charge nuk u enqueue");
require("fs").writeFileSync(${JSON.stringify(path.join(TMP, "payload3.json"))}, JSON.stringify(row.payload), "utf8");
console.log("OK tertiary-enqueue");
`,
);

const payload3 = JSON.parse(fs.readFileSync(path.join(TMP, "payload3.json"), "utf8"));

runPhase(
  "master-arka3-import",
  MASTER_DB,
  "arka1",
  `
const payload = ${JSON.stringify(payload3)};
const src = { device_id: ${JSON.stringify(DEVICE_C)}, register_number: 3 };
const a = db.importRoomChargesFromTerminal([payload], src);
if (!a.accepted.length) throw new Error("Arka 3 import: " + JSON.stringify(a.rejected));
const sum = db.sumRoomChargesForGuest(${Number(state.guest_id)});
if (Math.abs(sum - 30) > 0.01) throw new Error("Pas Arka 3 duhet 30€, got " + sum);
console.log("OK master-arka3-import sum=" + sum);
`,
);

console.log("[dual-pc] TË GJITHA FAZAT: PO");
console.log("[dual-pc] Cloud: nuk u prek (relay simuluar me import direkt).");
