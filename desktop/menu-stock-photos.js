/** Foto standarde lokale për artikujt — nga version-config.menuSeed + harta e vjetër. */
function normName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e")
    .replace(/ç/g, "c");
}

const LEGACY_PHOTOS = {
  [normName("Kafe espresso")]: "/menu-stock/kafe-espresso.jpg",
  [normName("Kafe me qumësht")]: "/menu-stock/kafe-me-qumesht.jpg",
  [normName("Kapuçino")]: "/menu-stock/kapucino.jpg",
  [normName("Çaj")]: "/menu-stock/caj.jpg",
  [normName("Neskafe")]: "/menu-stock/neskafe.jpg",
  [normName("Çaj i ftohtë")]: "/menu-stock/caj-i-ftohte.jpg",
  [normName("Ujë 0.5L")]: "/menu-stock/uje-05l.jpg",
  [normName("Ujë 1.5L")]: "/menu-stock/uje-15l.jpg",
  [normName("Coca-Cola")]: "/menu-stock/coca-cola.jpg",
  [normName("Fanta")]: "/menu-stock/fanta.jpg",
  [normName("Sprite")]: "/menu-stock/sprite.jpg",
  [normName("Lëng frutash")]: "/menu-stock/lengu-frutash.jpg",
  [normName("Red Bull")]: "/menu-stock/red-bull.jpg",
  [normName("Ice tea")]: "/menu-stock/ice-tea.jpg",
  [normName("Baklava")]: "/menu-stock/baklava.jpg",
  [normName("Tiramisù")]: "/menu-stock/tiramisu.jpg",
  [normName("Akullore")]: "/menu-stock/akullore.jpg",
  [normName("Revani")]: "/menu-stock/revani.jpg",
  [normName("Kroasan")]: "/menu-stock/kroasan.jpg",
  [normName("Byrek me djathë")]: "/menu-stock/byrek-me-djathe.jpg",
  [normName("Sanduiç")]: "/menu-stock/sanduic.jpg",
  [normName("Biskota")]: "/menu-stock/biskota.jpg",
  [normName("Chips")]: "/menu-stock/chips.jpg",
  [normName("Kikirikë")]: "/menu-stock/kikirke.jpg",
  [normName("Birra")]: "/menu-stock/beer-heineken.jpg",
  [normName("Çokollatë")]: "/menu-stock/chocolate-bar.jpg",
  [normName("Snickers")]: "/menu-stock/chocolate-bar.jpg",
  [normName("Biskota")]: "/menu-stock/biskota.jpg",
  [normName("Ujë 1.5L")]: "/menu-stock/uje-15l.jpg",
  [normName("Red Bull")]: "/menu-stock/red-bull.jpg",
  [normName("Fanta")]: "/menu-stock/fanta.jpg",
  [normName("Sprite")]: "/menu-stock/sprite.jpg",
  [normName("Sallatë Shqiptare")]: "/menu-stock/sal-shtepie.jpg",
  [normName("Sallatë Greke")]: "/menu-stock/sal-greek.jpg",
  [normName("Sallatë Çoban")]: "/menu-stock/sal-shtepie.jpg",
  [normName("Sallatë me ton")]: "/menu-stock/sal-tonno.jpg",
  [normName("Supë viçi")]: "/menu-stock/soup-leng-mishi.jpg",
};

/** Emra të menuës që ndryshojnë pak — map te foto e seed-it. */
const NAME_ALIASES = {
  [normName("Sallatë greke")]: "/menu-stock/sal-greek.jpg",
  [normName("Sallatë tune")]: "/menu-stock/sal-tonno.jpg",
  [normName("Supë pule")]: "/menu-stock/soup-pule.jpg",
};

let _seedPhotoByName = null;

