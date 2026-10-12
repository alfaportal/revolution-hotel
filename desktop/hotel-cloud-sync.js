"use strict";
/** SYNC RESET (Step 2) — stub deri Step 3 (KAFENE + hotel PMS). */

const skip = async () => ({ ok: true, skipped: true });

module.exports = {
  LAST_SYNC_KEY: "hotel_pms_last_sync_at",
  listPublicBookingRequestsPending: async () => ({ requests: [] }),
  respondPublicBookingRequest: skip,
  acceptPublicBookingRequest: skip,
  applyPublicBookingsPendingFromCloud: skip,
  deletePublicBookingRequest: skip,
  pushRoomsToCloud: skip,
  pushGuestsToCloud: skip,
  pushGuestStaySnapshotToCloud: skip,
  pushChargesToCloud: skip,
  pushHousekeepingToCloud: skip,
  pushReservationsToCloud: skip,
  pushServiceCategoriesToCloud: skip,
  pushServicesToCloud: skip,
  pushHotelQrVenuesToCloud: skip,
  pullHotelDataFromCloud: skip,
  fullHotelSync: skip,
};
