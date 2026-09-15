/**
 * Rezervime offline — ruan lokalisht, sinkronizon me cloud kur kthehet lidhja.
 */
const crypto = require("crypto");
const cloudSync = require("./cloud-sync");

const ACTIVE = ["pending", "confirmed"];

function newLocalId() {
  return `local-${crypto.randomUUID()}`;
}

function normalizeTime(raw) {
  const s = String(raw || "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : "19:00";
}

function normalizeBody(body = {}) {
  const customer_name = String(body.customer_name || "").trim();
  if (!customer_name) throw new Error("Emri i klientit është i detyrueshëm.");
  const date = String(body.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data e rezervimit mungon.");
  const table_number = Number(body.table_number);
  if (!Number.isInteger(table_number) || table_number < 1) {
    throw new Error("Numri i tavolinës nuk është i vlefshëm.");
  }
  return {
    customer_name,
    customer_phone: String(body.customer_phone || "").trim().slice(0, 40),
    table_number,
    date,
    time: normalizeTime(body.time),
    guests: Math.min(50, Math.max(1, Number(body.guests) || 2)),
    notes: String(body.notes || "").trim().slice(0, 500),
  };
}

function mapLocalRow(row) {
  if (!row) return null;
  const cloudId = row.cloud_id || null;
  const isPending = row.sync_status === "pending";
  const hasPendingStatus = !!(row.pending_status && row.cloud_id);
  return {
    id: cloudId || row.id,
    local_id: row.id,
    cloud_id: cloudId,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone || "",
    table_number: Number(row.table_number),
    date: String(row.date).slice(0, 10),
    time: String(row.time).slice(0, 5),
    guests: Number(row.guests) || 2,
    notes: row.notes || "",
    status: row.status,
    sync_status: row.sync_status,
    conflict_message: row.conflict_message || "",
    pending_sync: isPending || hasPendingStatus,
    created_at: row.created_at,
  };
}

function mapCloudReservation(r) {
  return {
    id: r.id,
    local_id: null,
    cloud_id: r.id,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone || "",
    table_number: Number(r.table_number),
    date: String(r.date).slice(0, 10),
    time: String(r.time).slice(0, 5),
    guests: Number(r.guests) || 2,
    notes: r.notes || "",
    status: r.status,
    sync_status: "synced",
    conflict_message: "",
    pending_sync: false,
    created_at: r.created_at,
  };
}

function cacheCloudReservations(db, reservations) {
  for (const r of reservations || []) {
    if (!r?.id) continue;
    db.upsertReservationLocal({
      id: r.id,
      cloud_id: r.id,
      customer_name: r.customer_name,
      customer_phone: r.customer_phone || "",
      table_number: r.table_number,
      date: r.date,
      time: r.time,
      guests: r.guests,
      notes: r.notes || "",
      status: r.status,
      sync_status: "synced",
      conflict_message: "",
      pending_status: null,
    });
  }
}

function activeSlotConflict(list, tableNumber, time, excludeId = "") {
  const t = normalizeTime(time);
  for (const r of list || []) {
    if (excludeId && (r.id === excludeId || r.local_id === excludeId)) continue;
    if (Number(r.table_number) !== Number(tableNumber)) continue;
    if (!ACTIVE.includes(String(r.status).toLowerCase())) continue;
    if (r.sync_status === "conflict") continue;
    if (normalizeTime(r.time) === t) return r;
  }
  return null;
}

async function isCloudOnline(db) {
  try {
    if (!cloudSync.isCloudConfigured(db)) return false;
    const status = await cloudSync.checkConnection(db);
    return !!status.connected;
  } catch {
    return false;
  }
}

function mergeReservationLists(cloudList, localRows) {
  const byKey = new Map();
  for (const r of cloudList || []) {
    const m = mapCloudReservation(r);
    byKey.set(m.id, m);
  }
  for (const row of localRows || []) {
    const m = mapLocalRow(row);
    if (m.sync_status === "pending" || m.sync_status === "conflict") {
      byKey.set(m.local_id, m);
      continue;
    }
    if (m.cloud_id && byKey.has(m.cloud_id)) continue;
    if (m.cloud_id) byKey.set(m.cloud_id, m);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
}

async function listReservations(db, query = {}) {
  const settings = db.getSettings();
  const localRows = db.listLocalReservations(query);
  let cloudReservations = [];
  let table_count = Number(settings.table_count) || 10;
  let online = false;

  if (cloudSync.isCloudConfigured(db)) {
    try {
      const data = await cloudSync.listCloudReservations(db, query);
      cloudReservations = data.reservations || [];
      table_count = Number(data.table_count) || table_count;
      online = true;
      cacheCloudReservations(db, cloudReservations);
    } catch {
      cloudReservations = localRows
        .filter(r => r.cloud_id && r.sync_status === "synced")
        .map(r => mapLocalRow(r));
    }
  } else {
    cloudReservations = localRows
      .filter(r => r.cloud_id && r.sync_status === "synced")
      .map(r => mapLocalRow(r));
  }

  const reservations = mergeReservationLists(
    cloudReservations.length ? cloudReservations : null,
    localRows,
  );

  if (!cloudReservations.length && !online) {
    // offline-only view from local cache + pending
    const merged = mergeReservationLists(null, localRows);
    return {
      reservations: merged,
      table_count,
      online: false,
      pending_sync_count: merged.filter(r => r.pending_sync).length,
    };
  }

  return {
    reservations,
    table_count,
    online,
    pending_sync_count: reservations.filter(r => r.pending_sync).length,
  };
}

async function createReservation(db, body) {
  const payload = normalizeBody(body);
  const existing = (await listReservations(db, { date: payload.date })).reservations;
  const conflict = activeSlotConflict(existing, payload.table_number, payload.time);
  if (conflict) {
    throw new Error(
      `T${payload.table_number} është e rezervuar në ${normalizeTime(conflict.time)} (${conflict.customer_name}).`,
    );
  }

  const online = await isCloudOnline(db);
  if (online) {
    try {
      const data = await cloudSync.createCloudReservation(db, payload);
      cacheCloudReservations(db, [data.reservation]);
      return {
        reservation: mapCloudReservation(data.reservation),
        offline: false,
      };
    } catch (err) {
      const msg = err.message || "";
      const isNetwork = /timeout|ECONNREFUSED|ENOTFOUND|network|Pa internet|lidh/i.test(msg);
      if (!isNetwork) throw err;
    }
  }

  const localId = newLocalId();
  db.insertLocalReservation({
    id: localId,
    cloud_id: null,
    ...payload,
    status: "pending",
    sync_status: "pending",
    conflict_message: "",
    pending_status: null,
  });

  return {
    reservation: mapLocalRow(db.getLocalReservation(localId)),
    offline: true,
    message: "Ruajtur lokalisht — do të sinkronizohet kur kthehet interneti.",
  };
}

async function updateReservationStatus(db, reservationId, status) {
  const next = String(status || "").trim().toLowerCase();
  if (!["pending", "confirmed", "cancelled"].includes(next)) {
    throw new Error("Statusi duhet të jetë pending, confirmed ose cancelled.");
  }

  const local = db.getLocalReservation(reservationId);
  const cloudId = local?.cloud_id || (String(reservationId).startsWith("local-") ? null : reservationId);
  const localId = local?.id || (String(reservationId).startsWith("local-") ? reservationId : null);

  if (localId && local?.sync_status === "pending" && !cloudId) {
    db.updateLocalReservationSync(localId, { status: next, pending_status: null });
    return { reservation: mapLocalRow(db.getLocalReservation(localId)), offline: true };
  }

  const online = await isCloudOnline(db);
  if (online && cloudId) {
    try {
      const data = await cloudSync.updateCloudReservationStatus(db, cloudId, next);
      cacheCloudReservations(db, [data.reservation]);
      if (localId) {
        db.updateLocalReservationSync(localId, {
          status: next,
          sync_status: "synced",
          pending_status: null,
          cloud_id: cloudId,
        });
      }
      return { reservation: mapCloudReservation(data.reservation), offline: false };
    } catch (err) {
      const isNetwork = /timeout|ECONNREFUSED|ENOTFOUND|network|Pa internet|lidh/i.test(err.message || "");
      if (!isNetwork) throw err;
    }
  }

  const targetId = localId || cloudId || reservationId;
  db.updateLocalReservationSync(targetId, {
    status: local?.sync_status === "pending" ? next : (local?.status || next),
    pending_status: cloudId ? next : null,
  });
  return {
    reservation: mapLocalRow(db.getLocalReservation(targetId)),
    offline: true,
    message: "Ndryshimi u ruajt lokalisht — do të sinkronizohet me cloud.",
  };
}

function detectCloudConflict(existing, payload) {
  return activeSlotConflict(existing, payload.table_number, payload.time);
}

async function syncPendingReservations(db) {
  const result = { synced: 0, conflicts: 0, status_updates: 0, errors: [] };
  if (!cloudSync.isCloudConfigured(db)) return result;

  const online = await isCloudOnline(db);
  if (!online) return result;

  const pending = db.listPendingReservationSync();

  for (const row of pending) {
    try {
      if (row.sync_status === "pending" && !row.cloud_id) {
        const payload = {
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          table_number: row.table_number,
          date: row.date,
          time: normalizeTime(row.time),
          guests: row.guests,
          notes: row.notes,
        };

        let cloudList = [];
        try {
          const data = await cloudSync.listCloudReservations(db, { date: payload.date });
          cloudList = data.reservations || [];
        } catch {
          /* vazhdo me create */
        }

        const conflict = detectCloudConflict(
          cloudList.map(mapCloudReservation),
          payload,
        );
        if (conflict) {
          db.markReservationConflict(
            row.id,
            `T${payload.table_number} u rezervua online (${conflict.customer_name}, ${normalizeTime(conflict.time)}).`,
          );
          result.conflicts++;
          continue;
        }

        const data = await cloudSync.createCloudReservation(db, payload);
        db.updateLocalReservationSync(row.id, {
          cloud_id: data.reservation.id,
          sync_status: "synced",
          status: data.reservation.status,
          conflict_message: "",
          pending_status: null,
        });
        db.upsertReservationLocal({
          id: data.reservation.id,
          cloud_id: data.reservation.id,
          customer_name: data.reservation.customer_name,
          customer_phone: data.reservation.customer_phone,
          table_number: data.reservation.table_number,
          date: data.reservation.date,
          time: data.reservation.time,
          guests: data.reservation.guests,
          notes: data.reservation.notes,
          status: data.reservation.status,
          sync_status: "synced",
          conflict_message: "",
          pending_status: null,
        });
        result.synced++;
        continue;
      }

      if (row.pending_status && row.cloud_id) {
        const data = await cloudSync.updateCloudReservationStatus(
          db,
          row.cloud_id,
          row.pending_status,
        );
        db.updateLocalReservationSync(row.id, {
          status: data.reservation.status,
          sync_status: "synced",
          pending_status: null,
          conflict_message: "",
        });
        result.status_updates++;
      }
    } catch (err) {
      result.errors.push(`${row.id}: ${err.message}`);
    }
  }

  return result;
}

function attachReservationsToTables(db, tables) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.listLocalReservations({ date: today }).filter(r =>
    ACTIVE.includes(String(r.status).toLowerCase()) && r.sync_status !== "conflict",
  );
  const byTable = new Map();
  for (const r of rows) {
    const n = Number(r.table_number);
    if (!n || byTable.has(n)) continue;
    byTable.set(n, mapLocalRow(r));
  }
  return (tables || []).map(t => ({
    ...t,
    reservation: byTable.get(t.number) || null,
    reserved: byTable.has(t.number),
  }));
}

let syncTimer = null;

function scheduleReservationSync(db) {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncPendingReservations(db).catch(err => {
      console.warn("Reservation sync:", err.message);
    });
  }, 1500);
}

function startReservationSyncInterval(db, ms = 45000) {
  setInterval(() => {
    syncPendingReservations(db).catch(err => {
      console.warn("Reservation sync:", err.message);
    });
  }, ms);
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
