/**
 * Sync PMS hotel (dhoma, mysafirë, charges, pastrim, rezervime) ↔ Revolution HOTEL Server.
 */
const os = require("os");
const cloudHealth = require("./cloud-health");
const cloudSync = require("./cloud-sync");
const { hotelCloudApiPath } = require("./cloud-server-url");

const LAST_SYNC_KEY = "hotel_pms_last_sync_at";
const DEFAULT_SINCE = "1970-01-01T00:00:00.000Z";
const SYNC_TIMEOUT_MS = 45000;

function requestJson(method, path, payload, options = {}) {
  return cloudHealth.requestJsonWithFallback(
    method,
    hotelCloudApiPath(path),
    payload,
    { timeoutMs: SYNC_TIMEOUT_MS, ...options },
  );
}

function sql(db) {
  return db.db;
}

function parseJsonResponse(r) {
  let parsed = {};
  try {
    parsed = JSON.parse(r.data || "{}");
  } catch {
    parsed = {};
  }
  if (r.status >= 400 || parsed.ok === false) {
    const msg = parsed.gabim || parsed.message || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return parsed;
}

function getCfg(db) {
  cloudSync.ensureAutoCloudConfig?.(db);
  return cloudSync.getConfig(db);
}

function mapGuestStatusToCloud(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "active") return "checked_in";
  if (s === "checked_out") return "checked_out";
  return s || "checked_in";
}

function mapGuestStatusFromCloud(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "checked_in") return "active";
  if (s === "checked_out") return "checked_out";
  return s || "active";
}

function mapRoomToCloud(row) {
  return {
    local_room_id: row.id,
    id: row.id,
    room_number: row.room_number,
    room_type: row.type,
    type: row.type,
    floor: row.floor,
    price_per_night: row.price_per_night,
    status: row.status,
  };
}

function mapGuestToCloud(row) {
  return {
    local_guest_id: row.id,
    id: row.id,
    room_id: row.room_id,
    guest_name: row.guest_name,
    phone: row.phone,
    document_number: row.document_id,
    document_id: row.document_id,
    check_in_date: row.check_in_date,
    check_out_date: row.check_out_date,
    persons: row.persons,
    status: mapGuestStatusToCloud(row.status),
    total_paid: Number(row.total_paid) || 0,
    notes: row.notes,
  };
}

function mapChargeToCloud(row) {
  return {
    local_charge_id: row.id,
    id: row.id,
    guest_id: row.guest_id,
    room_id: row.room_id,
    description: row.description,
    amount: row.amount,
    charge_type: row.vat_category || row.charge_type || null,
    created_at: row.created_at,
  };
}

function mapHousekeepingToCloud(row) {
  const assignee = row.assigned_name != null
    ? String(row.assigned_name)
    : row.assigned_to != null && row.assigned_to !== ""
      ? String(row.assigned_to)
      : null;
  return {
    local_task_id: row.id,
    id: row.id,
    room_id: row.room_id,
    assigned_to: assignee,
    status: row.status,
    notes: row.notes,
  };
}

function mapReservationToCloud(row) {
  return {
    local_reservation_id: row.id,
    id: row.id,
    room_id: row.room_id ?? row.target_id,
    guest_name: row.guest_name || row.customer_name,
    phone: row.phone || row.customer_phone,
    check_in_date: row.check_in_date,
    check_out_date: row.check_out_date,
    persons: row.persons ?? row.guest_count,
    status: row.status,
    notes: row.notes,
  };
}

async function postSyncBatch(db, path, bodyKey, rows) {
  if (!cloudSync.isCloudConfigured(db)) {
    return { ok: false, skipped: true, upserted: 0 };
  }
  const cfg = getCfg(db);
  if (!cfg.celesi) return { ok: false, skipped: true, upserted: 0 };
  const payload = {
    celesi: cfg.celesi,
    device_id: cfg.deviceId,
    app_type: cfg.appType,
    hostname: os.hostname(),
    [bodyKey]: rows,
  };
  const r = await requestJson("POST", path, payload);
  const parsed = parseJsonResponse(r);
  return { ok: true, upserted: Number(parsed.upserted) || rows.length, ...parsed };
}

async function pushRoomsToCloud(db) {
  const rooms = db.listRooms().map(mapRoomToCloud);
  return postSyncBatch(db, "/api/v1/hotel/rooms/sync", "rooms", rooms);
}