function seedPhotoMap() {
  if (_seedPhotoByName) return _seedPhotoByName;
  _seedPhotoByName = { ...LEGACY_PHOTOS };
  try {
    const VERSION = require("./version-config");
    const add = (list) => {
      for (const item of list || []) {
        const img = String(item.image || "").trim();
        const name = String(item.name || "").trim();
        if (!img || !name) continue;
        _seedPhotoByName[normName(name)] = img.startsWith("/") ? img : `/menu-stock/${img}`;
      }
    };
    add(VERSION.menuSeedRaw);
    add(VERSION.menuSeed);
    try {
      const frMap = require("./locales/fr-map");
      for (const item of VERSION.menuSeedRaw || []) {
        const frName = frMap[String(item.name || "").trim()];
        const img = String(item.image || "").trim();
        if (!frName || !img) continue;
        _seedPhotoByName[normName(frName)] = img.startsWith("/") ? img : `/menu-stock/${img}`;
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
  return _seedPhotoByName;
}

function stockPhotoForName(name) {
  const n = normName(name);
  const map = seedPhotoMap();
  if (map[n]) return map[n];
  if (NAME_ALIASES[n]) return NAME_ALIASES[n];
  if (n.includes("sup") && n.includes("pule")) return "/menu-stock/soup-pule.jpg";
  if (n.includes("sup") && (n.includes("vic") || n.includes("mish") || n.includes("leng"))) {
    return "/menu-stock/soup-leng-mishi.jpg";
  }
  if (n.includes("sallat") && n.includes("grek")) return "/menu-stock/sal-greek.jpg";
  if (n.includes("sallat") && (n.includes("shqip") || n.includes("coban") || n.includes("shtep"))) {
    return "/menu-stock/sal-shtepie.jpg";
  }
  if (n.includes("sallat") && (n.includes("ton") || n.includes("tun"))) return "/menu-stock/sal-tonno.jpg";
  if (n.includes("sallat") && n.includes("cezar")) return "/menu-stock/sal-caesar.jpg";
  if (n.startsWith("birra") || n === "birra") return "/menu-stock/beer-heineken.jpg";
  if (n.includes("cokollat") || n.includes("snickers") || n.includes("mars")) {
    return "/menu-stock/chocolate-bar.jpg";
  }
  if (n.includes("biskot")) return "/menu-stock/biskota.jpg";
  if (n.includes("chips") || n.includes("crisps")) return "/menu-stock/chips.jpg";
  if (n.includes("coca") || n.includes("cola")) return "/menu-stock/coca-cola.jpg";
  if (n.includes("fanta")) return "/menu-stock/fanta.jpg";
  if (n.includes("sprite")) return "/menu-stock/sprite.jpg";
  if (n.includes("red bull") || n.includes("redbull")) return "/menu-stock/red-bull.jpg";
  if (n.includes("uje") && (n.includes("15") || n.includes("1.5"))) return "/menu-stock/uje-15l.jpg";
  if (n.includes("uje") || n.includes("ujë")) return "/menu-stock/uje-05l.jpg";
  return "";
}

function isRemotePhoto(val) {
  return /^https?:\/\//i.test(String(val || "").trim());
}

function isStockPhoto(val) {
  const s = String(val || "").trim();
  if (!s) return false;
  if (isRemotePhoto(s)) return true;
  return s.startsWith("/menu-stock/");
}

/**
 * Default: mbush VETËM foto të zbrazëta (mos prish foto custom / base64 / URL).
 * forceAllStock=true vetëm për veprim eksplicit admin («Apliko foto stock»).
 */
function applyMissing(db, { forceAllStock = false, replaceRemote = false } = {}) {
  let n = 0;
  for (const item of db.getMenuItems(false)) {
    const local = stockPhotoForName(item.name);
    if (!local) continue;
    const current = String(db.getMenuItemPhoto(item.id) || "").trim();
    if (!forceAllStock && current) continue;
    if (!replaceRemote && isRemotePhoto(current) && !isStockPhoto(current)) continue;
    if (current !== local) {
      db.setMenuItemPhoto(item.id, local);
      n++;
    }
  }
  return n;
}

module.exports = { applyMissing, stockPhotoForName, normName, isStockPhoto, seedPhotoMap };
