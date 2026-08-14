/**
 * REVOLUTION POS — biznese që SHESIN produkte/ushqim/pije.
 * Nuk përzihen kurrë me REVOLUTION SECURITY (menaxhim punëtorësh).
 */

/** Tipet e reja për regjistrim nga Master Admin (POS). */
const POS_REGISTER_TIPI = [
  "kafene",
  "restorant",
  "bar",
  "klub_nate",
  "piceri",
  "fast_food",
  "dyqan_pijesh",
];

/** Ushqimore / Tregtare — REVOLUTION MARKET (licencë nga telefoni i adminit). */
const MARKET_REGISTER_TIPI = [
  "minimarket",
  "pilar",
  "supermarket",
  "dyqan_ushqimor",
  "manav",
  "bulmetore",
  "kasap",
  "dyqan_peshku",
];

/** Tipet MARKET (të reja + legacy). */
const MARKET_TIPI = [...MARKET_REGISTER_TIPI, "market", "mini_market", "peshkore"];

/** REVOLUTION HOTEL — kategoritë brenda hotelit. */
const HOTEL_REGISTER_TIPI = [
  "hotel",
  "motel",
  "hostel",
  "resort",
  "ville_me_qira",
];

/** Tipet HOTEL (të reja + legacy hotel_restorant / ville / bujtinë). */
const HOTEL_TIPI = [...HOTEL_REGISTER_TIPI, "hotel_restorant", "ville", "bujtine"];

/**
 * Tipet e lejuara në DB — përfshin edhe tipet e vjetra (klientë ekzistues).
 * Regjistrimi i ri POS përdor POS_REGISTER_TIPI; MARKET përdor MARKET_REGISTER_TIPI.
 */
const ADMIN_CLIENT_TIPI = [
  ...POS_REGISTER_TIPI,
  ...MARKET_REGISTER_TIPI,
  "pub_lounge",
  "bar_nate",
  "klub",
  "diskoteke",
  "kebab",
  "pasticeri",
  "akullore",
  "gjeltore",
  "furre_buke",
  "hotel_restorant",
  ...HOTEL_REGISTER_TIPI,
  "ville",
  "bujtine",
  "market",
  "dyqan_rroba",
  "dyqan_kepuce",
  "dyqan",
  "farmaci",
  "optike",
  "berber",
  "sallon_bukurie",
  "tjeter",
];

const ALLOWED_CLIENT_TIPI = [...ADMIN_CLIENT_TIPI];

/** Grupet e listës Klientët — vetëm shitje POS. */
const CLIENT_SECTORS = [
  {
    num: 1,
    id: "kafene",
    label: "Kafene",
    tipet: ["kafene"],
    keywords: ["kafene", "cafe", "kafe"],
  },
  {
    num: 2,
    id: "restorant",
    label: "Restorant",
    tipet: ["restorant"],
    keywords: ["restorant", "restaurant"],
  },
  {
    num: 3,
    id: "bar_pub",
    label: "Bar / Pub",
    tipet: ["bar", "pub_lounge"],
    keywords: ["bar", "pub", "lounge"],
  },
  {
    num: 4,
    id: "nightlife",
    label: "Klub nate / Diskotekë",
    tipet: ["klub_nate", "klub", "diskoteke", "bar_nate"],
    keywords: ["klub", "nate", "diskotek", "disco", "night"],
  },
  {
    num: 5,
    id: "piceri",
    label: "Piceri",
    tipet: ["piceri"],
    keywords: ["piceri", "pizza"],
  },
  {
    num: 6,
    id: "fast_food",
    label: "Fast Food Kiosk",
    tipet: ["fast_food", "kebab"],
    keywords: ["fast", "food", "kiosk", "kebab"],
  },
  {
    num: 7,
    id: "dyqan_pijesh",
    label: "Dyqan pijesh",
    tipet: ["dyqan_pijesh"],
    keywords: ["pijesh", "pije", "drinks"],
  },
  {
    num: 8,
    id: "other",
    label: "Të tjera (klientë të vjetër)",
    tipet: [
      "pasticeri", "akullore", "gjeltore", "furre_buke",
      "dyqan_rroba", "dyqan_kepuce", "dyqan", "farmaci", "optike", "berber",
      "sallon_bukurie", "tjeter",
    ],
    keywords: ["tjeter", "other"],
  },
];

const HOSPITALITY_TIPET = POS_REGISTER_TIPI;

