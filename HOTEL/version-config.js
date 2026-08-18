/** Konfigurimi i versionit — Revolution HOTEL (menu default për instalim të ri) */
const { version: pkgVersion } = require("./package.json");
let PACKAGE = { tier: "pako_5", label: "4" };
try {
  PACKAGE = require("./package-tier");
} catch {
  /* dev pa skedar */
}

/** Kategoritë me çmime default nga seed — pjesa tjetër 0.00 (pronari e vendos). */
const SEED_PRICED_CATEGORIES = Object.freeze([
  "Pije të nxehta",
  "Pije joalkoolike",
  "Pije të ftohta",
  "Birra",
]);

/** Helper — ruaj çmimin nga seed për kategoritë e pijeve; ushqimi mbetet 0.00. */
function seed(category, names) {
  const pricedCat = SEED_PRICED_CATEGORIES.includes(category);
  return names.map((entry) => {
    if (typeof entry === "string") {
      return { name: entry, category, price: 0 };
    }
    const fromSeed = Number(entry.price);
    const price =
      pricedCat && Number.isFinite(fromSeed) && fromSeed > 0 ? fromSeed : 0;
    return {
      name: entry.name,
      category,
      price,
      ...(entry.image ? { image: entry.image } : {}),
    };
  });
}

/** URL lokale për kartat e POS (sfond i pastër, stil i njëjtë). */
const U = (file) => `/menu-stock/${file}`;

const i18n = (() => {
  try {
    return require("./i18n");
  } catch {
    return { t: (s) => s, isFrench: () => false };
  }
})();

