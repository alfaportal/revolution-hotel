/** Bllokim 15s POS ↔ kamarier telefon (WEB-WAITER) për të njëjtën tavolinë — vetëm memorie. */
const LOCK_MS = 15_000;

/** @type {Map<string, { locked_by: string, locked_at: number }>} */
const locks = new Map();

const MSG_BLOCKED_BY_POS =
  "Tavolina është duke u përditësuar nga POS, provo përsëri pas disa sekondave";
const MSG_BLOCKED_BY_WEB =
  "Tavolina është duke u përditësuar nga kamarieri (telefon), provo përsëri pas disa sekondave";

function lockKey(clientId, tableNum) {
  return `${String(clientId || "").trim()}:${Number(tableNum)}`;
}

/** @returns {"pos"|"web_waiter"|null} */
function tableOrderLockActor(deviceId) {
  const { isPosDesktopDevice, WEB_WAITER } = require("./orderSource");
  const d = String(deviceId || "").trim().toUpperCase();
  if (isPosDesktopDevice(d)) return "pos";
  if (d === WEB_WAITER) return "web_waiter";
  return null;
}

function getActiveLock(clientId, tableNum) {
  const key = lockKey(clientId, tableNum);
  const entry = locks.get(key);
  if (!entry) return null;
  if (Date.now() - entry.locked_at > LOCK_MS) {
    locks.delete(key);
    return null;
  }
  return entry;
}

function assertTableOrderChannel(clientId, tableNum, actor) {
  if (!actor || !(Number(tableNum) >= 1)) return;
  const active = getActiveLock(clientId, tableNum);
  if (!active || active.locked_by === actor) return;
  throw new Error(active.locked_by === "pos" ? MSG_BLOCKED_BY_POS : MSG_BLOCKED_BY_WEB);
}

function touchTableOrderLock(clientId, tableNum, actor) {
  if (!actor || !(Number(tableNum) >= 1)) return;
  locks.set(lockKey(clientId, tableNum), { locked_by: actor, locked_at: Date.now() });
}

module.exports = {
  LOCK_MS,
  tableOrderLockActor,
  assertTableOrderChannel,
  touchTableOrderLock,
};
