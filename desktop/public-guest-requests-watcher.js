/**
 * Poll kërkesat publike (rezervim + shërbime) nga cloud — recepsioni lexon SQLite,
 * edhe kur STAFF_CLOUD_FEATURES_DISABLED (si online-orders-watcher).
 */
"use strict";

const cloudSync = require("./cloud-sync");

const POLL_MS = 8_000;
let timer = null;
let tickInFlight = null;

async function pullPublicGuestRequests(db) {
  if (!db || !cloudSync.isCloudConfigured(db)) {
    return { ok: false, skipped: true, bookings: 0, services: 0 };
  }
  const hotelCloudSync = require("./hotel-cloud-sync");
  let bookings = [];
  let services = [];
  try {
    const b = await hotelCloudSync.listPublicBookingRequestsPending(db);
    bookings = Array.isArray(b.requests) ? b.requests : [];
  } catch (err) {
    console.warn("[public-guest-requests] bookings:", err.message || err);
  }
  try {
    const s = await hotelCloudSync.listPublicServiceRequestsPending(db, { status: "open" });
    const rows = Array.isArray(s.requests) ? s.requests : [];
    services = rows.filter((r) => {
      const st = String(r.status || "pending").toLowerCase();
      return st === "pending" || st === "new" || st === "open";
    });
  } catch (err) {
    console.warn("[public-guest-requests] services:", err.message || err);
  }
  if (typeof db.reconcilePendingPublicBookingRequests === "function") {
    db.reconcilePendingPublicBookingRequests(bookings);
  }
  if (typeof db.reconcilePendingPublicServiceRequests === "function") {
    db.reconcilePendingPublicServiceRequests(services);
  }
  return { ok: true, bookings: bookings.length, services: services.length };
}

function ensurePublicGuestRequestsWatcher(db) {
  if (!db || timer) return;
  const run = () => {
    if (tickInFlight) return;
    tickInFlight = pullPublicGuestRequests(db).finally(() => {
      tickInFlight = null;
    });
  };
  timer = setInterval(run, POLL_MS);
  run();
}

async function refreshPublicGuestRequests(db) {
  return pullPublicGuestRequests(db);
}

module.exports = {
  POLL_MS,
  ensurePublicGuestRequestsWatcher,
  refreshPublicGuestRequests,
  pullPublicGuestRequests,
};