const _exports = {
  appVersion: pkgVersion,
  versionLabel: "Revolution HOTEL",
  appType: "hotel",
  packageTier: PACKAGE.tier || "pako_5",
  packageLabel: PACKAGE.label || "4",
  defaultTableCount: 10,
  SEED_PRICED_CATEGORIES,
  defaultCategories: [
      "Pije të nxehta",
      "Pije joalkoolike",
      "Pije të ftohta",
      "Birra",
      "Vera",
      "Alkool",
      "Mëngjes",
      "Salata",
      "Supa",
      "Pizza",
      "Hamburger / Fast Food",
      "Sanduiç / Toast",
      "Pasta",
      "Mish",
      "Peshk / Fruta deti",
      "Pjata tradicionale",
      "Shoqërime",
      "Ëmbëlsira",
      "Meny për fëmijë"
  ],
  menuSeed: [
    ...seed("Pije të nxehta", [
      { name: "Espresso 40ml", price: 0.8, image: U("hot-espresso-40ml.jpg") },
      { name: "Espresso 50ml", price: 0.9, image: U("hot-espresso-50ml.jpg") },
      { name: "Espresso 70ml", price: 1, image: U("hot-espresso-70ml.jpg") },
      { name: "Espresso e plotë", price: 1.2, image: U("hot-espresso-e-plote.jpg") },
      { name: "Espresso i dyfishtë", price: 1.5, image: U("hot-espresso-doppio.jpg") },
      { name: "Macchiato", price: 1.2, image: U("hot-macchiato.jpg") },
      { name: "Cappuccino", price: 1.5, image: U("hot-cappuccino.jpg") },
      { name: "Latte", price: 1.8, image: U("hot-latte.jpg") },
      { name: "Americano", price: 1.2, image: U("hot-americano.jpg") },
      { name: "Kafe amerikane", price: 1, image: U("hot-kafe-americane.jpg") },
      { name: "Mocha", price: 2, image: U("hot-mocha.jpg") },
      { name: "Flat white", price: 1.8, image: U("hot-flat-white.jpg") },
      { name: "Cortado", price: 1.3, image: U("hot-cortado.jpg") },
      { name: "Kafe turke", price: 1, image: U("hot-kafe-turke.jpg") },
      { name: "Kafe irlandeze", price: 3.5, image: U("hot-irish-coffee.jpg") },
      { name: "Çokollatë e nxehtë", price: 2, image: U("hot-cokollate-e-nxehte.jpg") },
      { name: "Çaj i zi", price: 1, image: U("hot-caj-i-zi.jpg") },
      { name: "Çaj jeshil", price: 1, image: U("hot-caj-jeshil.jpg") },
      { name: "Çaj frutash", price: 1.2, image: U("hot-caj-frutash.jpg") },
      { name: "Çaj kamomili", price: 1, image: U("hot-caj-kamomili.jpg") },
      { name: "Çaj mente", price: 1, image: U("hot-caj-mente.jpg") },
      { name: "Çaj shafrani", price: 1.5, image: U("hot-caj-shafrani.jpg") },
      { name: "Salep", price: 2, image: U("hot-salep.jpg") },
    ]),
    ...seed("Pije joalkoolike", [
      { name: "Coca-Cola", price: 1.5, image: U("soft-coca-cola.jpg") },
      { name: "Fanta", price: 1.5, image: U("soft-fanta.jpg") },
      { name: "Sprite", price: 1.5, image: U("soft-sprite.jpg") },
      { name: "Pepsi", price: 1.5, image: U("soft-pepsi.jpg") },
      { name: "7UP", price: 1.5, image: U("soft-7up.jpg") },
      { name: "Schweppes", price: 1.5, image: U("soft-schweppes.jpg") },
      { name: "Red Bull", price: 2.5, image: U("soft-red-bull.jpg") },
      { name: "Ujë mineral", price: 0.5, image: U("soft-uje-mineral.jpg") },
      { name: "Ujë natyral", price: 0.5, image: U("soft-uje-natyral.jpg") },
      { name: "Ujë tonik", price: 1.5, image: U("soft-tonic-water.jpg") },
      { name: "Xhinxher ale", price: 1.5, image: U("soft-ginger-ale.jpg") },
      { name: "Sodë", price: 1, image: U("soft-soda.jpg") },
    ]),
    ...seed("Pije të ftohta", [
      { name: "Kafe e ftohtë", price: 2, image: U("cold-iced-coffee.jpg") },
      { name: "Latte e ftohtë", price: 2.5, image: U("cold-iced-latte.jpg") },
      { name: "Frappuccino", price: 3, image: U("cold-frappuccino.jpg") },
      { name: "Kafe e ftohtë e ngadalshme", price: 2.5, image: U("cold-cold-brew.jpg") },
      { name: "Mocha e ftohtë", price: 2.5, image: U("cold-iced-mocha.jpg") },
      { name: "Çaj i ftohtë", price: 1.5, image: U("cold-iced-tea.jpg") },
      { name: "Limonadë", price: 1.5, image: U("cold-lemonade.jpg") },
      { name: "Lëng portokalli", price: 1.5, image: U("cold-leng-portokalli.jpg") },
      { name: "Lëng molle", price: 1.5, image: U("cold-leng-molle.jpg") },
      { name: "Lëng shege", price: 2, image: U("cold-leng-shege.jpg") },
      { name: "Lëng ananasi", price: 1.5, image: U("cold-leng-ananasi.jpg") },
      { name: "Lëng kumbullash", price: 1.5, image: U("cold-leng-kumbullash.jpg") },
      { name: "Smoothie mango", price: 3, image: U("cold-smoothie-mango.jpg") },
      { name: "Smoothie banane", price: 3, image: U("cold-smoothie-banana.jpg") },
      { name: "Smoothie luleshtrydhe", price: 3, image: U("cold-smoothie-strawberry.jpg") },
      { name: "Milkshake çokollatë", price: 3, image: U("cold-milkshake-coko.jpg") },
      { name: "Milkshake vanilje", price: 3, image: U("cold-milkshake-vanilj.jpg") },
      { name: "Milkshake luleshtrydhe", price: 3, image: U("cold-milkshake-strawberry.jpg") },
    ]),
    ...seed("Birra", [
      { name: "Birra Peja", price: 1.5, image: U("beer-peja.jpg") },
      { name: "Birra Prishtina", price: 1.5, image: U("beer-prishtina.jpg") },
      { name: "Heineken", price: 2.0, image: U("beer-heineken.jpg") },
      { name: "Corona", price: 2.5, image: U("beer-corona.jpg") },
      { name: "Tuborg", price: 2.0, image: U("beer-tuborg.jpg") },
      { name: "Lasko", price: 1.8, image: U("beer-lasko.jpg") },
      { name: "Birra draft e vogël", price: 2.0, image: U("beer-draft-vogel.jpg") },
      { name: "Birra draft e madhe", price: 3.5, image: U("beer-draft-madhe.jpg") },
    ]),
    ...seed("Vera", [
      { name: "Verë e kuqe (gotë)", image: U("wine-red-glass.jpg") },
      { name: "Verë e bardhë (gotë)", image: U("wine-white-glass.jpg") },
      { name: "Verë rozë (gotë)", image: U("wine-rose-glass.jpg") },
      { name: "Verë e kuqe (shishe)", image: U("wine-red-bottle.jpg") },
      { name: "Verë e bardhë (shishe)", image: U("wine-white-bottle.jpg") },
      { name: "Verë rozë (shishe)", image: U("wine-rose-bottle.jpg") },
      { name: "Sangria", image: U("wine-sangria.jpg") },
    ]),
    ...seed("Alkool", [
      { name: "Raki", image: U("alc-raki.jpg") },
      { name: "Uiski", image: U("alc-whisky.jpg") },
      { name: "Vodka", image: U("alc-vodka.jpg") },
      { name: "Xhin", image: U("alc-gin.jpg") },
      { name: "Rum", image: U("alc-rum.jpg") },
      { name: "Tekilë", image: U("alc-tequila.jpg") },
      { name: "Aperol Spritz", image: U("alc-aperol-spritz.jpg") },
      { name: "Mojito", image: U("alc-mojito.jpg") },
      { name: "Margarita", image: U("alc-margarita.jpg") },
      { name: "Xhin tonik", image: U("alc-gin-tonic.jpg") },
      { name: "Cuba Libre", image: U("alc-cuba-libre.jpg") },
    ]),
    ...seed("Mëngjes", [
      { name: "Omeletë klasike", image: U("br-omelette.jpg") },
      { name: "Omeletë me djathë", image: U("br-omelette-cheese.jpg") },
      { name: "Omeletë me perime", image: U("br-omelette-veg.jpg") },
      { name: "Vezë të skuqura", image: U("br-veze-skuqura.jpg") },
      { name: "Vezë të ziera", image: U("br-veze-ziera.jpg") },
      { name: "Pankejk", image: U("br-pancakes.jpg") },
      { name: "Bukë franceze", image: U("br-french-toast.jpg") },
      { name: "Krosan", image: U("br-croissant.jpg") },
      { name: "Krosan me çokollatë", image: U("br-croissant-coko.jpg") },
      { name: "Krosan me djathë", image: U("br-croissant-djathe.jpg") },
      { name: "Bukë me gjalpë e mjaltë", image: U("br-buke-gjalpe.jpg") },
      { name: "Bukë me avokado", image: U("br-buke-avokado.jpg") },
      { name: "Granola me jogurt", image: U("br-granola.jpg") },
      { name: "Tas me fruta", image: U("br-fruit-bowl.jpg") },
      { name: "Mëngjes anglez", image: U("br-mengjes-anglisht.jpg") },
      { name: "Mëngjes turk", image: U("br-mengjes-turk.jpg") },
    ]),
    ...seed("Salata", [
      { name: "Sallatë Cezar", image: U("sal-caesar.jpg") },
      { name: "Sallatë greke", image: U("sal-greek.jpg") },
      { name: "Sallatë Kapreze", image: U("sal-caprese.jpg") },
      { name: "Sallatë tune", image: U("sal-tonno.jpg") },
      { name: "Sallatë pule", image: U("sal-pule.jpg") },
      { name: "Sallatë Nisuaz", image: U("sal-nicoise.jpg") },
      { name: "Sallatë kale", image: U("sal-kale.jpg") },
      { name: "Sallatë kuinoa", image: U("sal-quinoa.jpg") },
      { name: "Sallatë avokado", image: U("sal-avokado.jpg") },
      { name: "Sallatë e shtëpisë", image: U("sal-shtepie.jpg") },
      { name: "Sallatë me djathë dhie", image: U("sal-dhie.jpg") },
      { name: "Sallatë lakre", image: U("sal-coleslaw.jpg") },
    ]),
    ...seed("Supa", [
      { name: "Supë pule", image: U("soup-pule.jpg") },
      { name: "Supë perimesh", image: U("soup-perime.jpg") },
      { name: "Supë domate", image: U("soup-domate.jpg") },
      { name: "Supë kërpudhash", image: U("soup-kerpudha.jpg") },
      { name: "Supë lëng mishi", image: U("soup-leng-mishi.jpg") },
      { name: "Supë kremoze brokoli", image: U("soup-brokoli.jpg") },
      { name: "Supë lakre (gullash)", image: U("soup-goulash.jpg") },
      { name: "Supë peshku", image: U("soup-peshk.jpg") },
    ]),
    ...seed("Pizza", [
      { name: "Pizza Margarita", image: U("piz-margherita.jpg") },
      { name: "Pizza peperoni", image: U("piz-pepperoni.jpg") },
      { name: "Pizza katër djathëra", image: U("piz-4cheese.jpg") },
      { name: "Pizza Kapriçoza", image: U("piz-capricciosa.jpg") },
      { name: "Pizza proshutë", image: U("piz-prosciutto.jpg") },
      { name: "Pizza tune", image: U("piz-tonno.jpg") },
      { name: "Pizza vegjetariane", image: U("piz-veggie.jpg") },
      { name: "Pizza pule BBQ", image: U("piz-bbq-chicken.jpg") },
      { name: "Pizza Diavola", image: U("piz-diavola.jpg") },
      { name: "Pizza Kalcone", image: U("piz-calzone.jpg") },
      { name: "Pizza e bardhë", image: U("piz-bianca.jpg") },
      { name: "Pizza me suxhuk", image: U("piz-suxhuk.jpg") },
      { name: "Pizza speciale e shtëpisë", image: U("piz-speciale.jpg") },
    ]),
    ...seed("Hamburger / Fast Food", [
      { name: "Hamburger klasik", image: U("ff-burger-classic.jpg") },
      { name: "Hamburger me djathë", image: U("ff-cheeseburger.jpg") },
      { name: "Hamburger i dyfishtë", image: U("ff-double.jpg") },
      { name: "Hamburger pule", image: U("ff-chicken-burger.jpg") },
      { name: "Hamburger vegjetarian", image: U("ff-veggie-burger.jpg") },
      { name: "Hamburger BBQ", image: U("ff-bbq-burger.jpg") },
      { name: "Pule krogante", image: U("ff-crispy-chicken.jpg") },
      { name: "Nagets", image: U("ff-nuggets.jpg") },
      { name: "Hot dog", image: U("ff-hotdog.jpg") },
      { name: "Wrap pule", image: U("ff-wrap-pule.jpg") },
      { name: "Wrap vegjetarian", image: U("ff-wrap-veg.jpg") },
      { name: "Döner kebab", image: U("ff-doner.jpg") },
      { name: "Shaurma", image: U("ff-shawarma.jpg") },
    ]),
    ...seed("Sanduiç / Toast", [
      { name: "Toast klasik", image: U("sw-toast.jpg") },
      { name: "Toast me proshutë", image: U("sw-toast-prosciutto.jpg") },
      { name: "Sanduiç klub", image: U("sw-club.jpg") },
      { name: "Sanduiç tune", image: U("sw-tuna.jpg") },
      { name: "Sanduiç pule", image: U("sw-pule.jpg") },
      { name: "Panini", image: U("sw-panini.jpg") },
      { name: "Bejëll", image: U("sw-bagel.jpg") },
      { name: "Brusketa", image: U("sw-bruschetta.jpg") },
    ]),
    ...seed("Pasta", [
      { name: "Spageti Bolonjeze", image: U("pa-bolognese.jpg") },
      { name: "Spageti Karbonara", image: U("pa-carbonara.jpg") },
      { name: "Pene Arabiata", image: U("pa-arrabiata.jpg") },
      { name: "Fetuçine Alfredo", image: U("pa-alfredo.jpg") },
      { name: "Lazanja", image: U("pa-lasagna.jpg") },
      { name: "Ravioli", image: U("pa-ravioli.jpg") },
      { name: "Njoki", image: U("pa-gnocchi.jpg") },
      { name: "Pasta me pesto", image: U("pa-pesto.jpg") },
      { name: "Pasta me fruta deti", image: U("pa-seafood.jpg") },
      { name: "Makarona me djathë", image: U("pa-maccheese.jpg") },
    ]),
    ...seed("Mish", [
      { name: "Stek viçi", image: U("me-steak.jpg") },
      { name: "Biftek", image: U("me-biftek.jpg") },
      { name: "Fileto pule", image: U("me-fileto-pule.jpg") },
      { name: "Pule në skarë", image: U("me-pule-skare.jpg") },
      { name: "Shnicël", image: U("me-cotoletta.jpg") },
      { name: "Mish qengji", image: U("me-qengji.jpg") },
      { name: "Mish derri në skarë", image: U("me-derri.jpg") },
      { name: "Ribaj", image: U("me-ribeye.jpg") },
      { name: "T-bone", image: U("me-tbone.jpg") },
      { name: "Tavë kosi", image: U("tr-tave-kosi.jpg") },
      { name: "Tavë mishi", image: U("me-tave-mishi.jpg") },
      { name: "Qofte në skarë", image: U("me-qofte-skare.jpg") },
      { name: "Qofte të fërguara", image: U("me-qofte-ferguara.jpg") },
      { name: "Qebapa", image: U("me-cevapi.jpg") },
      { name: "Pljeskavicë", image: U("me-pljeskavica.jpg") },
    ]),
    ...seed("Peshk / Fruta deti", [
      { name: "Salmon në skarë", image: U("fi-salmon.jpg") },
      { name: "Fileto peshku", image: U("fi-fileto.jpg") },
      { name: "Peshk i fërguar", image: U("fi-ferguar.jpg") },
      { name: "Karkaleca", image: U("fi-karkaleca.jpg") },
      { name: "Kalamari", image: U("fi-kalamari.jpg") },
      { name: "Oktapod në skarë", image: U("fi-oktapod.jpg") },
      { name: "Peshk me patate", image: U("fi-chips.jpg") },
      { name: "Tavë peshku", image: U("fi-tave-peshku.jpg") },
    ]),
    ...seed("Pjata tradicionale", [
      { name: "Flija", image: U("tr-flija.jpg") },
      { name: "Byrek me mish", image: U("tr-byrek-mish.jpg") },
      { name: "Byrek me djathë", image: U("tr-byrek-djathe.jpg") },
      { name: "Byrek me spinaq", image: U("tr-byrek-spinaq.jpg") },
      { name: "Mantia", image: U("tr-mantia.jpg") },
      { name: "Sarma", image: U("tr-sarma.jpg") },
      { name: "Japrak", image: U("tr-japrak.jpg") },
      { name: "Petulla", image: U("tr-petulla.jpg") },
      { name: "Llokuma", image: U("tr-llokuma.jpg") },
      { name: "Pite me lakër", image: U("tr-pite-laker.jpg") },
      { name: "Fasule në tavë", image: U("tr-fasule.jpg") },
      { name: "Bamje", image: U("tr-bamje.jpg") },
    ]),
    ...seed("Shoqërime", [
      { name: "Patate të skuqura", image: U("sh-fries.jpg") },
      { name: "Patate wedges", image: U("sh-wedges.jpg") },
      { name: "Oriz", image: U("sh-oriz.jpg") },
      { name: "Oriz me perime", image: U("sh-oriz-perime.jpg") },
      { name: "Bukë shtëpie", image: U("sh-buke.jpg") },
      { name: "Bukë hudhre", image: U("sh-buke-hudhre.jpg") },
      { name: "Perime në skarë", image: U("sh-perime-skare.jpg") },
      { name: "Pure patatesh", image: U("sh-pure.jpg") },
      { name: "Unaza qepësh", image: U("sh-onion-rings.jpg") },
      { name: "Shkopinj mozzarella", image: U("sh-mozzarella.jpg") },
      { name: "Salcë BBQ", image: U("sh-bbq.jpg") },
      { name: "Salcë tartar", image: U("sh-tartare.jpg") },
      { name: "Ajvar", image: U("sh-ajvar.jpg") },
      { name: "Kajmak", image: U("sh-kajmak.jpg") },
    ]),
    ...seed("Ëmbëlsira", [
      { name: "Tiramisu", image: U("de-tiramisu.jpg") },
      { name: "Tortë djathi", image: U("de-cheesecake.jpg") },
      { name: "Panna Cotta", image: U("de-panna-cotta.jpg") },
      { name: "Krem brûle", image: U("de-creme-brulee.jpg") },
      { name: "Brauni", image: U("de-brownie.jpg") },
      { name: "Biskota", image: U("de-cookies.jpg") },
      { name: "Tortë çokollatë", image: U("de-torte-coko.jpg") },
      { name: "Tortë frutash", image: U("de-torte-fruta.jpg") },
      { name: "Bakllavë", image: U("de-bakllave.jpg") },
      { name: "Kadaif", image: U("de-kadaif.jpg") },
      { name: "Trileçe", image: U("de-trilece.jpg") },
      { name: "Sutliaç", image: U("de-sutliac.jpg") },
      { name: "Profiterola", image: U("de-profiterola.jpg") },
      { name: "Vaflë", image: U("de-waffle.jpg") },
      { name: "Krep me Nutella", image: U("de-crepe-nutella.jpg") },
      { name: "Krep me fruta", image: U("de-crepe-fruta.jpg") },
      { name: "Akullore vanilje", image: U("de-ice-vanilj.jpg") },
      { name: "Akullore çokollatë", image: U("de-ice-coko.jpg") },
      { name: "Akullore frutash", image: U("de-ice-fruta.jpg") },
      { name: "Sallatë frutash", image: U("de-fruit-salad.jpg") },
    ]),
    ...seed("Meny për fëmijë", [
      { name: "Nagets me patate", image: U("kd-nuggets.jpg") },
      { name: "Mini hamburger", image: U("kd-mini-burger.jpg") },
      { name: "Mini pizza", image: U("kd-mini-pizza.jpg") },
      { name: "Pasta me salcë domate", image: U("kd-pasta.jpg") },
      { name: "Pankejk me Nutella", image: U("kd-pancakes.jpg") },
      { name: "Akullore", image: U("kd-akullore.jpg") },
      { name: "Lëng frutash", image: U("kd-leng.jpg") },
    ]),
  ],
};

_exports.menuSeedRaw = _exports.menuSeed.map((it) => ({ ...it }));

/* Emrat e kategorive në DB mbeten gjithmonë shqip (çelësa kanonikë).
 * Mos i përkthe në frëngjisht gjatë seed — shkakton dyfishime Boissons/Pije. */
if (typeof i18n.isFrench === "function" && i18n.isFrench()) {
  _exports.versionLabel = "Hôtel";
  _exports.menuSeed = _exports.menuSeed.map((it) => ({
    ...it,
    name: i18n.t(it.name),
    /* category: mbetet shqip */
  }));
}

module.exports = _exports;
