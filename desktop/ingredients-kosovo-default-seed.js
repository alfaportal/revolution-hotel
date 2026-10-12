"use strict";

/** Njëherë — përbërës të zakonshëm restorant/hotel (Kosovë). Idempotent: kalon emrat ekzistues. */
const SEED_SETTING_KEY = "ingredients_kosovo_default_seed";
const SEED_VERSION = "2";

const KOSOVO_DEFAULT_RESTAURANT_INGREDIENTS = [
  { name: "Mish viçi", unit: "kg" },
  { name: "Mish pule", unit: "kg" },
  { name: "Mish qengji", unit: "kg" },
  { name: "Mish i grirë", unit: "kg" },
  { name: "Domate", unit: "kg" },
  { name: "Kastravec", unit: "kg" },
  { name: "Tranguj", unit: "kg" },
  { name: "Qepë", unit: "kg" },
  { name: "Hudhra", unit: "kg" },
  { name: "Piper", unit: "kg" },
  { name: "Sallata jeshile", unit: "kg" },
  { name: "Karrota", unit: "kg" },
  { name: "Patate", unit: "kg" },
  { name: "Spinaq", unit: "kg" },
  { name: "Brokoli", unit: "kg" },
  { name: "Kungull", unit: "kg" },
  { name: "Djathë i bardhë", unit: "kg" },
  { name: "Djathë Feta", unit: "kg" },
  { name: "Djathë Kaçkavall", unit: "kg" },
  { name: "Mozzarella", unit: "kg" },
  { name: "Krem djathi", unit: "kg" },
  { name: "Gjalpë", unit: "kg" },
  { name: "Qumësht", unit: "l" },
  { name: "Kos", unit: "l" },
  { name: "Ajkë", unit: "l" },
  { name: "Vaj ulliri", unit: "l" },
  { name: "Vaj luledielli", unit: "l" },
  { name: "Uthull", unit: "l" },
  { name: "Salcë domatesh", unit: "l" },
  { name: "Salcë soje", unit: "l" },
  { name: "Majonezë", unit: "kg" },
  { name: "Mustardë", unit: "kg" },
  { name: "Ketchup", unit: "kg" },
  { name: "Mjaltë", unit: "kg" },
  { name: "Sheqer", unit: "kg" },
  { name: "Kripë", unit: "kg" },
  { name: "Piper i zi", unit: "kg" },
  { name: "Oregano", unit: "kg" },
  { name: "Borzilok", unit: "kg" },
  { name: "Miell", unit: "kg" },
  { name: "Oriz", unit: "kg" },
  { name: "Pasta", unit: "kg" },
  { name: "Bukë", unit: "copë" },
  { name: "Vezë", unit: "copë" },
  { name: "Limon", unit: "copë" },
  { name: "Portokall", unit: "copë" },
  { name: "Ulliri", unit: "kg" },
  { name: "Ton konservë", unit: "kg" },
  { name: "Kërpudha", unit: "kg" },
  { name: "Speca", unit: "kg" },
  { name: "Ananas", unit: "kg" },
];

/**
 * @param {{ findIngredientByName: (n: string) => unknown, createIngredient: (o: object) => unknown }} irApi
 * @param {(key: string, fallback?: string) => string|null} getSetting
 * @param {(key: string, value: string) => void} setSetting
 */
function ensureKosovoDefaultRestaurantIngredients(irApi, getSetting, setSetting) {
  if (!irApi || typeof irApi.createIngredient !== "function") {
    return { ok: false, reason: "no-api" };
  }
  let added = 0;
  let existed = 0;
  for (const row of KOSOVO_DEFAULT_RESTAURANT_INGREDIENTS) {
    const nm = String(row.name || "").trim();
    if (!nm) continue;
    if (typeof irApi.findIngredientByName === "function" && irApi.findIngredientByName(nm)) {
      existed += 1;
      continue;
    }
    try {
      irApi.createIngredient({
        name: nm,
        unit: row.unit || "kg",
        min_stock_qty: 0,
      });
      added += 1;
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("ekziston")) {
        existed += 1;
        continue;
      }
      throw e;
    }
  }
  setSetting(SEED_SETTING_KEY, SEED_VERSION);
  return { ok: true, skippedRun: false, added, existed };
}

module.exports = {
  SEED_SETTING_KEY,
  SEED_VERSION,
  KOSOVO_DEFAULT_RESTAURANT_INGREDIENTS,
  ensureKosovoDefaultRestaurantIngredients,
};