async function pushGuestsToCloud(db) {
  const rows = sql(db).prepare("SELECT * FROM guests ORDER BY id ASC").all();
  const guests = rows.map(mapGuestToCloud);
  return postSyncBatch(db, "/api/v1/hotel/guests/sync", "guests", guests);
}

async function pushChargesToCloud(db) {
  const rows = sql(db).prepare("SELECT * FROM room_charges ORDER BY id ASC").all();
  const charges = rows.map(mapChargeToCloud);
  return postSyncBatch(db, "/api/v1/hotel/charges/sync", "charges", charges);
}

async function pushHousekeepingToCloud(db) {
  const rows = sql(db).prepare(`
    SELECT hk.*, s.name AS assigned_name
    FROM housekeeping_tasks hk
    LEFT JOIN staff s ON s.id = hk.assigned_to
    ORDER BY hk.id ASC
  `).all();
  const tasks = rows.map(mapHousekeepingToCloud);
  return postSyncBatch(db, "/api/v1/hotel/housekeeping/sync", "housekeeping", tasks);
}

async function pushReservationsToCloud(db) {
  const rows = sql(db).prepare(`
    SELECT * FROM reservations
    WHERE reservation_type IS NULL OR reservation_type = 'room'
    ORDER BY id ASC
  `).all();
  const reservations = rows.map(mapReservationToCloud);
  return postSyncBatch(db, "/api/v1/hotel/reservations/sync", "reservations", reservations);
}

function mapServiceCategoryToCloud(row) {
  return {
    local_category_id: row.id,
    id: row.id,
    name: row.name,
    icon: row.icon || "",
    photo: row.photo || "",
    sort_order: row.sort_order ?? 0,
  };
}

function mapServiceToCloud(row) {
  return {
    local_service_id: row.id,
    id: row.id,
    local_category_id: row.category_id,
    category_id: row.category_id,
    name: row.name,
    price: Number(row.price ?? 0) || 0,
    price_mode: row.price_mode || "fixed",
    vat_category: row.vat_category || "18",
    icon: row.icon || "",
    photo: row.photo || "",
    sort_order: row.sort_order ?? 0,
    active: row.active !== 0 && row.active !== false,
  };
}

function ensureServicesCatalogReady(db) {
  try {
    if (typeof db.ensureHotelServiceStockPhotos === "function") db.ensureHotelServiceStockPhotos();
    if (typeof db.ensureHotelServiceCategoryPhotos === "function") db.ensureHotelServiceCategoryPhotos();
  } catch {
    /* ignore */
  }
}

async function pushServiceCategoriesToCloud(db) {
  if (typeof db.listHotelServiceCategories !== "function") {
    return { ok: false, skipped: true, upserted: 0 };
  }
  ensureServicesCatalogReady(db);
  const categories = db.listHotelServiceCategories().map(mapServiceCategoryToCloud);
  return postSyncBatch(
    db,
    "/api/v1/hotel/service-categories/sync",
    "service_categories",
    categories,
  );
}

async function pushServicesToCloud(db) {
  if (typeof db.listHotelServices !== "function") {
    return { ok: false, skipped: true, upserted: 0 };
  }
  ensureServicesCatalogReady(db);
  const services = db.listHotelServices({ activeOnly: false }).map(mapServiceToCloud);
  return postSyncBatch(db, "/api/v1/hotel/services/sync", "services", services);
}

function mapHotelQrVenueToCloud(row) {
  return {
    local_venue_id: row.id,
    id: row.id,
    name: row.name,
    table_number: row.table_number,
    venue_code: row.venue_code || "",
    sort_order: row.sort_order ?? 0,
    active: row.active !== 0 && row.active !== false,
  };
}

async function pushHotelQrVenuesToCloud(db) {
  if (typeof db.listHotelQrVenues !== "function") {
    return { ok: false, skipped: true, upserted: 0 };
  }
  const venues = db.listHotelQrVenues({ activeOnly: false }).map(mapHotelQrVenueToCloud);
  return postSyncBatch(db, "/api/v1/hotel/qr-venues/sync", "qr_venues", venues);
}

