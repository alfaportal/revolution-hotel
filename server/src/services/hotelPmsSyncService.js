const { getSupabase } = require("../db");

function numLocalId(raw, fallbackKey = "id") {
  const n = Number(raw?.local_room_id ?? raw?.local_guest_id ?? raw?.[fallbackKey]);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function mapRoomRow(clientId, r) {
  const local_room_id = numLocalId(r, "id");
  if (local_room_id == null) return null;
  return {
    client_id: clientId,
    local_room_id,
    room_number: String(r.room_number ?? "").trim(),
    room_type: String(r.room_type ?? r.type ?? "").trim(),
    floor: r.floor != null && r.floor !== "" ? Math.trunc(Number(r.floor) || 0) : 0,
    price_per_night: Number(r.price_per_night) || 0,
    status: String(r.status || "free").trim().toLowerCase() || "free",
    updated_at: new Date().toISOString(),
  };
}

function mapGuestRow(clientId, g) {
  const local_guest_id = numLocalId(g, "id");
  if (local_guest_id == null) return null;
  const roomId = g.room_id != null ? Number(g.room_id) : null;
  return {
    client_id: clientId,
    local_guest_id,
    room_id: Number.isFinite(roomId) ? Math.trunc(roomId) : null,
    guest_name: String(g.guest_name ?? "").trim(),
    phone: String(g.phone ?? "").trim(),
    document_number: String(g.document_number ?? g.document_id ?? "").trim(),
    check_in_date: String(g.check_in_date ?? "").slice(0, 10),
    check_out_date: String(g.check_out_date ?? "").slice(0, 10),
    persons: Math.max(1, Number(g.persons) || 1),
    status: String(g.status || "checked_in").trim().toLowerCase() || "checked_in",
    total_paid: Number(g.total_paid) || 0,
    notes: String(g.notes ?? "").trim(),
    updated_at: new Date().toISOString(),
  };
}

async function pruneMissing(db, table, clientId, localKey, keepIds) {
  const { data, error } = await db
    .from(table)
    .select(localKey)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  const keep = new Set(keepIds);
  for (const row of data || []) {
    const id = Number(row[localKey]);
    if (!keep.has(id)) {
      const { error: delErr } = await db
        .from(table)
        .delete()
        .eq("client_id", clientId)
        .eq(localKey, id);
      if (delErr) throw new Error(delErr.message);
    }
  }
}

async function syncHotelRooms(clientId, rows) {
  const db = getSupabase();
  const list = Array.isArray(rows) ? rows : [];
  const mapped = list.map((r) => mapRoomRow(clientId, r)).filter(Boolean);
  if (mapped.length) {
    const { error } = await db.from("hotel_rooms").upsert(mapped, {
      onConflict: "client_id,local_room_id",
    });
    if (error) throw new Error(error.message);
    await pruneMissing(
      db,
      "hotel_rooms",
      clientId,
      "local_room_id",
      mapped.map((m) => m.local_room_id),
    );
  }
  return { ok: true, upserted: mapped.length };
}

async function syncHotelGuests(clientId, rows) {
  const db = getSupabase();
  const list = Array.isArray(rows) ? rows : [];
  const mapped = list.map((g) => mapGuestRow(clientId, g)).filter(Boolean);
  if (mapped.length) {
    const { error } = await db.from("hotel_guests").upsert(mapped, {
      onConflict: "client_id,local_guest_id",
    });
    if (error) throw new Error(error.message);
    await pruneMissing(
      db,
      "hotel_guests",
      clientId,
      "local_guest_id",
      mapped.map((m) => m.local_guest_id),
    );
  }
  return { ok: true, upserted: mapped.length };
}

function mapRoomDto(row, guestByRoomId) {
  const localId = Number(row.local_room_id);
  const guest = guestByRoomId.get(localId) || null;
  return {
    local_room_id: localId,
    room_number: row.room_number,
    room_type: row.room_type,
    floor: row.floor,
    price_per_night: Number(row.price_per_night) || 0,
    status: row.status,
    guest_name: guest?.guest_name || "",
    check_out_date: guest?.check_out_date || "",
    synced_at: row.updated_at,
  };
}

async function listHotelRoomsForOwner(clientId) {
  const db = getSupabase();
  const { data: rooms, error } = await db
    .from("hotel_rooms")
    .select("*")
    .eq("client_id", clientId)
    .order("floor", { ascending: true })
    .order("room_number", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: guests } = await db
    .from("hotel_guests")
    .select("room_id, guest_name, check_out_date, status")
    .eq("client_id", clientId)
    .eq("status", "checked_in");

  const guestByRoomId = new Map();
  for (const g of guests || []) {
    const rid = Number(g.room_id);
    if (Number.isFinite(rid)) guestByRoomId.set(rid, g);
  }

  return (rooms || []).map((r) => mapRoomDto(r, guestByRoomId));
}

async function listHotelGuestsForOwner(clientId, { limit = 150 } = {}) {
  const db = getSupabase();
  const cap = Math.min(300, Math.max(1, Number(limit) || 150));
  const { data, error } = await db
    .from("hotel_guests")
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(cap);
  if (error) throw new Error(error.message);

  const roomIds = [...new Set((data || []).map((g) => Number(g.room_id)).filter(Number.isFinite))];
  let roomNumByLocalId = new Map();
  if (roomIds.length) {
    const { data: rooms } = await db
      .from("hotel_rooms")
      .select("local_room_id, room_number")
      .eq("client_id", clientId)
      .in("local_room_id", roomIds);
    roomNumByLocalId = new Map(
      (rooms || []).map((r) => [Number(r.local_room_id), r.room_number]),
    );
  }

  return (data || []).map((g) => ({
    local_guest_id: Number(g.local_guest_id),
    guest_name: g.guest_name,
    phone: g.phone,
    room_number: roomNumByLocalId.get(Number(g.room_id)) || "",
    check_in_date: g.check_in_date,
    check_out_date: g.check_out_date,
    persons: Number(g.persons) || 1,
    status: g.status,
    total_paid: Number(g.total_paid) || 0,
    synced_at: g.updated_at,
  }));
}

module.exports = {
  syncHotelRooms,
  syncHotelGuests,
  listHotelRoomsForOwner,
  listHotelGuestsForOwner,
};
