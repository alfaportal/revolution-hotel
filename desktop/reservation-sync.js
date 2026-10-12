"use strict";
/** SYNC RESET (Step 2) — vetëm rezervime lokale (pa cloud). */

function attachReservationsToTables(db, tables) {
  const list = Array.isArray(tables) ? tables : [];
  const today = db.getTodayReservationsForTables?.() || [];
  const byTable = new Map(today.map((r) => [Number(r.table_number), r]));
  return list.map((t) => ({
    ...t,
    reservation: byTable.get(Number(t.number)) || null,
  }));
}

async function listReservations(db, query = {}) {
  const rows = db.listLocalReservations?.(query) || [];
  return { reservations: rows, offline: true };
}

async function createReservation(db, body) {
  const id = db.insertLocalReservation?.({
    ...body,
    sync_status: "local",
  });
  return { ok: true, id, offline: true };
}

async function updateReservationStatus(db, reservationId, status) {
  db.updateLocalReservationSync?.(reservationId, { status, sync_status: "local" });
  return { ok: true, offline: true };
}

async function syncPendingReservations(db) {
  return { ok: true, synced: 0, skipped: true };
}

function scheduleReservationSync() {}

function startReservationSyncInterval() {}

async function isCloudOnline() {
  return false;
}

module.exports = {
  listReservations,
  createReservation,
  updateReservationStatus,
  syncPendingReservations,
  attachReservationsToTables,
  scheduleReservationSync,
  startReservationSyncInterval,
  isCloudOnline,
};
