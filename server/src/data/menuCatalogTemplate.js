/**
 * Katalogu i gatshëm i artikujve për restorante/kafene — me foto (Wikimedia Commons).
 * Pronari zgjedh artikujt dhe i shton në menu me një klik.
 */

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function it(name, category, defaultPrice, photoUrl) {
  return {
    slug: slugify(name),
    name,
    category,
    defaultPrice,
    photoUrl,
  };
}

/** Foto të përbashkëta sipas llojit të produktit */
const P = {
  coffee: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/A_small_cup_of_coffee.JPG/440px-A_small_cup_of_coffee.JPG",
  latte: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Latte_art_3.jpg/440px-Latte_art_3.jpg",
  cappuccino: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Cappuccino_at_Sightglass_Coffee.jpg/440px-Cappuccino_at_Sightglass_Coffee.jpg",
  tea: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Green_tea_3.jpg/440px-Green_tea_3.jpg",
  hotChoc: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Hot_chocolate_with_whipped_cream.jpg/440px-Hot_chocolate_with_whipped_cream.jpg",
  water: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Plastic_water_bottle.jpg/440px-Plastic_water_bottle.jpg",
  water15: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Bottle_of_water.jpg/440px-Bottle_of_water.jpg",
  cola: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Coca-Cola_Classic_can_%28Philippines%29.png/440px-Coca-Cola_Classic_can_%28Philippines%29.png",
  fanta: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Fanta_Orange_%28cropped%29.jpg/440px-Fanta_Orange_%28cropped%29.jpg",
  sprite: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Sprite_logo.svg/440px-Sprite_logo.svg.png",
  redbull: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Red_Bull_can.jpg/440px-Red_Bull_can.jpg",
  icetea: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Iced_tea_with_lemon.jpg/440px-Iced_tea_with_lemon.jpg",
  juice: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Orange_juice_1.jpg/440px-Orange_juice_1.jpg",
  smoothie: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Smoothie_with_berries.jpg/440px-Smoothie_with_berries.jpg",
  frappe: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Frapp%C3%A9_coffee.jpg/440px-Frapp%C3%A9_coffee.jpg",
  beer: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/GravityGlassBeer.jpg/440px-GravityGlassBeer.jpg",
  beerBottle: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Beer_bottle_in_hand.jpg/440px-Beer_bottle_in_hand.jpg",
  raki: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Raki_in_glass.jpg/440px-Raki_in_glass.jpg",
  whisky: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Whisky_glass.jpg/440px-Whisky_glass.jpg",
  vodka: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Vodka_martinis.jpg/440px-Vodka_martinis.jpg",
  wineRed: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Red_Wine_Glas.jpg/440px-Red_Wine_Glas.jpg",
  wineWhite: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/White_wine_in_glass.jpg/440px-White_wine_in_glass.jpg",
  prosecco: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Prosecco_wine.jpg/440px-Prosecco_wine.jpg",
  cognac: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Whisky_glass.jpg/440px-Whisky_glass.jpg",
  baklava: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Baklava_-_Turkish_special%2C_80_Pieces%2C_1kg%2C_1.5kg%2C_2kg%2C_2.5kg%2C_3kg%2C_4kg%2C_5kg%2C_6kg%2C_7kg%2C_8kg%2C_9kg%2C_10kg.jpg/440px-Baklava_-_Turkish_special%2C_80_Pieces%2C_1kg%2C_1.5kg%2C_2kg%2C_2.5kg%2C_3kg%2C_4kg%2C_5kg%2C_6kg%2C_7kg%2C_8kg%2C_9kg%2C_10kg.jpg",
  tiramisu: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Tiramisu%2C_from_L%27Artusi%2C_1891%2C_page_447.jpg/440px-Tiramisu%2C_from_L%27Artusi%2C_1891%2C_page_447.jpg",
  croissant: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Croissant-Petr_Kratochvil.jpg/440px-Croissant-Petr_Kratochvil.jpg",
  icecream: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Ice_cream_with_whipped_cream%2C_chocolate_syrup%2C_and_a_wafer_%28cropped%29.jpg/440px-Ice_cream_with_whipped_cream%2C_chocolate_syrup%2C_and_a_wafer_%28cropped%29.jpg",
  sandwich: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Sandwich_%281%29.jpg/440px-Sandwich_%281%29.jpg",
  toast: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Toast_with_butter.jpg/440px-Toast_with_butter.jpg",
  burek: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Burek_with_cheese.jpg/440px-Burek_with_cheese.jpg",
  pie: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Burek%2C_serbian_pie.jpg/440px-Burek%2C_serbian_pie.jpg",
  soup: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Chicken_soup.jpg/440px-Chicken_soup.jpg",
  salad: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Greek_salad_%28horiatiki%29.jpg/440px-Greek_salad_%28horiatiki%29.jpg",
  pizza: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Margherita_115039.jpg/440px-Margherita_115039.jpg",
  pasta: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Spaghetti_all%27arrabbiata.jpg/440px-Spaghetti_all%27arrabbiata.jpg",
  kebab: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/K%C3%B6fte.jpg/440px-K%C3%B6fte.jpg",
  steak: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Steak_grilling.jpg/440px-Steak_grilling.jpg",
  chicken: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Chicken_and_fries.jpg/440px-Chicken_and_fries.jpg",
  rice: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Risotto_alla_milanese.jpg/440px-Risotto_alla_milanese.jpg",
  fries: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Potato-Chips.jpg/440px-Potato-Chips.jpg",
  bread: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Fresh_made_bread_05.jpg/440px-Fresh_made_bread_05.jpg",
  meze: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Meze_platter.jpg/440px-Meze_platter.jpg",
  cheese: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Cheese_plate.jpg/440px-Cheese_plate.jpg",
  ham: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Prosciutto_di_Parma.jpg/440px-Prosciutto_di_Parma.jpg",
  olives: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Olives_in_bowl.jpg/440px-Olives_in_bowl.jpg",
  pickles: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Pickles_in_jar.jpg/440px-Pickles_in_jar.jpg",
};

