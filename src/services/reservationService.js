const { getSupabase } = require("../db");
const { loadAreasForClient } = require("./venueService");
const { buildTablesFromAreas } = require("../lib/tableLayout");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ACTIVE_STATUSES = ["pending", "confirmed"];

function parseDateStr(raw) {
  const s = String(raw || "").trim();
  if (!DATE_RE.test(s)) throw new Error("Data duhet në formatin YYYY-MM-DD.");
  return s;
}

function parseTimeStr(raw) {
  const s = String(raw || "").trim().slice(0, 5);
  if (!TIME_RE.test(s)) throw new Error("Ora duhet në formatin HH:MM.");
  return `${s}:00`;
}

function mapReservation(row) {
  if (!row) return null;
  const time = String(row.time || "").slice(0, 5);
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    table_number: Number(row.table_number),
    customer_name: String(row.customer_name || "").trim(),
    customer_phone: String(row.customer_phone || "").trim(),
    date: String(row.date || "").slice(0, 10),
    time,
    guests: Number(row.guests) || 1,
    notes: String(row.notes || "").trim(),
    status: row.status,
    created_at: row.created_at,
  };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function getMaxTableNumber(clientId) {
  const db = getSupabase();
  const { data: settings } = await db
    .from("pos_settings")
    .select("table_count")
    .eq("client_id", clientId)
    .maybeSingle();
  const areas = await loadAreasForClient(clientId);
  const layout = buildTablesFromAreas(areas, settings?.table_count, new Map());
  return layout.table_count || 0;
}

async function assertValidTable(clientId, tableNumber) {
  const n = Number(tableNumber);
  if (!Number.isInteger(n) || n < 1) throw new Error("Numri i tavolinës nuk është i vlefshëm.");
  const max = await getMaxTableNumber(clientId);
  if (max > 0 && n > max) {
    throw new Error(`Tavolina T${n} nuk ekziston (max T${max}).`);
  }
  return n;
}

function assertFutureOrTodayDate(dateStr) {
  const today = todayIso();
  if (dateStr < today) throw new Error("Data e rezervimit nuk mund të jetë në të kaluarën.");
}

async function listOwnerReservations(clientId, { date, from, to } = {}) {
  const db = getSupabase();
  let query = db
    .from("reservations")
    .select("*")
    .eq("restaurant_id", clientId)
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (date) {
    query = query.eq("date", parseDateStr(date));
  } else if (from || to) {
    const fromDate = parseDateStr(from || to);
    const toDate = parseDateStr(to || from);
    if (fromDate > toDate) throw new Error("Intervali i datave nuk është i vlefshëm.");
    query = query.gte("date", fromDate).lte("date", toDate);
  } else {
    query = query.eq("date", todayIso());
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapReservation);
}

async function createOwnerReservation(clientId, body) {
  const customer_name = String(body?.customer_name || "").trim();
  if (!customer_name) throw new Error("Emri i klientit është i detyrueshëm.");

  const date = parseDateStr(body?.date);
  assertFutureOrTodayDate(date);
  const time = parseTimeStr(body?.time);
  const table_number = await assertValidTable(clientId, body?.table_number);
  const guests = Math.min(50, Math.max(1, Number(body?.guests) || 2));
  const customer_phone = String(body?.customer_phone || "").trim().slice(0, 40);
  const notes = String(body?.notes || "").trim().slice(0, 500);

  const db = getSupabase();
  const { data, error } = await db
    .from("reservations")
    .insert({
      restaurant_id: clientId,
      table_number,
      customer_name,
      customer_phone,
      date,
      time,
      guests,
      notes,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) throw error;
  return mapReservation(data);
}

async function updateOwnerReservationStatus(clientId, reservationId, status) {
  const id = String(reservationId || "").trim();
  if (!UUID_RE.test(id)) throw new Error("ID rezervimi nuk është i vlefshëm.");

  const next = String(status || "").trim().toLowerCase();
  if (!["pending", "confirmed", "cancelled"].includes(next)) {
    throw new Error("Statusi duhet të jetë pending, confirmed ose cancelled.");
  }

  const db = getSupabase();
  const { data, error } = await db
    .from("reservations")
    .update({ status: next })
    .eq("id", id)
    .eq("restaurant_id", clientId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Rezervimi nuk u gjet.");
  return mapReservation(data);
}

async function listWaiterReservations(clientId, dateStr) {
  const date = dateStr ? parseDateStr(dateStr) : todayIso();
  const db = getSupabase();
  const { data, error } = await db
    .from("reservations")
    .select("*")
    .eq("restaurant_id", clientId)
    .eq("date", date)
    .in("status", ACTIVE_STATUSES)
    .order("time", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapReservation);
}

function reservationsByTable(reservations) {
  const map = new Map();
  for (const row of reservations || []) {
    const n = Number(row.table_number);
    if (!n) continue;
    if (!map.has(n)) map.set(n, row);
  }
  return map;
}

function attachReservationsToLayout(layout, reservations) {
  const byTable = reservationsByTable(reservations);
  const enrich = (t) => {
    const reservation = byTable.get(t.number) || null;
    return {
      ...t,
      reservation,
      reserved: Boolean(reservation),
    };
  };
  return {
    ...layout,
    tables: (layout.tables || []).map(enrich),
    areas: (layout.areas || []).map(a => ({
      ...a,
      tables: (a.tables || []).map(enrich),
    })),
  };
}

module.exports = {
  listOwnerReservations,
  createOwnerReservation,
  updateOwnerReservationStatus,
  listWaiterReservations,
  attachReservationsToLayout,
  getMaxTableNumber,
  mapReservation,
};