const MARKET_SECTORS = [
  {
    num: 1,
    id: "minimarket",
    label: "Mini-market / Market",
    tipet: ["minimarket", "market"],
    keywords: ["mini", "market", "minimarket"],
  },
  {
    num: 2,
    id: "pilar",
    label: "Pilar (dyqan i vogël lagje)",
    tipet: ["pilar"],
    keywords: ["pilar", "lagje", "i vogel"],
  },
  {
    num: 3,
    id: "supermarket",
    label: "Supermarket",
    tipet: ["supermarket"],
    keywords: ["supermarket", "super"],
  },
  {
    num: 4,
    id: "dyqan_ushqimor",
    label: "Dyqan ushqimor",
    tipet: ["dyqan_ushqimor"],
    keywords: ["ushqimor", "grocery"],
  },
  {
    num: 5,
    id: "manav",
    label: "Dyqan pemë-perimesh (manav)",
    tipet: ["manav"],
    keywords: ["manav", "peme", "perime", "fruta"],
  },
  {
    num: 6,
    id: "bulmetore",
    label: "Dyqan bulmetore",
    tipet: ["bulmetore"],
    keywords: ["bulmetore", "qumesht", "dairy"],
  },
  {
    num: 7,
    id: "kasap",
    label: "Dyqan mishit (kasap)",
    tipet: ["kasap"],
    keywords: ["kasap", "mish", "butcher", "mishtore"],
  },
  {
    num: 8,
    id: "dyqan_peshku",
    label: "Dyqan peshku",
    tipet: ["dyqan_peshku"],
    keywords: ["peshk", "fish", "peshkore"],
  },
];

const HOTEL_SECTORS = [
  {
    num: 1,
    id: "hotel",
    label: "Hotel",
    tipet: ["hotel", "hotel_restorant"],
    keywords: ["hotel"],
  },
  {
    num: 2,
    id: "motel",
    label: "Motel",
    tipet: ["motel"],
    keywords: ["motel"],
  },
  {
    num: 3,
    id: "hostel",
    label: "Hostel",
    tipet: ["hostel", "bujtine"],
    keywords: ["hostel", "bujtine", "bujtina"],
  },
  {
    num: 4,
    id: "resort",
    label: "Resort",
    tipet: ["resort"],
    keywords: ["resort"],
  },
  {
    num: 5,
    id: "ville_me_qira",
    label: "Villë me qira",
    tipet: ["ville_me_qira", "ville"],
    keywords: ["ville", "villa", "qira"],
  },
];

const TIPI_ALIASES = {
  restaurante: "restorant",
  restaurant: "restorant",
  resto: "restorant",
  cafe: "kafene",
  coffee: "kafene",
  cafeteria: "kafene",
  kafe: "kafene",
  pub: "bar",
  lounge: "bar",
  "pub/lounge": "bar",
  publounge: "bar",
  pub_lounge: "bar",
  pizza: "piceri",
  pizzeria: "piceri",
  "fast food": "fast_food",
  fastfood: "fast_food",
  "fast-food": "fast_food",
  kiosk: "fast_food",
  nightclub: "klub_nate",
  club: "klub_nate",
  klub: "klub_nate",
  diskoteke: "klub_nate",
  diskoteka: "klub_nate",
  disco: "klub_nate",
  discotheque: "klub_nate",
  "bar nate": "klub_nate",
  bar_nate: "klub_nate",
  nightbar: "klub_nate",
  night_bar: "klub_nate",
  nightlife: "klub_nate",
  "klub nate": "klub_nate",
  klub_nate_diskoteke: "klub_nate",
  dyqan_pijesh: "dyqan_pijesh",
  "dyqan pijesh": "dyqan_pijesh",
  pije: "dyqan_pijesh",
  drinks: "dyqan_pijesh",
  market: "minimarket",
  mini_market: "minimarket",
  "mini-market": "minimarket",
  minimarket: "minimarket",
  "mini market": "minimarket",
  pilar: "pilar",
  "dyqan i vogel": "pilar",
  supermarket: "supermarket",
  dyqan_ushqimor: "dyqan_ushqimor",
  "dyqan ushqimor": "dyqan_ushqimor",
  grocery: "dyqan_ushqimor",
  manav: "manav",
  "peme perime": "manav",
  "dyqan peme-perimesh": "manav",
  bulmetore: "bulmetore",
  dairy: "bulmetore",
  kasap: "kasap",
  butcher: "kasap",
  "dyqan mishit": "kasap",
  mishtore: "kasap",
  dyqan_peshku: "dyqan_peshku",
  "dyqan peshku": "dyqan_peshku",
  peshkore: "dyqan_peshku",
  fish: "dyqan_peshku",
  hotel_restorant: "hotel",
  motel: "motel",
  hostel: "hostel",
  bujtine: "hostel",
  bujtina: "hostel",
  guesthouse: "hostel",
  resort: "resort",
  ville: "ville_me_qira",
  villa: "ville_me_qira",
  vill: "ville_me_qira",
  ville_me_qira: "ville_me_qira",
  "ville me qira": "ville_me_qira",
  "villa me qira": "ville_me_qira",
  other: "tjeter",
  tjetër: "tjeter",
  tjeter: "tjeter",
};