const MENU_CATALOG = [
  {
    id: "pije-te-nxehta",
    name: "Pije të nxehta",
    items: [
      it("Kafe Ekspres", "Pije të nxehta", 1.0, P.coffee),
      it("Kafe me qumësht", "Pije të nxehta", 1.3, P.latte),
      it("Kapuçino", "Pije të nxehta", 1.5, P.cappuccino),
      it("Makiato", "Pije të nxehta", 1.4, P.coffee),
      it("Americano", "Pije të nxehta", 1.2, P.coffee),
      it("Neskafe", "Pije të nxehta", 1.0, P.coffee),
      it("Çaj jeshil", "Pije të nxehta", 0.9, P.tea),
      it("Çaj kamomil", "Pije të nxehta", 0.9, P.tea),
      it("Çaj limon", "Pije të nxehta", 0.9, P.tea),
      it("Çokollatë e nxehtë", "Pije të nxehta", 1.5, P.hotChoc),
      it("Salep", "Pije të nxehta", 1.5, P.hotChoc),
    ],
  },
  {
    id: "pije-te-ftohta",
    name: "Pije të ftohta",
    items: [
      it("Ujë 0.5L", "Pije të ftohta", 0.5, P.water),
      it("Ujë 1.5L", "Pije të ftohta", 0.8, P.water15),
      it("Coca-Cola", "Pije të ftohta", 1.5, P.cola),
      it("Fanta", "Pije të ftohta", 1.5, P.fanta),
      it("Sprite", "Pije të ftohta", 1.5, P.sprite),
      it("Schweppes", "Pije të ftohta", 1.5, P.cola),
      it("Red Bull", "Pije të ftohta", 2.5, P.redbull),
      it("Ice Tea", "Pije të ftohta", 1.5, P.icetea),
      it("Lëng portokalli", "Pije të ftohta", 1.5, P.juice),
      it("Lëng molle", "Pije të ftohta", 1.5, P.juice),
      it("Lëng dardhe", "Pije të ftohta", 1.5, P.juice),
      it("Frape", "Pije të ftohta", 2.5, P.frappe),
      it("Smoothie", "Pije të ftohta", 3.0, P.smoothie),
    ],
  },
  {
    id: "birra",
    name: "Birra",
    items: [
      it("Birra Peja", "Birra", 2.0, P.beerBottle),
      it("Birra Tirana", "Birra", 2.0, P.beerBottle),
      it("Birra Heineken", "Birra", 2.5, P.beer),
      it("Birra Corona", "Birra", 3.0, P.beer),
      it("Birra pa alkool", "Birra", 2.0, P.beer),
    ],
  },
  {
    id: "alkool",
    name: "Alkool & pije",
    items: [
      it("Raki", "Alkool & pije", 1.5, P.raki),
      it("Raki me mjaltë", "Alkool & pije", 2.0, P.raki),
      it("Whisky", "Alkool & pije", 3.5, P.whisky),
      it("Vodka", "Alkool & pije", 3.0, P.vodka),
      it("Gin", "Alkool & pije", 3.0, P.vodka),
      it("Rum", "Alkool & pije", 3.0, P.whisky),
      it("Verë e kuqe", "Alkool & pije", 2.5, P.wineRed),
      it("Verë e bardhë", "Alkool & pije", 2.5, P.wineWhite),
      it("Verë rozë", "Alkool & pije", 2.5, P.wineWhite),
      it("Prosecco", "Alkool & pije", 3.5, P.prosecco),
      it("Konjak", "Alkool & pije", 3.5, P.cognac),
    ],
  },
  {
    id: "embelsi-snacks",
    name: "Ëmbëlsira & snacks",
    items: [
      it("Baklava", "Ëmbëlsira & snacks", 1.5, P.baklava),
      it("Tiramisu", "Ëmbëlsira & snacks", 2.5, P.tiramisu),
      it("Kroasan", "Ëmbëlsira & snacks", 1.0, P.croissant),
      it("Kifle", "Ëmbëlsira & snacks", 0.8, P.croissant),
      it("Akullore", "Ëmbëlsira & snacks", 2.0, P.icecream),
      it("Sanduiç", "Ëmbëlsira & snacks", 2.5, P.sandwich),
      it("Tost", "Ëmbëlsira & snacks", 1.5, P.toast),
      it("Byrek me djathë", "Ëmbëlsira & snacks", 1.5, P.burek),
      it("Byrek me mish", "Ëmbëlsira & snacks", 2.0, P.pie),
      it("Pite", "Ëmbëlsira & snacks", 1.5, P.pie),
    ],
  },
  {
    id: "supa-sallata",
    name: "Supa & sallata",
    items: [
      it("Supë pule", "Supa & sallata", 2.5, P.soup),
      it("Supë viçi", "Supa & sallata", 3.0, P.soup),
      it("Sallatë Shqiptare", "Supa & sallata", 3.0, P.salad),
      it("Sallatë Greke", "Supa & sallata", 3.5, P.salad),
      it("Sallatë Çoban", "Supa & sallata", 3.0, P.salad),
      it("Sallatë me ton", "Supa & sallata", 4.0, P.salad),
    ],
  },
  {
    id: "pjata-kryesore",
    name: "Pjata kryesore",
    items: [
      it("Tavë kosi", "Pjata kryesore", 5.0, P.chicken),
      it("Qebap", "Pjata kryesore", 4.5, P.kebab),
      it("Qofte", "Pjata kryesore", 4.5, P.kebab),
      it("Pica Margherita", "Pjata kryesore", 4.0, P.pizza),
      it("Pica me mish", "Pjata kryesore", 5.0, P.pizza),
      it("Pasta Bolognese", "Pjata kryesore", 4.5, P.pasta),
      it("Pasta Karbonara", "Pjata kryesore", 4.5, P.pasta),
      it("Biftek", "Pjata kryesore", 8.0, P.steak),
      it("Pule e pjekur", "Pjata kryesore", 5.5, P.chicken),
      it("Baçi", "Pjata kryesore", 5.0, P.chicken),
      it("Roast beef", "Pjata kryesore", 7.5, P.steak),
      it("Shish qebap", "Pjata kryesore", 5.5, P.kebab),
    ],
  },
  {
    id: "ane-pjate",
    name: "Anë pjate",
    items: [
      it("Patate të skuqura", "Anë pjate", 1.5, P.fries),
      it("Patate të pjekura", "Anë pjate", 2.0, P.fries),
      it("Oriz", "Anë pjate", 1.5, P.rice),
      it("Perime të pjekura", "Anë pjate", 2.0, P.salad),
      it("Bukë", "Anë pjate", 0.5, P.bread),
    ],
  },
  {
    id: "meze",
    name: "Meze",
    items: [
      it("Meze e përzier", "Meze", 5.0, P.meze),
      it("Proshutë", "Meze", 3.5, P.ham),
      it("Djathë", "Meze", 3.0, P.cheese),
      it("Salami", "Meze", 3.0, P.ham),
      it("Ullinj", "Meze", 2.0, P.olives),
      it("Turshi", "Meze", 1.5, P.pickles),
    ],
  },
];

function getCatalogFlatMap() {
  const map = new Map();
  for (const cat of MENU_CATALOG) {
    for (const item of cat.items) {
      map.set(item.slug, { ...item, categoryGroup: cat.name });
    }
  }
  return map;
}

function normMenuName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e")
    .replace(/ç/g, "c");
}

module.exports = {
  MENU_CATALOG,
  getCatalogFlatMap,
  normMenuName,
  slugify,
};