function upsertRoomFromCloud(db, row) {
  const id = Number(row.local_room_id);
  if (!id) return false;
  const num = String(row.room_number ?? "").trim() || String(id);
  const floor = Number(row.floor) || 1;
  const type = String(row.room_type ?? row.type ?? "Single").trim() || "Single";
  const price = Number(row.price_per_night) || 0;
  const status = String(row.status ?? "free").trim() || "free";
  const existing = db.getRoomById(id);
  if (existing) {
    db.updateRoom(id, {
      room_number: num,
      floor,
      type,
      price_per_night: price,
      status,
    });
  } else {
    sql(db).prepare(`
      INSERT INTO rooms (id, room_number, floor, type, price_per_night, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, num, Math.trunc(floor), type, price, status);
  }
  return true;
}

function upsertGuestFromCloud(db, row) {
  const id = Number(row.local_guest_id);
  const roomId = Number(row.room_id);
  if (!id || !roomId) return false;
  const name = String(row.guest_name ?? "").trim() || "—";
  const phone = String(row.phone ?? "").trim();
  const doc = String(row.document_number ?? row.document_id ?? "").trim();
  const inDate = String(row.check_in_date ?? "").trim();
  const outDate = String(row.check_out_date ?? "").trim();
  if (!inDate || !outDate) return false;
  const persons = Math.max(1, Number(row.persons) || 1);
  const status = mapGuestStatusFromCloud(row.status);
  const totalPaid = Number(row.total_paid) || 0;
  const notes = String(row.notes ?? "").trim();
  const existing = db.getGuestById(id);
  if (existing) {
    sql(db).prepare(`
      UPDATE guests
      SET room_id = ?, guest_name = ?, phone = ?, document_id = ?,
          check_in_date = ?, check_out_date = ?, persons = ?, status = ?,
          total_paid = ?, notes = ?
      WHERE id = ?
    `).run(roomId, name, phone, doc, inDate, outDate, persons, status, totalPaid, notes, id);
  } else {
    sql(db).prepare(`
      INSERT INTO guests (
        id, room_id, guest_name, phone, document_id, email, nationality,
        persons, check_in_date, check_out_date, deposit, notes, status, total_paid
      ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, 0, ?, ?, ?)
    `).run(id, roomId, name, phone, doc, persons, inDate, outDate, notes, status, totalPaid);
  }
  return true;
}

function upsertChargeFromCloud(db, row) {
  const id = Number(row.local_charge_id);
  const guestId = Number(row.guest_id);
  const roomId = Number(row.room_id);
  if (!id || !guestId || !roomId) return false;
  const desc = String(row.description ?? "").trim() || "Charge";
  const amount = Number(row.amount) || 0;
  const created = String(row.created_at ?? "").trim() || null;
  const existing = sql(db).prepare("SELECT id FROM room_charges WHERE id = ?").get(id);
  if (existing) {
    sql(db).prepare(`
      UPDATE room_charges
      SET guest_id = ?, room_id = ?, description = ?, amount = ?
      WHERE id = ?
    `).run(guestId, roomId, desc, amount, id);
  } else if (created) {
    sql(db).prepare(`
      INSERT INTO room_charges (id, guest_id, room_id, description, amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, guestId, roomId, desc, amount, created);
  } else {
    sql(db).prepare(`
      INSERT INTO room_charges (id, guest_id, room_id, description, amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, guestId, roomId, desc, amount);
  }
  return true;
}

function parseAssignedToLocal(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

function roomStatusFromHousekeepingTask(hkStatus, currentRoomStatus) {
  const s = String(hkStatus || "").trim().toLowerCase();
  const cur = String(currentRoomStatus || "free").trim().toLowerCase();
  if (cur === "occupied") return "occupied";
  if (s === "maintenance") return "maintenance";
  if (s === "in_progress" || s === "dirty" || s === "pending") return "dirty";
  if (s === "clean") return "free";
  return cur;
}

function upsertHousekeepingFromCloud(db, row) {
  const id = Number(row.local_task_id);
  const roomId = Number(row.room_id);
  if (!id || !roomId) return false;
  const assigned = parseAssignedToLocal(row.assigned_to);
  const status = String(row.status ?? "dirty").trim() || "dirty";
  const notes = String(row.notes ?? "").trim();
  const existing = sql(db).prepare("SELECT id FROM housekeeping_tasks WHERE id = ?").get(id);
  if (existing) {
    sql(db).prepare(`
      UPDATE housekeeping_tasks
      SET room_id = ?, assigned_to = ?, status = ?, notes = ?
      WHERE id = ?
    `).run(roomId, assigned, status, notes, id);
  } else {
    sql(db).prepare(`
      INSERT INTO housekeeping_tasks (id, room_id, assigned_to, status, priority, notes)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(id, roomId, assigned, status, notes);
  }
  const room = db.getRoomById(roomId);
  if (room) {
    const nextStatus = roomStatusFromHousekeepingTask(status, room.status);
    if (nextStatus !== room.status) {
      db.updateRoom(roomId, { status: nextStatus });
    }
  }
  return true;
}

function upsertReservationFromCloud(db, row) {
  const id = Number(row.local_reservation_id);
  const roomId = Number(row.room_id);
  if (!id || !roomId) return false;
  const name = String(row.guest_name ?? "").trim() || "—";
  const phone = String(row.phone ?? "").trim();
  const inDate = String(row.check_in_date ?? "").trim();
  const outDate = String(row.check_out_date ?? "").trim();
  if (!inDate || !outDate) return false;
  const persons = Math.max(1, Number(row.persons) || 1);
  const status = String(row.status ?? "confirmed").trim() || "confirmed";
  const notes = String(row.notes ?? "").trim();
  const start = `${inDate} 14:00:00`;
  const end = `${outDate} 11:00:00`;
  const existing = sql(db).prepare("SELECT id FROM reservations WHERE id = ?").get(id);
  if (existing) {
    sql(db).prepare(`
      UPDATE reservations
      SET reservation_type = 'room', target_id = ?, room_id = ?,
          customer_name = ?, customer_phone = ?, guest_name = ?, phone = ?,
          check_in_date = ?, check_out_date = ?, persons = ?, guest_count = ?,
          start_time = ?, end_time = ?, status = ?, notes = ?
      WHERE id = ?
    `).run(
      roomId, roomId, name, phone, name, phone,
      inDate, outDate, persons, persons, start, end, status, notes, id,
    );
  } else {
    sql(db).prepare(`
      INSERT INTO reservations (
        id, reservation_type, target_id, customer_name, customer_phone,
        start_time, end_time, guest_count, room_id, guest_name, phone,
        check_in_date, check_out_date, persons, deposit, notes, status, sync_status
      ) VALUES (?, 'room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'cloud')
    `).run(
      id, roomId, name, phone, start, end, persons, roomId, name, phone,
      inDate, outDate, persons, notes, status,
    );
  }
  return true;
}

function applyPullPayload(db, data) {
  const applied = { rooms: 0, guests: 0, charges: 0, housekeeping: 0, reservations: 0 };
  for (const row of data.rooms || []) {
    if (upsertRoomFromCloud(db, row)) applied.rooms += 1;
  }
  for (const row of data.guests || []) {
    if (upsertGuestFromCloud(db, row)) applied.guests += 1;
  }
  for (const row of data.charges || []) {
    if (upsertChargeFromCloud(db, row)) applied.charges += 1;
  }
  for (const row of data.housekeeping || []) {
    if (upsertHousekeepingFromCloud(db, row)) applied.housekeeping += 1;
  }
  for (const row of data.reservations || []) {
    if (upsertReservationFromCloud(db, row)) applied.reservations += 1;
  }
  return applied;
}

async function pullHotelDataFromCloud(db, { forceFull = false } = {}) {
  if (!cloudSync.isCloudConfigured(db)) {
    return { ok: false, skipped: true, applied: {} };
  }
  const cfg = getCfg(db);
  if (!cfg.celesi) return { ok: false, skipped: true, applied: {} };

  let since = String(db.getSetting(LAST_SYNC_KEY, DEFAULT_SINCE) || DEFAULT_SINCE).trim()
    || DEFAULT_SINCE;
  if (forceFull) since = DEFAULT_SINCE;
  const path =
    `/api/v1/hotel/sync/pull?since=${encodeURIComponent(since)}`
    + `&celesi=${encodeURIComponent(cfg.celesi)}`;
  const r = await requestJson("GET", path, null);
  const parsed = parseJsonResponse(r);
  const applied = applyPullPayload(db, parsed);
  const syncStamp = new Date().toISOString();
  db.setSetting(LAST_SYNC_KEY, syncStamp);
  return {
    ok: true,
    since,
    applied,
    raw_counts: {
      rooms: (parsed.rooms || []).length,
      guests: (parsed.guests || []).length,
      charges: (parsed.charges || []).length,
      housekeeping: (parsed.housekeeping || []).length,
      reservations: (parsed.reservations || []).length,
    },
  };
}

/** Menjëherë pas check-in / check-out — mysafirët + statusi i dhomave (QR dhomë). */
async function pushGuestStaySnapshotToCloud(db) {
  if (!db || !cloudSync.isCloudConfigured(db)) {
    return { ok: false, skipped: true };
  }
  const cfg = getCfg(db);
  if (!cfg.celesi) return { ok: false, skipped: true };
  const rooms = await pushRoomsToCloud(db);
  const guests = await pushGuestsToCloud(db);
  const housekeeping = await pushHousekeepingToCloud(db);
  return { ok: true, rooms, guests, housekeeping };
}

async function applyPublicBookingsPendingFromCloud(db) {
  const cfg = getCfg(db);
  if (!cfg.celesi) return { ok: true, skipped: true, applied: 0, failed: 0 };
  const q = `celesi=${encodeURIComponent(cfg.celesi)}`;
  const listRes = await requestJson(
    "GET",
    `/api/v1/hotel/public-booking-requests/pending-pc-apply?${q}`,
    null,
  );
  const parsed = parseJsonResponse(listRes);
  const requests = Array.isArray(parsed.requests) ? parsed.requests : [];
  let applied = 0;
  let failed = 0;
  for (const b of requests) {
    const id = String(b.id || "").trim();
    const roomId = Number(b.booked_room_id);
    if (!id || !roomId) continue;
    try {
      const reservation = db.createRoomReservation({
        room_id: roomId,
        guest_name: b.guest_name,
        phone: b.phone,
        email: b.email,
        check_in_date: b.check_in_date,
        check_out_date: b.check_out_date,
        persons: b.persons,
        notes: b.notes ? `${b.notes} (web)` : "Rezervim nga faqja publike",
        status: "confirmed",
      });
      const ack = await requestJson(
        "POST",
        `/api/v1/hotel/public-booking-requests/${encodeURIComponent(id)}/pc-applied`,
        {
          celesi: cfg.celesi,
          local_reservation_id: reservation.id,
          room_id: roomId,
        },
      );
      parseJsonResponse(ack);
      applied += 1;
    } catch (err) {
      failed += 1;
      try {
        await requestJson(
          "POST",
          `/api/v1/hotel/public-booking-requests/${encodeURIComponent(id)}/pc-apply-failed`,
          { celesi: cfg.celesi, reason: err.message || "Dhoma e zënë." },
        );
      } catch {
        /* ignore */
      }
    }
  }
  if (applied > 0) {
    await pushReservationsToCloud(db);
  }
  return { ok: true, applied, failed, pending: requests.length };
}

/** Vetëm cloud → PC (rezervime nga telefon/web) — lejohet edhe Arka 2+. */
async function pullHotelPmsFromCloudOnly(db, { forceFull = false } = {}) {
  if (!db) return { ok: false, message: "DB mungon." };
  if (!cloudSync.isCloudConfigured(db)) {
    return { ok: false, skipped: true, message: "Cloud nuk është konfiguruar." };
  }
  const pull = await pullHotelDataFromCloud(db, { forceFull });
  try {
    if (typeof db.flushDatabase === "function") db.flushDatabase();
  } catch {
    /* ignore */
  }
  return { ok: true, pull };
}

async function fullHotelSync(db) {
  if (!db) return { ok: false, message: "DB mungon." };
  if (!cloudSync.isCloudConfigured(db)) {
    return { ok: false, skipped: true, message: "Cloud nuk është konfiguruar." };
  }
  let isSecondaryRegister = false;
  try {
    const license = require("./license");
    isSecondaryRegister = license.terminalRegisterNumber() >= 2;
    if (isSecondaryRegister) {
      const pull = await pullHotelDataFromCloud(db);
      const push = {
        rooms: await pushRoomsToCloud(db),
        guests: await pushGuestsToCloud(db),
        reservations: await pushReservationsToCloud(db),
        housekeeping: await pushHousekeepingToCloud(db),
      };
      try {
        if (typeof db.flushDatabase === "function") db.flushDatabase();
      } catch {
        /* ignore */
      }
      return { ok: true, secondary_register: true, pull, push };
    }
  } catch {
    /* ignore */
  }

  const syncStartedAt = new Date().toISOString();
  const push = {
    rooms: await pushRoomsToCloud(db),
    guests: await pushGuestsToCloud(db),
    charges: await pushChargesToCloud(db),
    housekeeping: await pushHousekeepingToCloud(db),
    reservations: await pushReservationsToCloud(db),
    service_categories: await pushServiceCategoriesToCloud(db),
    services: await pushServicesToCloud(db),
    qr_venues: await pushHotelQrVenuesToCloud(db),
  };

  const public_bookings = await applyPublicBookingsPendingFromCloud(db);
  const pull = await pullHotelDataFromCloud(db);
  db.setSetting(LAST_SYNC_KEY, syncStartedAt);

  try {
    if (typeof db.flushDatabase === "function") db.flushDatabase();
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    push,
    public_bookings,
    pull,
    last_hotel_sync: syncStartedAt,
  };
}

async function listPublicBookingRequestsPending(db) {
  const cfg = getCfg(db);
  if (!cfg.celesi) return { ok: true, skipped: true, requests: [] };
  const q = `celesi=${encodeURIComponent(cfg.celesi)}`;
  const r = await requestJson("GET", `/api/v1/hotel/public-booking-requests/pending?${q}`, null);
  return parseJsonResponse(r);
}

async function respondPublicBookingRequest(db, id, payload = {}) {
  const cfg = getCfg(db);
  if (!cfg.celesi) throw new Error("Cloud nuk është konfiguruar.");
  const r = await requestJson(
    "POST",
    `/api/v1/hotel/public-booking-requests/${encodeURIComponent(id)}/respond`,
    { celesi: cfg.celesi, ...payload },
  );
  return parseJsonResponse(r);
}

async function acceptPublicBookingRequest(db, id, payload = {}) {
  const cfg = getCfg(db);
  if (!cfg.celesi) throw new Error("Cloud nuk është konfiguruar.");
  const r = await requestJson(
    "POST",
    `/api/v1/hotel/public-booking-requests/${encodeURIComponent(id)}/accept`,
    { celesi: cfg.celesi, ...payload },
  );
  return parseJsonResponse(r);
}

async function deletePublicBookingRequest(db, id) {
  const cfg = getCfg(db);
  if (!cfg.celesi) throw new Error("Cloud nuk është konfiguruar.");
  const q = `celesi=${encodeURIComponent(cfg.celesi)}`;
  const r = await requestJson(
    "DELETE",
    `/api/v1/hotel/public-booking-requests/${encodeURIComponent(id)}?${q}`,
    null,
  );
  return parseJsonResponse(r);
}

async function listPublicServiceRequestsPending(db, { status = "open" } = {}) {
  const cfg = getCfg(db);
  if (!cfg.celesi) return { ok: true, skipped: true, requests: [] };
  const q =
    `celesi=${encodeURIComponent(cfg.celesi)}`
    + `&status=${encodeURIComponent(String(status || "open"))}`;
  const r = await requestJson("GET", `/api/v1/hotel/service-requests/pending?${q}`, null);
  return parseJsonResponse(r);
}

async function acceptPublicServiceRequest(db, id, payload = {}) {
  const cfg = getCfg(db);
  if (!cfg.celesi) throw new Error("Cloud nuk është konfiguruar.");
  const r = await requestJson(
    "POST",
    `/api/v1/hotel/service-requests/${encodeURIComponent(id)}/accept`,
    { celesi: cfg.celesi, ...payload },
  );
  return parseJsonResponse(r);
}

async function rejectPublicServiceRequest(db, id, payload = {}) {
  const cfg = getCfg(db);
  if (!cfg.celesi) throw new Error("Cloud nuk është konfiguruar.");
  const r = await requestJson(
    "POST",
    `/api/v1/hotel/service-requests/${encodeURIComponent(id)}/reject`,
    { celesi: cfg.celesi, ...payload },
  );
  return parseJsonResponse(r);
}

module.exports = {
  LAST_SYNC_KEY,
  listPublicBookingRequestsPending,
  respondPublicBookingRequest,
  acceptPublicBookingRequest,
  applyPublicBookingsPendingFromCloud,
  deletePublicBookingRequest,
  listPublicServiceRequestsPending,
  acceptPublicServiceRequest,
  rejectPublicServiceRequest,
  pushRoomsToCloud,
  pushGuestsToCloud,
  pushGuestStaySnapshotToCloud,
  pushChargesToCloud,
  pushHousekeepingToCloud,
  pushReservationsToCloud,
  pushServiceCategoriesToCloud,
  pushServicesToCloud,
  pushHotelQrVenuesToCloud,
  pullHotelDataFromCloud,
  pullHotelPmsFromCloudOnly,
  fullHotelSync,
};
