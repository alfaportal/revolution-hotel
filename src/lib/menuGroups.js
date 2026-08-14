/** Pije vs ushqim — i njëjti koncept si KAFENE/menu-groups.js */

function normCat(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Vetëm a-z0-9 — match agresiv. */
function foldAscii(name) {
  return normCat(name).replace(/[^a-z0-9]+/g, " ").trim();
}

const FOOD_RE =
  /\b(pizza|pica|pasta|mish|supa|supe|salat\w*|sallat\w*|sandwi\w*|hamburger|burger|fast\s*food|mengjes|embelsira|embel|desert|dessert|peshk|fruta\s*deti|tradicionale|shoqerime|femij|nugget|qofte|wrap|rizotto|risotto|steak|fileto|skara|grill|zgar|qebap|kebab|byrek|burek|lakror|omlet\w*|veze|patate|fries|sushi|taco|burrito|lasagn\w*|makaron|spaghetti|corba|pule|chicken|suxhuk|pjate|pjata|toast|schnitzel|cordon|kapreze|caprese|tune|ton|prosciutto)\b/;

const DRINK_CAT_RE =
  /\b(pije|pijet|alkool|birra|birre|vera|vere|wine|kafe|coffee|espresso|cappuccino|latte|cocktail|koktej|beer|drink|beverage|energji|energy|caj|tea|uje|water|sok|juice|bar|ftoht|ngroht|qumesht|milk|smoothie|shake|softdrink)\b/;

/**
 * Pije → banak / bar.
 */
function isDrinkCategory(category) {
  const n = normCat(category);
  if (!n) return false;
  const f = foldAscii(category);

  // Kategori ushqimi e qartë
  if (FOOD_RE.test(f) && !DRINK_CAT_RE.test(f) && !f.includes("kafe") && !f.includes("pije")) {
    return false;
  }

  return (
    DRINK_CAT_RE.test(f) ||
    n.startsWith("pije") ||
    n.includes("pije") ||
    n.includes("alkool") ||
    n.includes("birra") ||
    n.includes("kafe") ||
    n.includes("coffee") ||
    n.includes("espresso") ||
    n.includes("drink") ||
    n.includes("beverage") ||
    n === "bar" ||
    n.includes("te ftoht") ||
    n.includes("te ngroht") ||
    n.includes("ftohta") ||
    n.includes("ngrohta") ||
    f.includes("espress") ||
    f.includes("kafe")
  );
}

/**
 * Kategori USHQIM e qartë (jo «Speciale» / «Menu» / «Të tjera»).
 * Kuzhina përdor VETËM këtë — jo !isDrinkCategory.
 */
function isExplicitFoodCategory(category) {
  const f = foldAscii(category);
  if (!f) return false;
  if (isDrinkCategory(category)) return false;
  return (
    FOOD_RE.test(f) ||
    f.includes("ushqim") ||
    f.includes("food") ||
    f.includes("kuzhin") ||
    f.includes("kitchen") ||
    f.startsWith("gatim") ||
    f.includes("paragjell") ||
    f.includes("kryesore") ||
    f.includes("sallat") ||
    f.includes("embels")
  );
}

/** Për UI (tab Pije/Ushqim): çdo kategori jo-pije. */
function isFoodCategory(category) {
  const n = normCat(category);
  if (!n) return false;
  return !isDrinkCategory(n);
}

function isFoodItemName(name) {
  const f = foldAscii(name);
  if (!f) return false;
  if (isDrinkItemName(name)) return false;
  if (FOOD_RE.test(f)) return true;
  // Sallatë / Salad / Kapreze — edhe pa word-boundary strikte
  if (
    f.includes("sallat") ||
    f.includes("salat") ||
    f.includes("salad") ||
    f.includes("kapreze") ||
    f.includes("caprese") ||
    f.includes("pizza") ||
    f.includes("pica") ||
    f.includes("hamburger") ||
    f.includes("burger") ||
    f.includes("pasta") ||
    f.includes("byrek") ||
    f.includes("burek")
  ) {
    return true;
  }
  return false;
}

/**
 * Emri i pijes — PRIORITET. Çdo pije e zakonshme.
 */
function isDrinkItemName(name) {
  const f = foldAscii(name);
  if (!f) return false;

  // Ushqim i qartë pa sinjal pije
  if (FOOD_RE.test(f)) {
    const hasDrinkSignal =
      f.includes("espress") ||
      f.includes("cappuccin") ||
      f.includes("kafe") ||
      f.includes("coffee") ||
      f.includes("birra") ||
      f.includes("pije") ||
      f.includes("cola") ||
      f.includes("uje");
    if (!hasDrinkSignal) return false;
  }

  // Lista e gjerë e pijeve (includes — pa u mbështetur vetëm te \b)
  if (
    f.includes("espress") ||
    f.includes("cappuccin") ||
    f.includes("macchiato") ||
    f.includes("americano") ||
    f.includes("latte") ||
    f.includes("mocha") ||
    f.includes("moka") ||
    f.includes("frappe") ||
    f.includes("frape") ||
    f.includes("nescafe") ||
    f.includes("neskafe") ||
    f.includes("coffee") ||
    f.includes("kafe") ||
    f.includes("cafe ") ||
    f.startsWith("cafe") ||
    f.includes("birra") ||
    f.includes("beer") ||
    f.includes("cocktail") ||
    f.includes("coctail") ||
    f.includes("koktej") ||
    f.includes("coca") ||
    f.includes("cola") ||
    f.includes("fanta") ||
    f.includes("sprite") ||
    f.includes("pepsi") ||
    f.includes("schweppes") ||
    f.includes("mirinda") ||
    f.includes("smoothie") ||
    f.includes("milkshake") ||
    f.includes("milk shake") ||
    f.includes("energji") ||
    f.includes("energy") ||
    f.includes("redbull") ||
    f.includes("red bull") ||
    f.includes("monster") ||
    f.includes("mojito") ||
    f.includes("spritz") ||
    f.includes("aperol") ||
    f.includes("ayran") ||
    f.includes("airan") ||
    f.includes("boza") ||
    f.includes("limonad") ||
    f.includes("lemonade") ||
    f.includes("qumesht") ||
    f.includes("milk") ||
    f.includes("icetea") ||
    f.includes("ice tea") ||
    f.includes("iced tea") ||
    f.includes("tonic") ||
    f.includes("soda") ||
    f.includes("gazuar") ||
    f.includes("mineral") ||
    f.includes("whisky") ||
    f.includes("whiskey") ||
    f.includes("viski") ||
    f.includes("vodka") ||
    f.includes("tekila") ||
    f.includes("tequila") ||
    f.includes("rum ") ||
    f.startsWith("rum") ||
    f.includes("gin ") ||
    f.startsWith("gin") ||
    f.includes("raki") ||
    f.includes("konjak") ||
    f.includes("cognac") ||
    f.includes("pelinkovac") ||
    f.includes("vinjak") ||
    f.includes("champagne") ||
    f.includes("prosecco") ||
    f.includes("sangria") ||
    f.includes("sherry") ||
    f.includes("port wine") ||
    /\b(tea|caj|uje|water|sok|juice|wine|vere|vera|pije|drink|beer|wine)\b/.test(f)
  ) {
    return true;
  }

  return false;
}

/**
 * A shkon te KUZHINA?
 * Vetëm ushqim i qartë (kategori ose emër). Pijet dhe «unknown» → JO.
 */
function isKitchenRouteItem(name, category) {
  const n = String(name || "");
  const c = String(category || "");
  if (isDrinkItemName(n)) return false;
  if (c && isDrinkCategory(c)) return false;
  if (c && isExplicitFoodCategory(c)) return true;
  if (isFoodItemName(n)) return true;
  return false;
}

module.exports = {
  normCat,
  foldAscii,
  isDrinkCategory,
  isFoodCategory,
  isExplicitFoodCategory,
  isFoodItemName,
  isDrinkItemName,
  isKitchenRouteItem,
};
