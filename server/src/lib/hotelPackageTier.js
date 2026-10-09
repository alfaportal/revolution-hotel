/**
 * Revolution HOTEL — 3 pako (pako_1 Bazik, pako_2 Standard, pako_3 Premium + AI).
 * ID-të legacy restoranti (pako_5, pako_premium, …) mapohen në pako_3 hotel.
 */

const HOTEL_PACKAGE_TIERS = Object.freeze(["pako_1", "pako_2", "pako_3"]);

const LEGACY_TO_HOTEL = Object.freeze({
  pako_3: "pako_1",
  pako_4: "pako_2",
  pako_2: "pako_3",
  pako_5: "pako_3",
  pako_premium: "pako_3",
});

function normalizeTierKey(tier) {
  return String(tier || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "_");
}

function normalizeHotelPackageTier(tier) {
  const t = normalizeTierKey(tier);
  if (HOTEL_PACKAGE_TIERS.includes(t)) return t;
  return LEGACY_TO_HOTEL[t] || "pako_1";
}

function isHotelProductClient(client) {
  const line = String(client?.product_line || "hotel").trim().toLowerCase();
  return line === "hotel";
}

function hotelHasAi(tierOrClient) {
  if (tierOrClient && typeof tierOrClient === "object") {
    if (!isHotelProductClient(tierOrClient)) return false;
    return normalizeHotelPackageTier(tierOrClient.package_tier) === "pako_3";
  }
  return normalizeHotelPackageTier(tierOrClient) === "pako_3";
}

/** Për bundle funksionesh (KDS, kiosk, …) — mapo tier hotel → tier legacy cloud. */
function hotelTierToLegacyFeatureTier(hotelTier) {
  const map = {
    pako_1: "pako_3",
    pako_2: "pako_4",
    pako_3: "pako_5",
  };
  return map[normalizeHotelPackageTier(hotelTier)] || "pako_3";
}

module.exports = {
  HOTEL_PACKAGE_TIERS,
  normalizeHotelPackageTier,
  isHotelProductClient,
  hotelHasAi,
  hotelTierToLegacyFeatureTier,
};
