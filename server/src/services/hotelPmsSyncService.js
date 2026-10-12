"use strict";
/** SYNC RESET (Step 2) — stub deri Step 3. */

async function syncHotelRooms() {
  return { ok: true, skipped: true, upserted: 0 };
}

async function syncHotelGuests() {
  return { ok: true, skipped: true, upserted: 0 };
}

async function listHotelRoomsForOwner() {
  return [];
}

async function listHotelGuestsForOwner() {
  return [];
}

module.exports = {
  syncHotelRooms,
  syncHotelGuests,
  listHotelRoomsForOwner,
  listHotelGuestsForOwner,
};
