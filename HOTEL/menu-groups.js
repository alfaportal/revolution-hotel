/** Pije vs ushqim — i njëjti koncept si server menuGroups.js */

function normCat(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Pije → printeri i barit.
 * Ushqim → printeri i kuzhinës.
 */
function isDrinkCategory(category) {
  const n = normCat(category);
  if (!n) return false;

  // Ushqim i qartë — mos e trajto si pije edhe nëse emri ka fjalë të përbashkëta
  if (
    /\b(pizza|pasta|mish|supa|supë|salat|sandwi|hamburger|fast\s*food|mengjes|mëngjes|embelsira|embel|desert|peshk|fruta\s*deti|tradicionale|shoqerime|femij|fëmij|nugget|qofte|wrap)\b/.test(
      n,
    ) ||
    n.includes("hamburger") ||
    n.includes("sandwi") ||
    n.includes("tradicionale")
  ) {
    return false;
  }

  return (
    n.startsWith("pije") ||
    n.includes("pije") ||
    n.includes("alkool") ||
    n.includes("birra") ||
    n.includes("birre") ||
    n === "vera" ||
    n.includes("vere") ||
    n.includes("verë") ||
    n.includes("wine") ||
    n.includes("kafe") ||
    n.includes("coffee") ||
    n.includes("cocktail") ||
    n.includes("coctail") ||
    n.includes("koktej") ||
    n.includes("beer") ||
    n.includes("soft drink") ||
    n.includes("energji") ||
    n.includes("energy")
  );
}

function isFoodCategory(category) {
  const n = normCat(category);
  if (!n) return false;
  return !isDrinkCategory(n);
}

module.exports = {
  normCat,
  isDrinkCategory,
  isFoodCategory,
};