const TIPI_LABELS = {
  kafene: "Kafene",
  restorant: "Restorant",
  bar: "Bar / Pub",
  klub_nate: "Klub nate / Diskotekë",
  piceri: "Piceri",
  fast_food: "Fast Food Kiosk",
  dyqan_pijesh: "Dyqan pijesh",
  pub_lounge: "Bar / Pub",
  bar_nate: "Klub nate / Diskotekë",
  klub: "Klub nate / Diskotekë",
  diskoteke: "Klub nate / Diskotekë",
  kebab: "Fast Food Kiosk",
  pasticeri: "Pastiçeri/Ëmbëltore",
  akullore: "Akullore",
  gjeltore: "Gjeltore",
  furre_buke: "Furrë Buke",
  hotel_restorant: "Hotel",
  hotel: "Hotel",
  motel: "Motel",
  hostel: "Hostel",
  bujtine: "Hostel",
  resort: "Resort",
  ville: "Villë me qira",
  ville_me_qira: "Villë me qira",
  market: "Mini-market / Market",
  minimarket: "Mini-market / Market",
  pilar: "Pilar (dyqan i vogël lagje)",
  supermarket: "Supermarket",
  dyqan_ushqimor: "Dyqan ushqimor",
  manav: "Dyqan pemë-perimesh (manav)",
  bulmetore: "Dyqan bulmetore",
  kasap: "Dyqan mishit (kasap)",
  dyqan_peshku: "Dyqan peshku",
  dyqan_rroba: "Dyqan Rrobash",
  dyqan_kepuce: "Dyqan Këpucësh",
  dyqan: "Dyqan",
  farmaci: "Farmaci",
  optike: "Optikë",
  berber: "Berber",
  sallon_bukurie: "Sallon Bukurie",
  tjeter: "Tjetër",
};

function normalizeClientTipi(raw) {
  let t = String(raw || "restorant")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e")
    .replace(/\s+/g, "_")
    .replace(/\//g, "_");
  if (TIPI_ALIASES[t]) t = TIPI_ALIASES[t];
  const spaced = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e");
  if (TIPI_ALIASES[spaced]) t = TIPI_ALIASES[spaced];
  return t;
}

function assertClientTipi(raw) {
  const tipi = normalizeClientTipi(raw);
  if (!ALLOWED_CLIENT_TIPI.includes(tipi)) {
    throw new Error(
      "Tipi i biznesit nuk njihet. Zgjidhni një veprimtari REVOLUTION POS / MARKET.",
    );
  }
  return tipi;
}

function appTypeFromClientTipi(tipi) {
  const t = normalizeClientTipi(tipi);
  if (t === "kafene") return "kafene";
  if (MARKET_TIPI.includes(t)) return "market";
  return "restorant";
}

function labelForTipi(tipi) {
  const t = normalizeClientTipi(tipi);
  return TIPI_LABELS[t] || TIPI_LABELS.tjeter;
}

function sectorForTipi(tipi) {
  const t = normalizeClientTipi(tipi);
  for (const s of HOTEL_SECTORS) {
    if (s.tipet.includes(t)) return s;
  }
  for (const s of MARKET_SECTORS) {
    if (s.tipet.includes(t)) return s;
  }
  for (const s of CLIENT_SECTORS) {
    if (s.tipet.includes(t)) return s;
  }
  return CLIENT_SECTORS[CLIENT_SECTORS.length - 1];
}

module.exports = {
  POS_REGISTER_TIPI,
  MARKET_REGISTER_TIPI,
  MARKET_TIPI,
  HOTEL_REGISTER_TIPI,
  HOTEL_TIPI,
  ADMIN_CLIENT_TIPI,
  ALLOWED_CLIENT_TIPI,
  HOSPITALITY_TIPET,
  CLIENT_SECTORS,
  MARKET_SECTORS,
  HOTEL_SECTORS,
  TIPI_LABELS,
  TIPI_ALIASES,
  normalizeClientTipi,
  assertClientTipi,
  appTypeFromClientTipi,
  labelForTipi,
  sectorForTipi,
};
