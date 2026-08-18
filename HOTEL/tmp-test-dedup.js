process.env.DB_PATH = require("path").join(require("os").tmpdir(), "kafene-dedup-utc-" + Date.now() + ".db");
const db = require("./database.js");
db.runSetup({ restaurant_name: "Dedup", admin_password: "test1234", table_count: 5 });
db.addStaff("naser", "1234");
const staff = db.findStaffByName("naser");
db.openWaiterShiftWithCash(staff.id, 0);
const itemId = db.addMenuItem({ name: "Esp", category: "Pije të nxehta", price: 1 });
const table = db.getTableByNumber(5);
db.sendOrder({
  table_id: table.id,
  waiter_name: "naser",
  items: [{ menu_item_id: itemId, name: "Esp", price: 1, quantity: 1 }],
});
db.closeTable(table.id, "naser", false, "cash");
const before = db.db.prepare("SELECT id, time, total, cloud_sale_id FROM daily_log").all();
console.log("after local close", before);
// Simulate cloud echo with UTC closed_at (~2h behind local wall clock string style)
const now = new Date();
const utcIso = new Date(now.getTime()).toISOString(); // proper ISO UTC
const cloudId = "11111111-2222-4333-8444-555555555555";
const r = db.importClosedWebWaiterSaleFromCloud({
  id: cloudId,
  waiter_name: "naser",
  table_number: 5,
  total: 1,
  payment_method: "cash",
  closed_at: utcIso,
  items: [{ name: "Esp", price: 1, quantity: 1 }],
});
console.log("import result", r);
const after = db.db.prepare("SELECT id, time, total, cloud_sale_id FROM daily_log").all();
console.log("after import", after);
console.log("COUNT", after.length, after.length === 1 && after[0].cloud_sale_id === cloudId ? "PASS" : "FAIL");
